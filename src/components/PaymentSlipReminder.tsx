"use client";

import { useState } from "react";
import { Modal } from "./Modal";

/** Reminds customers to upload the transfer slip when the payment page opens. */
export function PaymentSlipReminder() {
  const [open, setOpen] = useState(true);

  if (!open) return null;

  const close = () => setOpen(false);

  return (
    <Modal
      tone="info"
      title="อย่าลืมแนบสลิป"
      onClose={close}
      actions={
        <button type="button" className="btn btn-block" onClick={close}>
          รับทราบ
        </button>
      }
    >
      <p>หลังโอนเงินแล้ว กรุณาบันทึกสลิปและแนบที่ช่องด้านล่าง เพื่อให้ระบบยืนยันการจองของคุณ</p>
    </Modal>
  );
}
