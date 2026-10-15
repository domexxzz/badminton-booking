import type { ProviderResult, SlipFacts } from "./types";

// https://document.easyslip.com/en/v2/verify/bank
const EASYSLIP_VERIFY_URL = "https://api.easyslip.com/v2/verify/bank";
const REQUEST_TIMEOUT_MS = 20_000;

const UNREADABLE_CODES: Record<string, string> = {
  SLIP_NOT_FOUND: "ไม่พบ QR ในสลิป หรือสลิปไม่ถูกต้อง กรุณาอัปโหลดรูปสลิปที่ชัดเจน",
  INVALID_IMAGE_FORMAT: "ไฟล์ไม่ใช่รูปภาพที่รองรับ กรุณาอัปโหลดรูปสลิปใหม่",
  IMAGE_SIZE_TOO_LARGE: "รูปสลิปใหญ่เกิน 4MB กรุณาอัปโหลดรูปที่เล็กลง",
};

const ERROR_CODES: Record<string, string> = {
  SLIP_PENDING: "ธนาคารยังไม่ยืนยันรายการ (สลิปกรุงเทพฯ ที่โอนไม่ถึง 5 นาที) ให้กดตรวจอีกครั้งภายหลัง",
  QUOTA_EXCEEDED: "โควตาตรวจสลิปของ EasySlip เต็มแล้ว",
  RATE_LIMIT_EXCEEDED: "เรียกตรวจสลิปถี่เกินไป ลองใหม่อีกครั้ง",
  INVALID_API_KEY: "EASYSLIP_API_KEY ไม่ถูกต้อง",
  MISSING_API_KEY: "ไม่ได้ส่ง EASYSLIP_API_KEY",
};

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const at = (v: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((cur, key) => (isObject(cur) ? cur[key] : undefined), v);

const HAS_TZ_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;

/** Validates the parts of EasySlip's rawSlip we rely on; null if anything is off. */
export function parseRawSlip(raw: unknown): SlipFacts | null {
  const transRef = str(at(raw, "transRef"));
  const amount = at(raw, "amount", "amount");
  const rawDate = str(at(raw, "date"));
  if (!transRef || typeof amount !== "number" || !Number.isFinite(amount) || !rawDate) return null;

  const account = at(raw, "receiver", "account");
  return {
    transRef,
    amount,
    // Thai slips are in Bangkok time; never let a missing offset fall back to server time.
    date: HAS_TZ_OFFSET.test(rawDate) ? rawDate : `${rawDate}+07:00`,
    receiver: {
      names: [str(at(account, "name", "th")), str(at(account, "name", "en"))].filter((n): n is string => n !== null),
      bankAccount: str(at(account, "bank", "account")),
      proxyType: str(at(account, "proxy", "type")),
      proxyAccount: str(at(account, "proxy", "account")),
    },
  };
}

export async function verifyWithEasySlip(
  image: Blob,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderResult> {
  const form = new FormData();
  form.append("image", image, "slip");

  let response: Response;
  try {
    response = await fetchImpl(EASYSLIP_VERIFY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("EasySlip request failed:", error);
    return { kind: "error", message: "เชื่อมต่อระบบตรวจสลิปไม่ได้" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "error", message: `ระบบตรวจสลิปตอบกลับผิดรูปแบบ (HTTP ${response.status})` };
  }

  if (at(body, "success") === true) {
    const raw = at(body, "data", "rawSlip");
    const slip = parseRawSlip(raw);
    return slip ? { kind: "ok", slip, raw } : { kind: "error", message: "ข้อมูลสลิปจากระบบตรวจไม่ครบ" };
  }

  const code = str(at(body, "error", "code")) ?? `HTTP_${response.status}`;
  if (UNREADABLE_CODES[code]) return { kind: "unreadable", message: UNREADABLE_CODES[code] };
  return { kind: "error", message: ERROR_CODES[code] ?? `ตรวจสลิปอัตโนมัติไม่สำเร็จ (${code})` };
}
