// Maps the error codes raised by the SQL RPCs to messages for customers.
const MESSAGES: Record<string, string> = {
  NOT_AUTHENTICATED: "กรุณาเข้าสู่ระบบก่อน",
  INVALID_DURATION: "จำนวนชั่วโมงไม่ถูกต้อง",
  INVALID_START: "เวลาเริ่มต้องตรงชั่วโมง",
  START_IN_PAST: "ช่วงเวลานี้ผ่านไปแล้ว",
  TOO_FAR_AHEAD: "จองล่วงหน้าได้ไม่เกิน 14 วัน",
  OUTSIDE_OPENING_HOURS: "อยู่นอกเวลาเปิดสนาม (09:00–23:00)",
  COURT_NOT_FOUND: "ไม่พบสนามนี้",
  TOO_MANY_HOLDS: "คุณมีการจองที่ยังไม่ยืนยันครบ 3 รายการแล้ว กรุณาชำระ รอแอดมินตรวจสลิป หรือยกเลิกก่อน",
  SLOT_TAKEN: "ช่วงเวลานี้มีคนจองไปแล้ว กรุณาเลือกเวลาอื่น",
  BOOKING_NOT_FOUND: "ไม่พบการจองนี้",
  INVALID_STATUS: "สถานะการจองไม่สามารถทำรายการนี้ได้",
  HOLD_EXPIRED: "หมดเวลาชำระเงินแล้ว กรุณาจองใหม่",
  INVALID_SLIP: "ไฟล์สลิปไม่ถูกต้อง กรุณาอัปโหลดใหม่",
  FORBIDDEN: "ไม่มีสิทธิ์ทำรายการนี้",
  BUSY_TRY_AGAIN: "ระบบกำลังยุ่ง กรุณาลองใหม่อีกครั้ง",
  TOO_MANY_RECENT_BOOKINGS: "จองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
  INVALID_CHANNEL: "เลือกช่องทางการจองให้ถูกต้อง",
  NAME_REQUIRED: "กรุณาใส่ชื่อลูกค้า",
  REQUEST_PENDING: "มีคำขอที่รอแอดมินอยู่แล้ว รอผลก่อนหรือถอนคำขอเดิม",
  SAME_SLOT: "เลือกเวลาใหม่ที่ต่างจากเดิม",
  INVALID_QR: "แนบรูป QR รับเงินของคุณก่อน",
  REQUEST_NOT_FOUND: "ไม่พบคำขอนี้ หรือมีการตัดสินไปแล้ว",
  REFUND_SLIP_REQUIRED: "แนบสลิปโอนเงินคืนก่อนอนุมัติ",
  CANNOT_REMOVE_SELF: "ถอนสิทธิ์แอดมินของตัวเองไม่ได้ ให้แอดมินคนอื่นทำ",
  LAST_ADMIN: "ต้องมีแอดมินอย่างน้อย 1 คน",
  USER_NOT_FOUND: "ไม่พบผู้ใช้นี้",
  TOO_MANY_SLIP_ATTEMPTS: "ส่งสลิปไม่ผ่านครบ 3 ครั้งแล้ว กรุณาติดต่อแอดมินพร้อมหลักฐานการโอน",
};

export function friendlyError(error: { message?: string } | null | undefined): string {
  const code = error?.message?.trim() ?? "";
  if (MESSAGES[code]) return MESSAGES[code];
  console.error("Unexpected booking error:", error);
  return "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}
