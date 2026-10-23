"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPost } from "@/app/community-actions";
import { POST_MAX } from "@/lib/community";

/** Writing a post. The photo is optional and goes to the player's own folder. */
export function PostComposer({ open, displayName }: { open: boolean; displayName: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div className="card community-closed">
        <strong>ตอนนี้ปิดรับโพสต์ชั่วคราว</strong>
        <small>ทางร้านปิดไว้ชั่วคราว อ่านโพสต์เดิมได้ตามปกติ</small>
      </div>
    );
  }

  function submit() {
    setError(null);
    if (!body.trim()) return setError("พิมพ์อะไรสักอย่างก่อนนะ");
    startTransition(async () => {
      const result = await createPost(body);
      if (!result.ok) setError(result.error);
      else {
        setBody("");
        router.refresh();
      }
    });
  }

  return (
    <div className="card stack community-composer">
      <div className="community-composer-head">
        <strong>เล่าให้ฟังหน่อย</strong>
        <small>{displayName ? `โพสต์ในชื่อ ${displayName}` : "โพสต์ในชื่อของคุณ"}</small>
      </div>
      <textarea
        value={body}
        maxLength={POST_MAX}
        rows={4}
        placeholder="คืนนี้เป็นยังไงบ้าง เจอคู่สนุกๆ ไหม มีอะไรอยากเล่าให้เพื่อนร่วมก๊วนฟัง"
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="community-composer-foot">
        <small>{body.length}/{POST_MAX}</small>
        <button type="button" className="btn btn-sm" disabled={pending || !body.trim()} onClick={submit}>
          {pending ? "กำลังโพสต์…" : "โพสต์"}
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
