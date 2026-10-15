"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { submitSlip } from "@/app/actions";
import { SLIP_MAX_BYTES, SLIP_MIME_TYPES } from "@/lib/config";
import { getBrowserClient } from "@/lib/supabase/browser";
import { ReceiptIcon } from "./icons";
import { Modal } from "./Modal";

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
// After a successful send the page re-renders with the new status and this
// component goes away; if that takes unusually long, stop the spinner anyway.
const REFRESH_GRACE_MS = 10_000;

export function SlipUploader({ bookingId, userId }: { bookingId: string; userId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(next: File | null) {
    setError(null);
    if (!next) return setFile(null);
    if (!(SLIP_MIME_TYPES as readonly string[]).includes(next.type)) {
      setFile(null);
      return setError("รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP");
    }
    if (next.size > SLIP_MAX_BYTES) {
      setFile(null);
      return setError("ไฟล์ใหญ่เกิน 4MB");
    }
    setFile(next);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    // Upload straight to Storage (RLS limits users to their own folder),
    // then let the server RPC verify the file and move the booking forward.
    const path = `${userId}/${bookingId}-${Date.now()}.${EXTENSION[file.type]}`;
    const { error: uploadError } = await getBrowserClient()
      .storage.from("slips")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      console.error("Slip upload failed:", uploadError);
      setBusy(false);
      setError("อัปโหลดไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
      return;
    }

    const result = await submitSlip(bookingId, path);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.refresh(); // BookingStatusNotice shows the outcome once the new status arrives
    setTimeout(() => setBusy(false), REFRESH_GRACE_MS);
  }

  return (
    <div id="slip-upload" className="stack" style={{ gap: 10 }}>
      <label className={`upload-box ${preview ? "has-file" : ""}`}>
        <input
          type="file"
          accept={SLIP_MIME_TYPES.join(",")}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
          aria-label="เลือกรูปสลิป"
        />
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="ตัวอย่างสลิปที่เลือก" />
        ) : (
          <>
            <span className="icon"><ReceiptIcon size={28} /></span>
            <strong>แตะเพื่อเลือกรูปสลิป</strong>
            <span className="muted">JPG / PNG ไม่เกิน 4MB</span>
          </>
        )}
      </label>
      {preview && <span className="muted" style={{ textAlign: "center" }}>แตะที่รูปเพื่อเปลี่ยนสลิป</span>}
      <button className="btn btn-block" onClick={upload} disabled={!file || busy}>
        ส่งสลิป
      </button>

      {busy && (
        <Modal tone="loading" title="กำลังตรวจสลิป…">
          <p>อย่าเพิ่งปิดหน้านี้ ใช้เวลาไม่กี่วินาที</p>
        </Modal>
      )}
      {error && (
        <Modal
          tone="error"
          title="ส่งสลิปไม่สำเร็จ"
          onClose={() => setError(null)}
          actions={<button className="btn btn-block" onClick={() => setError(null)}>ลองใหม่</button>}
        >
          <p>{error}</p>
        </Modal>
      )}
    </div>
  );
}
