/**
 * Telling "the slip checker is broken" apart from "this slip needs a human".
 *
 * A recorded verify_status of "error" means the check never happened: the provider
 * refused the request (package expired, quota gone, bad key) or could not be reached.
 * The shop has to act on that, but in the per-slip report it looks the same as a slip
 * that merely needs review, so nobody noticed the EasySlip package expiring on
 * 2026-10-29 for three days. See docs/2026-10-31-cost-and-pricing.md §2.2.
 */

/** Recorded reasons that mean "ask the bank again later", not "the checker is down". */
const RETRY_LATER = ["ธนาคารยังไม่ยืนยันรายการ"];

/** How long the same failure stays quiet, so one expired package is not one alert per slip. */
export const SLIP_ALERT_REPEAT_MS = 6 * 60 * 60 * 1000;

export type SlipAlertState = { key: string; at: number } | null;

/** What the alert is de-duplicated on: the provider's own message. */
export function slipFailureKey(reasons: readonly string[]): string {
  return (reasons[0] ?? "").trim();
}

/** True when an "error" outcome is something the shop has to fix. */
export function isSlipCheckerDown(verifyStatus: string | null, reasons: readonly string[]): boolean {
  if (verifyStatus !== "error") return false;
  const key = slipFailureKey(reasons);
  if (key === "") return false;
  return !RETRY_LATER.some((benign) => key.includes(benign));
}

/**
 * Whether to send the alert now. A failure the shop has not seen yet goes out at
 * once; the same one repeating waits out SLIP_ALERT_REPEAT_MS first.
 */
export function shouldAlertSlipFailure(args: {
  verifyStatus: string | null;
  reasons: readonly string[];
  last: SlipAlertState;
  now: number;
}): boolean {
  const { verifyStatus, reasons, last, now } = args;
  if (!isSlipCheckerDown(verifyStatus, reasons)) return false;
  const key = slipFailureKey(reasons);
  if (!last || last.key !== key) return true;
  return now - last.at >= SLIP_ALERT_REPEAT_MS;
}

/** The provider's own code, when the recorded reason still carries one. */
export function slipFailureCode(reasons: readonly string[]): string | null {
  const match = slipFailureKey(reasons).match(/\(([A-Z0-9_]{3,})\)\s*$/);
  return match ? match[1] : null;
}

// Known failures and what the shop must actually do about each. Keyed by the
// provider code when there is one, otherwise by a phrase of the Thai message
// that easyslip.ts already translated.
const ADVICE: readonly { match: string; advice: string }[] = [
  {
    match: "SERVICE_EXPIRED",
    advice: "แพ็กเกจ EasySlip หมดอายุ ไปต่ออายุที่ easyslip.com แล้วกดตรวจสลิปที่ค้างอีกครั้ง",
  },
  {
    match: "โควตาตรวจสลิปของ EasySlip เต็มแล้ว",
    advice: "โควตาเดือนนี้หมด ไปซื้อแพ็กเกจที่ใหญ่ขึ้นหรือเติมโควตาที่ easyslip.com",
  },
  {
    match: "EASYSLIP_API_KEY ไม่ถูกต้อง",
    advice: "ตั้งค่า EASYSLIP_API_KEY ใหม่บน Render แล้ว deploy ซ้ำ",
  },
  {
    match: "ไม่ได้ส่ง EASYSLIP_API_KEY",
    advice: "ยังไม่ได้ตั้ง EASYSLIP_API_KEY บน Render",
  },
  {
    match: "RATE_LIMIT_EXCEEDED",
    advice: "เรียกถี่เกินไป ปล่อยไว้สักครู่แล้วกดตรวจอีกครั้ง",
  },
  {
    match: "เชื่อมต่อระบบตรวจสลิปไม่ได้",
    advice: "ต่อ EasySlip ไม่ได้ อาจเป็นฝั่ง EasySlip ล่ม ลองกดตรวจอีกครั้งภายหลัง",
  },
  {
    match: "ดาวน์โหลดไฟล์สลิปไม่สำเร็จ",
    advice: "อ่านไฟล์สลิปจาก Supabase Storage ไม่ได้ เช็ก bucket slips",
  },
];

/** Plain words for what to do, or null when the failure is not one we recognise. */
export function slipFailureAdvice(reasons: readonly string[]): string | null {
  const key = slipFailureKey(reasons);
  return ADVICE.find((entry) => key.includes(entry.match))?.advice ?? null;
}
