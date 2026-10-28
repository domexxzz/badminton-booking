"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPost } from "@/app/community-actions";
import {
  COMMUNITY_MEDIA_MIME_TYPES,
  POST_MAX,
  mediaProblem,
} from "@/lib/community";
import { getBrowserClient } from "@/lib/supabase/browser";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Writing a post with optional photo or video, and role-based expiration indication. */
export function PostComposer({
  open,
  displayName,
  userId = "",
  isAdmin = false,
}: {
  open: boolean;
  displayName: string;
  userId?: string;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!file) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [file]);

  if (!open) {
    return (
      <div className="card community-closed">
        <strong>ตอนนี้ปิดรับโพสต์ชั่วคราว</strong>
        <small>ทางร้านปิดไว้ชั่วคราว อ่านโพสต์เดิมได้ตามปกติ</small>
      </div>
    );
  }

  function handleFileSelect(selected: File | null) {
    setError(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const problem = mediaProblem(selected);
    if (problem) {
      setError(problem);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(selected);
  }

  function removeFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadMedia(fileToUpload: File): Promise<string | null> {
    const ext =
      MIME_TO_EXT[fileToUpload.type] ||
      fileToUpload.name.split(".").pop()?.toLowerCase() ||
      "bin";
    const prefix = userId || "player";
    const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: uploadError } = await getBrowserClient()
      .storage.from("community")
      .upload(path, fileToUpload, { contentType: fileToUpload.type });
    if (uploadError) {
      console.error("Community media upload failed:", uploadError);
      return null;
    }
    return path;
  }

  function submit() {
    setError(null);
    if (!body.trim()) return setError("พิมพ์อะไรสักอย่างก่อนนะ");

    startTransition(async () => {
      let imagePath: string | null = null;
      if (file) {
        setUploading(true);
        imagePath = await uploadMedia(file);
        setUploading(false);
        if (!imagePath) {
          setError("อัปโหลดไฟล์รูปภาพหรือวิดีโอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
          return;
        }
      }

      const result = await createPost(body, null, imagePath);
      if (!result.ok) {
        setError(result.error);
      } else {
        setBody("");
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        router.refresh();
      }
    });
  }

  const isVideo = file ? file.type.startsWith("video/") : false;
  const isBusy = pending || uploading;

  return (
    <div className="card stack community-composer">
      <div className="community-composer-head">
        <div>
          <strong>เล่าให้ฟังหน่อย</strong>
          <small>{displayName ? `โพสต์ในชื่อ ${displayName}` : "โพสต์ในชื่อของคุณ"}</small>
        </div>
        {isAdmin ? (
          <span className="community-role-pill admin" title="โพสต์ของแอดมินแสดงผลถาวร">
            👑 โพสต์แอดมิน (ถาวร)
          </span>
        ) : (
          <span className="community-role-pill customer" title="โพสต์ของลูกค้ามีอายุ 7 วัน">
            ⏳ อายุ 7 วัน
          </span>
        )}
      </div>

      <textarea
        value={body}
        maxLength={POST_MAX}
        rows={4}
        placeholder="คืนนี้เป็นยังไงบ้าง เจอคู่สนุกๆ ไหม มีอะไรอยากเล่าให้เพื่อนร่วมก๊วนฟัง"
        onChange={(e) => setBody(e.target.value)}
      />

      {file && previewUrl && (
        <div className="community-media-preview-box">
          <div className="community-media-preview-content">
            {isVideo ? (
              <video
                src={previewUrl}
                controls
                playsInline
                className="community-media-preview-element"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="ตัวอย่างรูปที่จะโพสต์"
                className="community-media-preview-element"
              />
            )}
          </div>
          <div className="community-media-preview-bar">
            <span className="community-media-preview-info">
              {isVideo ? "🎬 วิดีโอ" : "📷 รูปภาพ"}: {file.name} ({formatFileSize(file.size)})
            </span>
            <button
              type="button"
              className="btn btn-sm btn-ghost community-media-remove-btn"
              onClick={removeFile}
              disabled={isBusy}
            >
              ✕ เอาออก
            </button>
          </div>
        </div>
      )}

      <div className="community-composer-foot">
        <div className="community-composer-tools">
          <input
            ref={fileInputRef}
            type="file"
            accept={COMMUNITY_MEDIA_MIME_TYPES.join(",")}
            style={{ display: "none" }}
            onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            className="btn btn-sm btn-ghost community-attach-btn"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            📷 / 🎬 แนบรูปหรือวิดีโอ
          </button>
          <small className="muted">{body.length}/{POST_MAX}</small>
        </div>

        <button
          type="button"
          className="btn btn-sm"
          disabled={isBusy || !body.trim()}
          onClick={submit}
        >
          {uploading
            ? "กำลังอัปโหลด…"
            : pending
            ? "กำลังโพสต์…"
            : "โพสต์"}
        </button>
      </div>

      {isAdmin ? (
        <p className="community-composer-hint admin">
          👑 ในฐานะแอดมิน โพสต์นี้จะแสดงผลถาวร และคุณสามารถแก้ไขหรือลบโพสต์ได้ตลอดเวลา
        </p>
      ) : (
        <p className="community-composer-hint customer">
          ⏳ โพสต์นี้จะแสดงผลในระบบเป็นเวลา 7 วัน (เพื่อความสดใหม่ของหน้าคอมมูนิตี้)
        </p>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
