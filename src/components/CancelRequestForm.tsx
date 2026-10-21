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
  const [account, setAccount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    if (!file && !account.trim()) return setError("กรุณาแนบ QR หรือกรอกบัญชีรับเงินคืนอย่างใดอย่างหนึ่ง");
    if (!confirm(`ยืนยันยกเลิกการจอง? สนามจะถูกปล่อยให้คนอื่นจองทันที และกู้คืนไม่ได้`)) return;
    setBusy(true);
    setError(null);
    const path = file ? await uploadImage("refunds", `${userId}/${bookingId}-qr`, file) : null;
    if (file && !path) {
      setBusy(false);
      return setError("อัปโหลดรูปไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
    }
    const result = await requestCancel(bookingId, path, reason.trim(), account.trim());
    setBusy(false);
    if (!result.ok) return setError(result.error);
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <ol className="steps">
        <li>แนบ QR รับเงิน หรือกรอกบัญชีรับเงินคืนอย่างใดอย่างหนึ่ง</li>
        <li>กดยกเลิก การจองจะถูกยกเลิกและปล่อยสนามทันที</li>
        <li>ร้านจะโอนคืน {formatBaht(amount)} ตามข้อมูลที่ให้ไว้ และสลิปคืนเงินจะขึ้นในหน้านี้</li>
      </ol>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>ยกเลิกเองได้ถึง {deadlineText}</p>
      <ImagePicker
        file={file}
        onChange={(next, problem) => { setFile(next); setError(problem); }}
        label="แนบ QR รับเงิน (ไม่บังคับเมื่อกรอกบัญชี)"
        hint="JPG / PNG / WEBP ไม่เกิน 4MB"
      />
      <label className="field">
        <span>บัญชีรับเงินคืน (ไม่บังคับเมื่อแนบ QR)</span>
        <textarea
          rows={3}
          maxLength={300}
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          placeholder={"ธนาคาร\nเลขบัญชี\nชื่อเจ้าของบัญชี"}
          aria-describedby="refund-account-hint"
        />
        <span id="refund-account-hint" className="muted">หากไม่มี QR กรุณาระบุธนาคาร เลขบัญชี และชื่อเจ้าของบัญชีให้ร้านโอนคืนได้ถูกต้อง</span>
      </label>
      <label className="field">
        <span>เหตุผล (ไม่บังคับ)</span>
        <textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>ย้อนกลับ</button>
        <button type="button" className="btn btn-danger btn-block" onClick={submit} disabled={(!file && !account.trim()) || busy}>
          {busy ? "กำลังยกเลิก…" : "ยกเลิกการจอง"}
        </button>
      </div>
    </div>
  );
}
