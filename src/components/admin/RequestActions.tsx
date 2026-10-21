"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resolveRequest } from "@/app/request-actions";
import { ImagePicker, uploadImage } from "../ImagePicker";

/**
 * Approve/reject a customer's request. Approving a cancel needs the refund slip.
 * `refundOnly`: the customer already cancelled; all that is left is the refund.
 */
export function RequestActions({
  requestId,
  bookingId,
  customerId,
  kind,
  refundOnly = false,
}: {
  requestId: string;
  bookingId: string;
  customerId: string;
  kind: "reschedule" | "cancel";
  refundOnly?: boolean;
}) {
  const router = useRouter();
  const [slip, setSlip] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function decide(approve: boolean) {
    if (!approve && !confirm("ไม่อนุมัติคำขอนี้?")) return;
    setBusy(true);
    setError(null);
    let refundSlipPath: string | null = null;
    if (approve && kind === "cancel") {
      if (!slip) {
        setBusy(false);
        return setError("แนบสลิปโอนเงินคืนก่อน");
      }
      refundSlipPath = await uploadImage("refunds", `${customerId}/${bookingId}-refund`, slip);
      if (!refundSlipPath) {
        setBusy(false);
        return setError("อัปโหลดสลิปไม่สำเร็จ ลองใหม่");
      }
    }
    const result = await resolveRequest({ requestId, bookingId, approve, note: note.trim(), refundSlipPath });
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {kind === "cancel" && (
        <ImagePicker
          file={slip}
          onChange={(next, problem) => { setSlip(next); setError(problem); }}
          label="แนบสลิปโอนเงินคืน"
          hint="โอนเข้า QR หรือบัญชีที่ลูกค้าแจ้งด้านบน แล้วแนบสลิปที่นี่"
        />
      )}
      <input
        type="text"
        placeholder="หมายเหตุถึงลูกค้า (ไม่บังคับ)"
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        {!refundOnly && (
          <button type="button" className="btn btn-ghost" onClick={() => decide(false)} disabled={busy}>
            ไม่อนุมัติ
          </button>
        )}
        <button
          type="button"
          className="btn btn-block"
          onClick={() => decide(true)}
          disabled={busy || (kind === "cancel" && !slip)}
        >
          {busy
            ? "กำลังบันทึก…"
            : refundOnly
              ? "โอนคืนแล้ว · ส่งสลิปให้ลูกค้า"
              : kind === "cancel"
                ? "โอนคืนแล้ว · ยกเลิกการจอง"
                : "อนุมัติการเลื่อน"}
        </button>
      </div>
    </div>
  );
}
