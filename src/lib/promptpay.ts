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

/** Default Bangkok Bank Merchant Pro QR payload for แบดมินตัน@สินธานี (อัครเนย์ ลาน้ำเที่ยง, ร้านค้า 1077272). */
export const BBL_MERCHANT_PRO_QR =
  "00020101021130820016A000000677010112011501075360003740602150060000010772720320261018I700000000000053037645802TH5907akkanay62240720BED4256284C54781AC086304C8A7";

export const BBL_MERCHANT_INFO = {
  bank: "ธนาคารกรุงเทพ (Bangkok Bank)",
  accountName: "นาย อัครเนย์ ลาน้ำเที่ยง",
  shortName: "อัครเนย์",
  merchantId: "1077272",
  type: "Bangkok Bank Merchant Pro",
} as const;

function parseEmvCoTags(payload: string): { id: string; val: string }[] {
  const tags: { id: string; val: string }[] = [];
  let i = 0;
  while (i < payload.length - 4) {
    const id = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    if (Number.isNaN(len) || i + 4 + len > payload.length) break;
    if (id === "63") break;
    const val = payload.slice(i + 4, i + 4 + len);
    tags.push({ id, val });
    i += 4 + len;
  }
  return tags;
}

function updateEmvCoAmount(rawPayload: string, amount?: number): string {
  const tags = parseEmvCoTags(rawPayload);
  let res = "";
  let addedAmount = false;

  for (const t of tags) {
    if (t.id === "01") {
      res += field("01", amount !== undefined ? "12" : "11");
    } else if (t.id === "54") {
      // Replaced by new amount below
    } else {
      res += field(t.id, t.val);
      if (t.id === "53" && amount !== undefined) {
        res += field("54", amount.toFixed(2));
        addedAmount = true;
      }
    }
  }

  if (!addedAmount && amount !== undefined) {
    res += field("54", amount.toFixed(2));
  }

  const body = res + "6304";
  return body + crc16(body);
}

export function promptPayPayload(rawTarget: string, amount?: number): string {
  if (amount !== undefined && (!Number.isFinite(amount) || amount <= 0)) {
    throw new Error("Amount must be a positive number");
  }

  // If the target is already a complete EMVCo payload (e.g. Bangkok Bank Merchant Pro)
  if (rawTarget.startsWith("000201")) {
    return updateEmvCoAmount(rawTarget, amount);
  }

  const target = parseTarget(rawTarget);
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

