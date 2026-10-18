"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestCancel } from "@/app/request-actions";
import { formatBaht } from "@/lib/format";
import { ImagePicker, uploadImage } from "./ImagePicker";

/** Cancel a paid booking before the deadline; the customer attaches their receive-money QR for the refund. */
export function CancelRequestForm({
  bookingId,
  userId,
  amount,
  deadlineText,
  onCancel,
}: {
  bookingId: string;
  userId: string;
  amount: number;
  deadlineText: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file) return;
    if (!confirm(`ยืนยันยกเลิกการจอง? สนามจะถูกปล่อยให้คนอื่นจองทันที และกู้คืนไม่ได้`)) return;
    setBusy(true);
    setError(null);
    const path = await uploadImage("refunds", `${userId}/${bookingId}-qr`, file);
    if (!path) {
      setBusy(false);
      return setError("อัปโหลดรูปไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
    }
    const result = await requestCancel(bookingId, path, reason.trim());
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ol className="steps">
        <li>เปิดแอปธนาคาร เลือก “รับเงิน” / “QR รับเงิน” แล้วบันทึกรูป QR</li>
        <li>แนบรูปนั้นด้านล่าง แล้วกดยกเลิก การจองจะถูกยกเลิกทันที</li>
        <li>ร้านจะโอนคืน {formatBaht(amount)} เข้า QR นี้ และสลิปคืนเงินจะขึ้นในหน้านี้</li>
      </ol>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>ยกเลิกเองได้ถึง {deadlineText}</p>
      <ImagePicker
        file={file}
        onChange={(next, problem) => { setFile(next); setError(problem); }}
        label="แตะเพื่อแนบ QR รับเงินของคุณ"
        hint="JPG / PNG ไม่เกิน 4MB"
      />
      <label className="field">
        <span>เหตุผล (ไม่บังคับ)</span>
        <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>ย้อนกลับ</button>
        <button type="button" className="btn btn-danger btn-block" onClick={submit} disabled={!file || busy}>
          {busy ? "กำลังยกเลิก…" : "ยกเลิกการจอง"}
        </button>
      </div>
    </div>
  );
}
