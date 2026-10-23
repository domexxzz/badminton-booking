"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addComment, deleteComment, deletePost, reportContent, toggleLike } from "@/app/community-actions";
import { COMMENT_MAX, REPORT_MAX } from "@/lib/community";
import { formatTime } from "@/lib/format";

export type FeedPost = {
  post_id: string;
  author_key: string;
  author_name: string;
  avatar_url: string | null;
  body: string;
  image_path: string | null;
  party_title: string | null;
  likes: number;
  comments: number;
  created_at: string;
  edited_at: string | null;
};

export type FeedComment = {
  comment_id: string;
  post_id: string;
  author_key: string;
  author_name: string;
  avatar_url: string | null;
  body: string;
  created_at: string;
};

function Avatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" className="community-avatar" />
  ) : (
    <span className="community-avatar initial">{(name || "ผ").trim().charAt(0)}</span>
  );
}

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short" });

/**
 * One post, its comments, and the three things a reader can do with it: like it, reply,
 * or report it. "Mine" is worked out from the public handle, never from an account id.
 */
export function PostCard({
  post,
  comments,
  myKey,
  liked,
  postingOpen,
}: {
  post: FeedPost;
  comments: FeedComment[];
  myKey: string | null;
  liked: boolean;
  postingOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [pending, startTransition] = useTransition();
  const mine = myKey !== null && post.author_key === myKey;

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "เกิดข้อผิดพลาด");
      else {
        after?.();
        router.refresh();
      }
    });
  }

  function report(type: "post" | "comment", id: string) {
    const reason = prompt("บอกหน่อยว่าไม่เหมาะสมตรงไหน ทางร้านจะเข้ามาตรวจสอบ")?.slice(0, REPORT_MAX);
    if (!reason?.trim()) return;
    run(() => reportContent(type, id, reason), () => setReported(true));
  }

  return (
    <article className="card community-post">
      <header className="community-post-head">
        <Avatar url={post.avatar_url} name={post.author_name} />
        <div>
          <strong>{post.author_name}{mine && <i>คุณ</i>}</strong>
          <small>
            {dayLabel(post.created_at)} {formatTime(post.created_at)} น.
            {post.edited_at && " · แก้ไขแล้ว"}
            {post.party_title && ` · จาก ${post.party_title}`}
          </small>
        </div>
      </header>

      <p className="community-post-body">{post.body}</p>

      <div className="community-post-actions">
        <button type="button" className={liked ? "liked" : ""} disabled={pending} onClick={() => run(() => toggleLike(post.post_id))}>
          {liked ? "♥" : "♡"} {post.likes > 0 ? post.likes : "ถูกใจ"}
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          💬 {post.comments > 0 ? post.comments : "ตอบกลับ"}
        </button>
        {mine ? (
          <button type="button" disabled={pending} onClick={() => confirm("ลบโพสต์นี้?") && run(() => deletePost(post.post_id))}>
            ลบ
          </button>
        ) : (
          <button type="button" disabled={pending || reported} onClick={() => report("post", post.post_id)}>
            {reported ? "รายงานแล้ว" : "รายงาน"}
          </button>
        )}
      </div>

      {open && (
        <div className="community-comments">
          {comments.length === 0 && <p className="muted">ยังไม่มีใครตอบ เป็นคนแรกเลยไหม</p>}
          {comments.map((c) => {
            const mineComment = myKey !== null && c.author_key === myKey;
            return (
              <div key={c.comment_id} className="community-comment">
                <Avatar url={c.avatar_url} name={c.author_name} />
                <div>
                  <strong>{c.author_name}</strong>
                  <p>{c.body}</p>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    mineComment
                      ? confirm("ลบความเห็นนี้?") && run(() => deleteComment(c.comment_id))
                      : report("comment", c.comment_id)
                  }
                >
                  {mineComment ? "ลบ" : "รายงาน"}
                </button>
              </div>
            );
          })}

          {postingOpen && (
            <div className="community-reply">
              <input
                value={reply}
                maxLength={COMMENT_MAX}
                placeholder="ตอบกลับ…"
                onChange={(e) => setReply(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending || !reply.trim()}
                onClick={() => run(() => addComment(post.post_id, reply), () => setReply(""))}
              >
                ส่ง
              </button>
            </div>
          )}
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </article>
  );
}
