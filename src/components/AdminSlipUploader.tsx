"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminUploadSlipFile } from "@/app/actions";
import { ImagePicker, imageProblem } from "./ImagePicker";
import { Modal } from "./Modal";

/**
 * Slip uploader for admin-created bookings.
 *
 * Unlike the customer SlipUploader which uploads directly from the browser,
 * this component sends the file to a server action that uses the service
 * client (bypasses Storage RLS). This is necessary because admin-created
 * bookings don't belong to the admin user, so browser-side Storage RLS
 * would reject the upload.
 */
export function AdminSlipUploader({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleFile(f: File | null, problem: string | null) {
    setFile(f);
    setFileError(problem);
    setError(null);
    setSuccess(false);
  }

  function upload() {
    if (!file) return;
    startTransition(async () => {
      setError(null);
      // Send file to server action (bypasses Storage RLS via service client)
      const formData = new FormData();
      formData.set("bookingId", bookingId);
      formData.set("file", file);

      const result = await adminUploadSlipFile(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuccess(true);
      setFile(null);
      router.refresh();
    });
  }

  if (success) {
    return (
      <div className="stack" style={{ gap: 8, textAlign: "center", padding: "12px 0" }}>
        <span style={{ fontSize: 28 }}>✅</span>
        <strong>แนบสลิปเรียบร้อย</strong>
        <span className="muted">เก็บสลิปไว้เป็นหลักฐานการชำระของการจองนี้แล้ว</span>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <ImagePicker
        file={file}
        onChange={handleFile}
        label="แนบสลิปการชำระเงิน"
        hint="JPG / PNG ไม่เกิน 4MB (ไม่บังคับ)"
      />
      {fileError && <p className="error">{fileError}</p>}
      {file && (
        <button className="btn" onClick={upload} disabled={pending}>
          {pending ? "กำลังส่งสลิป…" : "📎 แนบสลิป"}
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {pending && (
        <Modal tone="loading" title="กำลังอัปโหลดสลิป…">
          <p>ใช้เวลาไม่กี่วินาที</p>
        </Modal>
      )}
    </div>
  );
}
