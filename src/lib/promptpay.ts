// PromptPay QR payload (EMVCo merchant-presented mode, Thai BOT spec).
// Any Thai banking app can scan it and pre-fills the receiver and amount.

const PROMPTPAY_AID = "A000000677010111";
const THB_CURRENCY = "764";
const COUNTRY_TH = "TH";

type Target = { tag: "01" | "02" | "03"; value: string };

function field(id: string, value: string): string {
  return id + value.length.toString().padStart(2, "0") + value;
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), uppercase 4-hex. */
export function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Mobile (10 digits, 0xxxxxxxxx), national/tax ID (13) or e-wallet ID (15). */
export function parseTarget(raw: string): Target {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 15) return { tag: "03", value: digits };
  if (digits.length === 13) return { tag: "02", value: digits };
  if (digits.length === 10 && digits.startsWith("0")) {
    return { tag: "01", value: ("66" + digits.slice(1)).padStart(13, "0") };
  }
  throw new Error("PromptPay ID must be a 10-digit mobile, 13-digit ID or 15-digit e-wallet");
}

export function promptPayPayload(rawTarget: string, amount?: number): string {
  const target = parseTarget(rawTarget);
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error("Amount must be a positive number");
  }

  const merchant = field("00", PROMPTPAY_AID) + field(target.tag, target.value);
  const body =
    field("00", "01") +
    field("01", amount === undefined ? "11" : "12") + // 11 = reusable, 12 = one-time with amount
    field("29", merchant) +
    field("53", THB_CURRENCY) +
    (amount === undefined ? "" : field("54", amount.toFixed(2))) +
    field("58", COUNTRY_TH) +
    "6304";

  return body + crc16(body);
}
