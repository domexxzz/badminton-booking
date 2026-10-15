import { describe, expect, test, vi } from "vitest";
import {
  createBankWebhookHandler,
  parsePostedAt,
  parseWebhookBody,
  type BankStore,
} from "../src/lib/bank/webhook";

const SECRET = "s".repeat(40);
const KPLUS = "com.kasikorn.retail.mbanking.wap";
const NOW = new Date("2026-10-20T11:05:00Z");
const POSTED_ISO = "2026-10-20T11:00:00.000Z";
const POSTED_MS = String(Date.parse(POSTED_ISO));

function setup(overrides: { secret?: string; allowedApps?: string[]; store?: BankStore | null } = {}) {
  const store: BankStore = {
    heartbeat: vi.fn(async () => {}),
    record: vi.fn(async () => ({ outcome: "matched" })),
  };
  const handler = createBankWebhookHandler({
    secret: SECRET,
    allowedApps: [KPLUS],
    store,
    now: () => NOW,
    ...overrides,
  });
  return { handler, store };
}

const post = (body: string, { token = SECRET, type = "text/plain" } = {}) =>
  new Request("https://example.com/api/bank-notifications", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": type },
    body,
  });

const kplusText = (amount = "300.37", ts = POSTED_MS) =>
  `${KPLUS}\n${ts}\nเงินเข้า\nบัญชี x1234 รับโอน ${amount} บาท "สมชาย" คงเหลือ 9,000.00 บาท`;

describe("bank webhook", () => {
  test("refuses to run without a strong secret, an app allowlist and a store", async () => {
    expect((await setup({ secret: "short" }).handler(post(kplusText()))).status).toBe(503);
    expect((await setup({ allowedApps: [] }).handler(post(kplusText()))).status).toBe(503);
    expect((await setup({ store: null }).handler(post(kplusText()))).status).toBe(503);
  });

  test("rejects a wrong or missing token", async () => {
    const { handler, store } = setup();
    expect((await handler(post(kplusText(), { token: "nope" }))).status).toBe(401);
    expect(store.record).not.toHaveBeenCalled();
  });

  test("records an incoming transfer from an allowed bank app", async () => {
    const { handler, store } = setup();
    const res = await handler(post(kplusText()));

    expect(res.status).toBe(200);
    expect(store.record).toHaveBeenCalledWith(
      expect.objectContaining({ app: KPLUS, direction: "in", amount: 300.37, postedAt: POSTED_ISO }),
    );
  });

  test("ignores look-alike text from non-bank apps without storing it", async () => {
    const { handler, store } = setup();
    const res = await handler(post(`jp.naver.line.android\n${POSTED_MS}\nแชท\nเงินเข้า 300.37 บาท`));

    expect(res.status).toBe(202);
    expect(store.record).not.toHaveBeenCalled();
    expect(store.heartbeat).toHaveBeenCalled();
  });

  test("does not store the text of non-incoming bank notifications (e.g. OTPs)", async () => {
    const { handler, store } = setup();
    await handler(post(`${KPLUS}\n${POSTED_MS}\nรหัส OTP\nรหัส OTP ของคุณคือ 123456`));

    const recorded = vi.mocked(store.record).mock.calls[0][0];
    expect(recorded.direction).toBe("unknown");
    expect(recorded.title).toBe("");
    expect(recorded.text).not.toContain("123456");
  });

  test("flags a present but unusable timestamp for review", async () => {
    const { handler, store } = setup();
    await handler(post(kplusText("300.37", "not-a-time")));
    expect(vi.mocked(store.record).mock.calls[0][0].reviewReason).toContain("เวลา");
  });

  test("a missing timestamp is not flagged", async () => {
    const { handler, store } = setup();
    await handler(post(kplusText("300.37", "")));
    expect(vi.mocked(store.record).mock.calls[0][0].reviewReason).toBeNull();
  });

  test("accepts a heartbeat", async () => {
    const { handler, store } = setup();
    expect((await handler(post("heartbeat"))).status).toBe(200);
    expect(store.heartbeat).toHaveBeenCalled();
  });

  test("gives the same notification the same dedupe key", async () => {
    const { handler, store } = setup();
    await handler(post(kplusText()));
    await handler(post(kplusText()));
    const keys = vi.mocked(store.record).mock.calls.map(([n]) => n.dedupeKey);
    expect(keys[0]).toBe(keys[1]);
  });

  test("accepts JSON bodies too", async () => {
    const { handler, store } = setup();
    const body = JSON.stringify({ app: KPLUS, title: "เงินเข้า", text: "รับโอน 1,200.15 บาท", postedAt: Number(POSTED_MS) });
    expect((await handler(post(body, { type: "application/json" }))).status).toBe(200);
    expect(vi.mocked(store.record).mock.calls[0][0].amount).toBe(1200.15);
  });

  test("rejects malformed and oversized bodies", async () => {
    const { handler } = setup();
    expect((await handler(post("{not json", { type: "application/json" }))).status).toBe(400);
    expect((await handler(post("not a package\n1\nt\ntext"))).status).toBe(400);
    expect((await handler(post(`${KPLUS}\n1\nt\n${"x".repeat(9000)}`))).status).toBe(413);
  });

  test("returns 500 when storage fails so the phone can show an error", async () => {
    const store: BankStore = {
      heartbeat: vi.fn(async () => {}),
      record: vi.fn(async () => {
        throw new Error("db down");
      }),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await setup({ store }).handler(post(kplusText()))).status).toBe(500);
  });
});

describe("parsePostedAt", () => {
  test("understands epoch milliseconds, seconds and ISO strings", () => {
    expect(parsePostedAt(POSTED_MS, NOW)?.toISOString()).toBe(POSTED_ISO);
    expect(parsePostedAt(POSTED_MS.slice(0, 10), NOW)?.toISOString()).toBe(POSTED_ISO);
    expect(parsePostedAt("2026-10-20T18:00:00+07:00", NOW)?.toISOString()).toBe("2026-10-20T11:00:00.000Z");
  });

  test("drops missing, garbage, stale or future timestamps", () => {
    expect(parsePostedAt("", NOW)).toBeNull();
    expect(parsePostedAt("yesterday-ish", NOW)).toBeNull();
    expect(parsePostedAt("2026-10-01T00:00:00Z", NOW)).toBeNull();
    expect(parsePostedAt("2026-10-20T12:00:00Z", NOW)).toBeNull();
  });
});

describe("parseWebhookBody", () => {
  test("keeps quotes and extra lines in the text", () => {
    const parsed = parseWebhookBody(`${KPLUS}\n123\nTitle\nline "one"\nline two`, "text/plain");
    expect(parsed).toEqual({ type: "notification", app: KPLUS, title: "Title", text: 'line "one"\nline two', postedRaw: "123" });
  });
});
