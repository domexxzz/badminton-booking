import { createHash, timingSafeEqual } from "node:crypto";
import { parseBankNotification, type Direction } from "./notification";

// POST /api/bank-notifications, called by the shop's Android phone (MacroDroid).
// Accepts JSON, or a plain-text body that survives quotes and newlines in
// notification text without any escaping on the phone:
//   line 1: app package   line 2: notification timestamp
//   line 3: title         line 4+: notification text
// A body of just "heartbeat" tells us the phone is still alive.

const MAX_BODY_BYTES = 8 * 1024;
export const MIN_SECRET_LENGTH = 32;
const MAX_TITLE = 200;
const MAX_TEXT = 2000;
const MAX_POSTED_AGE_MS = 2 * 24 * 60 * 60 * 1000;
const MAX_POSTED_FUTURE_MS = 10 * 60 * 1000;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export type BankNotificationRecord = {
  dedupeKey: string;
  app: string;
  title: string;
  text: string;
  direction: Direction;
  amount: number | null;
  postedAt: string | null;
  reviewReason: string | null;
};

// Bank apps also post OTPs and account alerts; keep only money-in text.
const REDACTED = "[ไม่เก็บข้อความ เพราะไม่ใช่รายการเงินเข้า]";

export type BankStore = {
  heartbeat: () => Promise<void>;
  record: (n: BankNotificationRecord) => Promise<{ outcome: string }>;
};

export type WebhookConfig = {
  secret: string;
  allowedApps: string[];
  store: BankStore | null;
  now?: () => Date;
};

type Payload = { type: "heartbeat" } | { type: "notification"; app: string; title: string; text: string; postedRaw: string };

const json = (status: number, body: unknown) => Response.json(body, { status });
const sha256 = (s: string) => createHash("sha256").update(s).digest();

function bearerMatches(header: string | null, secret: string): boolean {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(sha256(token), sha256(secret));
}

export function parsePostedAt(raw: string, now: Date): Date | null {
  const value = raw.trim();
  if (!value) return null;
  let ms: number;
  if (/^\d{13}$/.test(value)) ms = Number(value);
  else if (/^\d{10}$/.test(value)) ms = Number(value) * 1000;
  else ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const age = now.getTime() - ms;
  return age > MAX_POSTED_AGE_MS || age < -MAX_POSTED_FUTURE_MS ? null : new Date(ms);
}

export function parseWebhookBody(raw: string, contentType: string | null): Payload | null {
  if (contentType?.includes("application/json")) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof data !== "object" || data === null) return null;
    const d = data as Record<string, unknown>;
    if (d.type === "heartbeat") return { type: "heartbeat" };
    if (typeof d.app !== "string" || typeof d.text !== "string") return null;
    return {
      type: "notification",
      app: d.app.trim(),
      title: typeof d.title === "string" ? d.title : "",
      text: d.text,
      postedRaw: typeof d.postedAt === "string" || typeof d.postedAt === "number" ? String(d.postedAt) : "",
    };
  }

  const body = raw.replace(/\r\n/g, "\n").trim();
  if (body.toLowerCase() === "heartbeat") return { type: "heartbeat" };
  const [app = "", postedRaw = "", title = "", ...rest] = body.split("\n");
  return { type: "notification", app: app.trim(), title, text: rest.join("\n"), postedRaw };
}

export function createBankWebhookHandler(config: WebhookConfig) {
  return async function POST(request: Request): Promise<Response> {
    const { secret, allowedApps, store } = config;
    if (secret.length < MIN_SECRET_LENGTH || allowedApps.length === 0 || !store) {
      console.error("Bank webhook not configured: need BANK_WEBHOOK_SECRET (32+ chars), BANK_APP_PACKAGES and SUPABASE_SERVICE_ROLE_KEY");
      return json(503, { error: "not_configured" });
    }
    if (!bearerMatches(request.headers.get("authorization"), secret)) {
      return json(401, { error: "unauthorized" });
    }
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return json(413, { error: "too_large" });
    }
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json(413, { error: "too_large" });

    const payload = parseWebhookBody(raw, request.headers.get("content-type"));
    if (!payload || (payload.type === "notification" && (!PACKAGE_RE.test(payload.app) || !payload.text.trim()))) {
      return json(400, { error: "bad_request" });
    }

    try {
      // Only bank apps count. A chat message saying "เงินเข้า 300.37" must never
      // confirm anything, and non-bank notifications are not stored at all.
      if (payload.type === "heartbeat" || !allowedApps.includes(payload.app)) {
        await store.heartbeat();
        return json(payload.type === "heartbeat" ? 200 : 202, {
          outcome: payload.type === "heartbeat" ? "heartbeat" : "ignored_app",
        });
      }

      const now = config.now?.() ?? new Date();
      const title = payload.title.slice(0, MAX_TITLE);
      const text = payload.text.slice(0, MAX_TEXT);
      const postedAt = parsePostedAt(payload.postedRaw, now);
      // Same notification re-sent -> same key. Without a timestamp, bucket by minute.
      const when = postedAt?.toISOString() ?? `~${Math.floor(now.getTime() / 60_000)}`;
      const dedupeKey = sha256([payload.app, when, title, text].join("\n")).toString("hex");
      const parsed = parseBankNotification(`${title}\n${text}`);
      const keep = parsed.direction === "in";
      // A timestamp we can't trust disables the "paid after booking" check, so don't auto-match.
      const badTimestamp = payload.postedRaw.trim() !== "" && postedAt === null;

      const result = await store.record({
        dedupeKey,
        app: payload.app,
        title: keep ? title : "",
        text: keep ? text : REDACTED,
        direction: parsed.direction,
        amount: parsed.amount,
        postedAt: postedAt?.toISOString() ?? null,
        reviewReason: badTimestamp ? "เวลาในแจ้งเตือนผิดปกติ ตรวจสอบก่อนยืนยัน" : null,
      });
      return json(200, result);
    } catch (error) {
      console.error("Bank webhook failed to record:", error);
      return json(500, { error: "record_failed" });
    }
  };
}
