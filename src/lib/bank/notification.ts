// Reads "money in" notifications from Thai bank apps. Formats differ by bank
// and change over time, and parts of a notification (sender name, memo) are
// chosen by whoever sends the money. So this is deliberately strict: it only
// returns an amount when the text can mean exactly one thing. Anything else
// returns amount: null and goes to the admin inbox instead of confirming.

export type Direction = "in" | "out" | "unknown";
export type ParsedNotification = { direction: Direction; amount: number | null };

const INCOMING_WORDS = "เงินเข้า|เงินโอนเข้า|โอนเข้า|รับโอน|รับเงิน|ได้รับเงิน|money in|received|deposit|incoming|transfer in";
const INCOMING = new RegExp(INCOMING_WORDS, "i");
const OUTGOING = /(เงินออก|โอนออก|โอนเงินสำเร็จ|ชำระเงินสำเร็จ|จ่ายเงิน|ถอนเงิน|หักบัญชี|money out|withdraw|payment to|transfer to|debit)/i;

// Text after these markers (to end of line) is written by the sender.
const SENDER_TEXT = /(จาก|ผู้โอน|บันทึก|หมายเหตุ|ข้อความ|\bfrom\b|\bsender\b|\bmemo\b|\bnote\b)[^\n]*/gi;

// Up to 9,999,999.99. Not part of a longer number or date, not a clock time ("18.05 น.").
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3}){1,2}|\d{1,7})\.(\d{2})(?!\d)(?![.,]\d)(?!\s*น\.)`;
const ANY_MONEY = new RegExp(String.raw`(?<![\d.,])${AMOUNT}`, "g");
// The transfer amount must follow a "money in" word directly ("รับโอน 300.37", "Money in: THB 300.37").
const ANCHORED_MONEY = new RegExp(
  String.raw`(?:${INCOMING_WORDS})[\s:]*(?:จำนวน(?:เงิน)?|ยอด(?:เงิน)?|amount|of)?[\s:]*(?:฿|THB|บาท)?\s*${AMOUNT}`,
  "gi",
);

// The only other figures a bank shows next to a transfer, with checks a sender can't fake:
// the balance after money comes in can't be below the amount, and receiving is free.
const BALANCE_LABEL = /(คงเหลือ|ใช้ได้|balance|avail(?:able)?)\s*:?\s*(฿|thb)?\s*$/i;
const FEE_LABEL = /(ค่าธรรมเนียม|fee)\s*:?\s*(฿|thb)?\s*$/i;
const LABEL_CHARS = 24;

const toSatang = (m: RegExpMatchArray) => Number(m[1].replace(/,/g, "")) * 100 + Number(m[2]);

function isExplained(text: string, m: RegExpMatchArray, amount: number): boolean {
  const value = toSatang(m);
  const label = text.slice(Math.max(0, m.index! - LABEL_CHARS), m.index);
  if (BALANCE_LABEL.test(label)) return value >= amount;
  if (FEE_LABEL.test(label)) return value === 0;
  return value === amount;
}

export function parseBankNotification(raw: string): ParsedNotification {
  const text = raw.replace(SENDER_TEXT, " ");
  const incoming = INCOMING.test(text);
  const outgoing = OUTGOING.test(text);
  if (!incoming || outgoing) {
    return { direction: outgoing && !incoming ? "out" : "unknown", amount: null };
  }

  // Exactly one amount right after a "money in" word, outside sender text...
  const anchored = [...new Set([...text.matchAll(ANCHORED_MONEY)].map(toSatang))];
  if (anchored.length !== 1) return { direction: "in", amount: null };
  const amount = anchored[0];

  // ...and every figure in the ORIGINAL text (sender text included) is that
  // amount, a plausible balance, or a zero fee. Otherwise it's ambiguous.
  const consistent = [...raw.matchAll(ANY_MONEY)].every((m) => isExplained(raw, m, amount));
  return { direction: "in", amount: consistent ? amount / 100 : null };
}
