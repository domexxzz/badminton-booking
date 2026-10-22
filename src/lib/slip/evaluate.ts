import type { SlipFacts } from "./types";

const MIN_VISIBLE_DIGITS = 4;
const MIN_NAME_CHARS = 3;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type Expectation = {
  amountBaht: number;
  bookingCreatedAt: string;
  now: Date;
  promptPayId: string | null;
  bankAccount: string | null;
  /** Bill-payment receiver (Bangkok Bank Merchant Pro and friends). */
  billerId: string | null;
  receiverNames: string[];
};

export type Evaluation = { status: "verified" | "mismatch"; reasons: string[] };

const digitsOnly = (s: string) => s.replace(/\D/g, "");

/**
 * Banks mask account numbers ("xxx-x-x5678-x"). We only accept a mask with
 * the same length as the real number and enough visible digits, compared
 * position by position; anything less certain goes to a human.
 */
export function maskedMatches(masked: string, actual: string): boolean {
  const m = masked.replace(/[^0-9xX*•]/g, "").replace(/[X*•]/g, "x");
  const a = digitsOnly(actual);
  if (!a || m.length !== a.length) return false;
  if (m.replace(/x/g, "").length < MIN_VISIBLE_DIGITS) return false;
  return [...m].every((c, i) => c === "x" || c === a[i]);
}

/** PromptPay proxy forms of an ID, with the proxy type banks report for it. */
export function promptPayVariants(id: string): { type: string; values: string[] } {
  const d = digitsOnly(id);
  if (d.length === 10 && d.startsWith("0")) {
    return { type: "MSISDN", values: [d, `66${d.slice(1)}`, `0066${d.slice(1)}`] };
  }
  return { type: d.length === 15 ? "EWALLETID" : "NATID", values: [d] };
}

const NAME_TITLES = /^(นาย|นางสาว|นาง|น\.ส\.|mr\.?|mrs\.?|ms\.?|miss)\s*/i;
const normalizeName = (n: string) => n.trim().replace(NAME_TITLES, "").replace(/[\s.]/g, "").toLowerCase();

/** Slip names are truncated ("นาย สมชาย ใ"), so one must be a prefix of the other. */
export function nameMatches(slipName: string, configured: string): boolean {
  const s = normalizeName(slipName);
  const c = normalizeName(configured);
  if (s.length < MIN_NAME_CHARS || c.length < MIN_NAME_CHARS) return false;
  return c.startsWith(s) || s.startsWith(c);
}

/** Paying a merchant QR names a biller, not an account: "BILLERID" + a masked biller ID. */
const BILLER_ID_TYPE = "BILLERID";

function accountMatches(slip: SlipFacts, exp: Expectation): boolean {
  const { proxyType, proxyAccount, bankAccount } = slip.receiver;
  if (proxyAccount && proxyType === BILLER_ID_TYPE && exp.billerId) {
    if (maskedMatches(proxyAccount, exp.billerId)) return true;
  }
  if (proxyAccount && proxyType && exp.promptPayId) {
    const expected = promptPayVariants(exp.promptPayId);
    if (proxyType === expected.type && expected.values.some((v) => maskedMatches(proxyAccount, v))) return true;
  }
  return Boolean(bankAccount && exp.bankAccount && maskedMatches(bankAccount, exp.bankAccount));
}

function receiverReasons(slip: SlipFacts, exp: Expectation): string[] {
  const hasAccount = exp.promptPayId !== null || exp.bankAccount !== null || exp.billerId !== null;
  if (exp.receiverNames.length === 0 || !hasAccount) {
    return ["ยังไม่ได้ตั้งค่าชื่อ/บัญชีผู้รับ (SLIP_RECEIVER_NAME, PROMPTPAY_ID) จึงตรวจผู้รับอัตโนมัติไม่ได้"];
  }
  const shownAccount = slip.receiver.proxyAccount ?? slip.receiver.bankAccount ?? "ไม่ระบุบัญชี";
  const shownName = slip.receiver.names[0] ?? "ไม่ทราบชื่อ";
  const reasons: string[] = [];
  if (!accountMatches(slip, exp)) reasons.push(`บัญชีผู้รับไม่ตรงกับร้าน (${shownAccount})`);
  if (!slip.receiver.names.some((n) => exp.receiverNames.some((c) => nameMatches(n, c)))) {
    reasons.push(`ชื่อผู้รับไม่ตรงกับร้าน (${shownName})`);
  }
  return reasons;
}

export function evaluateSlip(slip: SlipFacts, exp: Expectation): Evaluation {
  const reasons: string[] = [];

  if (Math.round(slip.amount * 100) !== Math.round(exp.amountBaht * 100)) {
    reasons.push(`ยอดในสลิป ฿${slip.amount.toFixed(2)} ไม่ตรงกับยอดที่ต้องชำระ ฿${exp.amountBaht.toFixed(2)}`);
  }

  reasons.push(...receiverReasons(slip, exp));

  const paidAt = Date.parse(slip.date);
  if (Number.isNaN(paidAt)) {
    reasons.push("อ่านวันเวลาโอนในสลิปไม่ได้");
  } else if (paidAt < Date.parse(exp.bookingCreatedAt) - CLOCK_SKEW_MS) {
    reasons.push("สลิปโอนก่อนเวลาจอง อาจเป็นสลิปเก่า");
  } else if (paidAt > exp.now.getTime() + CLOCK_SKEW_MS) {
    reasons.push("วันเวลาในสลิปอยู่ในอนาคต");
  }

  return { status: reasons.length === 0 ? "verified" : "mismatch", reasons };
}
