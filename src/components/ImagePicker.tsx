"use client";

import { useEffect, useState } from "react";
import { SLIP_MAX_BYTES, SLIP_MIME_TYPES } from "@/lib/config";
import { getBrowserClient } from "@/lib/supabase/browser";
import { ReceiptIcon } from "./icons";

const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Checks type and size; returns an error message or null. */
export function imageProblem(file: File): string | null {
  if (!(SLIP_MIME_TYPES as readonly string[]).includes(file.type)) return "รองรับเฉพาะไฟล์ JPG, PNG หรือ WEBP";
  if (file.size > SLIP_MAX_BYTES) return "ไฟล์ใหญ่เกิน 4MB";
  return null;
}

/** Uploads to a private bucket at `<prefix>-<timestamp>.<ext>`; returns the path or null. */
export async function uploadImage(bucket: string, prefix: string, file: File): Promise<string | null> {
  const path = `${prefix}-${Date.now()}.${EXTENSION[file.type]}`;
  const { error } = await getBrowserClient().storage.from(bucket).upload(path, file, { contentType: file.type });
  if (error) {
    console.error(`Upload to ${bucket} failed:`, error);
    return null;
  }
  return path;
}

export function ImagePicker({
  file,
  onChange,
  label,
  hint,
}: {
  file: File | null;
  onChange: (file: File | null, problem: string | null) => void;
  label: string;
  hint: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function choose(next: File | null) {
    if (!next) return onChange(null, null);
    const problem = imageProblem(next);
    onChange(problem ? null : next, problem);
  }

  return (
    <label className={`upload-box ${preview ? "has-file" : ""}`}>
      <input
        type="file"
        accept={SLIP_MIME_TYPES.join(",")}
        onChange={(e) => choose(e.target.files?.[0] ?? null)}
        aria-label={label}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={label} />
      ) : (
        <>
          <span className="icon"><ReceiptIcon size={28} /></span>
          <strong>{label}</strong>
          <span className="muted">{hint}</span>
        </>
      )}
    </label>
  );
}
