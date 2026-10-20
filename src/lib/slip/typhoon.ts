import type { ProviderResult, SlipFacts } from "./types";

const TYPHOON_CHAT_URL = "https://api.opentyphoon.ai/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;

function parseThaiDate(text: string): string | null {
  // Matches e.g. "20 ต.ค. 2569", "20/10/2026", "2026-10-20"
  // and time "17:45"
  const timeMatch = text.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
  const timeStr = timeMatch ? `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}` : "00:00";

  // Check YYYY-MM-DD
  const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T${timeStr}:00+07:00`;
  }

  // Check DD/MM/YYYY or DD/MM/YY
  const slashMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slashMatch) {
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;
    if (year > 2500) year -= 543;
    const month = slashMatch[2].padStart(2, "0");
    const day = slashMatch[1].padStart(2, "0");
    return `${year}-${month}-${day}T${timeStr}:00+07:00`;
  }

  // Thai Month lookup
  const thaiMonths: Record<string, string> = {
    "ม.ค": "01", "ก.พ": "02", "มี.ค": "03", "เม.ย": "04", "พ.ค": "05", "มิ.ย": "06",
    "ก.ค": "07", "ส.ค": "08", "ก.ย": "09", "ต.ค": "10", "พ.ย": "11", "ธ.ค": "12",
    "มกราคม": "01", "กุมภาพันธ์": "02", "มีนาคม": "03", "เมษายน": "04",
    "พฤษภาคม": "05", "มิถุนายน": "06", "กรกฎาคม": "07", "สิงหาคม": "08",
    "กันยายน": "09", "ตุลาคม": "10", "พฤศจิกายน": "11", "ธันวาคม": "12",
  };

  for (const [name, mm] of Object.entries(thaiMonths)) {
    const pattern = new RegExp(`(\\d{1,2})\\s*${name}\\.?\\s*(\\d{2,4})`, "i");
    const m = text.match(pattern);
    if (m) {
      const day = m[1].padStart(2, "0");
      let year = parseInt(m[2], 10);
      if (year < 100) year += 2500;
      if (year > 2500) year -= 543;
      return `${year}-${mm}-${day}T${timeStr}:00+07:00`;
    }
  }

  return null;
}

/**
 * Extracts slip details from the OCR text using Typhoon language model.
 */
async function parseSlipWithLLM(
  ocrText: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<{
  isSlip?: boolean;
  transRef: string | null;
  amount: number | null;
  dateStr: string | null;
  senderName: string | null;
  receiverName: string | null;
  receiverAccount: string | null;
  receiverPromptPay: string | null;
  reasonIfNotSlip?: string | null;
} | null> {
  const prompt = `คุณคือระบบตรวจสลิปโอนเงินธนาคารไทย หน้าที่ของคุณคือสกัดข้อมูลสำคัญจากข้อความ OCR อย่างแม่นยำ ห้ามเดา ห้ามมั่ว เอาเฉพาะข้อมูลจริงที่ปรากฏในสลิป

ข้อความ OCR จากรูปภาพ:
"""
${ocrText}
"""

คำสั่ง:
1. พิจารณาว่ารูปนี้มีลักษณะเป็นสลิปโอนเงินธนาคารไทยหรือไม่:
   - สลิปธนาคารไทย (เช่น KBank K+, SCB EASY, Krungthai NEXT, Bangkok Bank, ttb, GSB, เป๋าตัง ฯลฯ) มักมีคำบ่งบอก เช่น "ชำระเงินสำเร็จ", "โอนเงินสำเร็จ", "Successful", จำนวนเงิน, วันที่ทำรายการ, เลขที่รายการ หรือชื่อธนาคาร
   - ข้อควรระวัง: สลิปธนาคารอาจมีรูปภาพโลโก้ร้านค้า รูปโปรไฟล์ผู้รับเงิน หรือรูปอาหารประกอบอยู่ด้วย ถือว่าเป็นสลิปธนาคารปกติ ("isSlip": true)
   - หากเป็นรูปสิ่งของทั่วไป รูปวิว รูปบุคคลเดี่ยวๆ ที่ไม่มีข้อมูลการทำรายการทางธนาคารเลย ให้ระบุ "isSlip": false
2. สกัดข้อมูลสำคัญ:
   - "senderName": ชื่อผู้โอนเงิน (เช่น "น.ส. ณัฐชนันท์ แ" หรือ null)
   - "receiverName": ชื่อผู้รับเงิน หรือชื่อร้านค้า (เช่น "นาง กรรณิการ์ จุลการ" หรือ "ชิคเก้นชีสไก่เขย่า" หรือ null)
   - "amount": ตัวเลขยอดเงินที่โอน เช่น 40.00 (เป็นตัวเลข number เท่านั้น หรือ null ถ้าไม่มี)
   - "dateStr": วันที่และเวลาที่โอน เช่น "16 ก.ย. 69 19:17" (หรือ null)
   - "transRef": รหัสอ้างอิง หรือ Transaction Ref / เลขที่รายการ (หรือ null)

ตอบกลับเป็น JSON เท่านั้นในรูปแบบนี้:
{
  "isSlip": boolean,
  "senderName": "ชื่อผู้โอน",
  "receiverName": "ชื่อผู้รับหรือร้านค้า",
  "amount": 40.00,
  "dateStr": "16 ก.ย. 69 19:17",
  "transRef": "016259191757BQR01652",
  "receiverAccount": "เลขบัญชีผู้รับ (ถ้ามี หรือ null)",
  "receiverPromptPay": "พร้อมเพย์ผู้รับ (ถ้ามี หรือ null)",
  "reasonIfNotSlip": "เหตุผลสั้นๆ ถ้าไม่ใช่สลิป เช่น รูปถ่ายทั่วไป ไม่ใช่สลิปธนาคาร"
}`;

  try {
    const res = await fetchImpl(TYPHOON_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "typhoon-v2.5-30b-a3b-instruct",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    const data = await res.json() as { choices?: [{ message?: { content?: string } }] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("Typhoon LLM parsing failed:", err);
    return null;
  }
}

const TYPHOON_OCR_PROMPT = `Extract all visible text, numbers, dates, amounts, and account details accurately from the bank payment slip.
Instructions:
- Return clean plain text / Markdown containing all visible words, numbers, names, dates, amounts, and transaction references.
- Do not invent or assume any information. Extract only what is visibly printed.
- Do not write elaborate descriptions of photos or logos. Just extract all readable text.`;

/**
 * Uses OpenTyphoon OCR to extract text from a slip image, then evaluates it.
 */
export async function verifyWithTyphoon(
  image: Blob,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderResult> {
  const buffer = Buffer.from(await image.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mimeType = image.type || "image/jpeg";
  const dataUrl = `data:${mimeType};base64,${base64}`;

  let ocrResponse: Response;
  try {
    ocrResponse = await fetchImpl(TYPHOON_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "typhoon-ocr",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: TYPHOON_OCR_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Typhoon OCR request failed:", error);
    return { kind: "error", message: "เชื่อมต่อ OpenTyphoon OCR ไม่ได้" };
  }

  if (!ocrResponse.ok) {
    return { kind: "error", message: `OpenTyphoon OCR ตอบกลับผิดพลาด (HTTP ${ocrResponse.status})` };
  }

  let ocrText = "";
  try {
    const ocrData = await ocrResponse.json() as { choices?: [{ message?: { content?: string } }] };
    ocrText = ocrData.choices?.[0]?.message?.content ?? "";
  } catch {
    return { kind: "error", message: "อ่านผลลัพธ์จาก OpenTyphoon OCR ไม่สำเร็จ" };
  }

  if (!ocrText.trim()) {
    return { kind: "unreadable", message: "รูปที่อัปโหลดไม่ใช่สลิปโอนเงิน หรืออ่านข้อความไม่ได้ กรุณาอัปโหลดสลิปธนาคารจริง" };
  }

  // Use Typhoon LLM to parse structured fields from OCR text
  const extracted = await parseSlipWithLLM(ocrText, apiKey, fetchImpl);
  if (!extracted || extracted.isSlip === false) {
    const reason = extracted?.reasonIfNotSlip || "ไม่ใช่รูปสลิปโอนเงินของธนาคาร";
    return { kind: "unreadable", message: `รูปที่อัปโหลด${reason} กรุณาแนบสลิปธนาคารจริง` };
  }

  if (typeof extracted.amount !== "number" || isNaN(extracted.amount)) {
    return { kind: "unreadable", message: "ไม่พบยอดเงินในสลิป กรุณาอัปโหลดรูปสลิปที่ชัดเจน" };
  }

  const dateIso = (extracted.dateStr && parseThaiDate(extracted.dateStr)) || new Date().toISOString();

  const slip: SlipFacts = {
    transRef: extracted.transRef || `TYPHOON-${Date.now()}`,
    amount: extracted.amount,
    date: dateIso,
    sender: {
      name: extracted.senderName ?? null,
    },
    receiver: {
      names: extracted.receiverName ? [extracted.receiverName] : [],
      bankAccount: extracted.receiverAccount ?? null,
      proxyType: extracted.receiverPromptPay ? "MSISDN" : null,
      proxyAccount: extracted.receiverPromptPay ?? null,
    },
  };

  return {
    kind: "ok",
    slip,
    raw: { ocrText, extracted },
  };
}
