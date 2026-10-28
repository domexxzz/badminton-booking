"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addComment,
  deleteComment,
  deletePost,
  editPost,
  reportContent,
  toggleLike,
} from "@/app/community-actions";
import {
  COMMENT_MAX,
  POST_MAX,
  REPORT_MAX,
  communityMediaUrl,
  isVideoMedia,
} from "@/lib/community";
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
  is_admin_post?: boolean | null;
  expires_at?: string | null;
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
  new Date(iso).toLocaleDateString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
  });

function getExpiryLabel(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "⏳ 7 วัน";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "⏳ หมดอายุแล้ว";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days >= 1) return `⏳ เหลืออีก ${days} วัน`;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours >= 1) return `⏳ เหลืออีก ${hours} ชม.`;
  return "⏳ ใกล้หมดอายุ";
}

/**
 * One post, its media, comments, and actions: like, reply, edit, delete, or report.
 * Admins can delete and edit any post, and admin posts are permanent.
 */
export function PostCard({
  post,
  comments,
  myKey,
  liked,
  postingOpen,
  isAdmin = false,
}: {
  post: FeedPost;
  comments: FeedComment[];
  myKey: string | null;
  liked: boolean;
  postingOpen: boolean;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editBodyText, setEditBodyText] = useState(post.body);
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const [pending, startTransition] = useTransition();

  const mine = myKey !== null && post.author_key === myKey;
  const canModify = mine || isAdmin;
  const mediaUrl = communityMediaUrl(post.image_path);
  const isVideo = isVideoMedia(post.image_path);

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

  function handleSaveEdit() {
    if (!editBodyText.trim()) {
      setError("ข้อความต้องไม่ว่างเปล่า");
      return;
    }
    run(() => editPost(post.post_id, editBodyText), () => setIsEditing(false));
  }

  return (
    <article className={`card community-post ${post.is_admin_post ? "is-admin-card" : ""}`}>
      <header className="community-post-head">
        <Avatar url={post.avatar_url} name={post.author_name} />
        <div className="community-post-head-info">
          <div className="community-post-title-row">
            <strong>
              {post.author_name}
              {mine && <i>คุณ</i>}
            </strong>
            {post.is_admin_post ? (
              <span className="community-post-tag admin">👑 แอดมิน · 📌 โพสต์ถาวร</span>
            ) : (
              <span className="community-post-tag customer" title="โพสต์นี้จะหมดอายุและถูกลบอัตโนมัติ">
                {getExpiryLabel(post.expires_at)}
              </span>
            )}
          </div>
          <small>
            {dayLabel(post.created_at)} {formatTime(post.created_at)} น.
            {post.edited_at && " · แก้ไขแล้ว"}
            {post.party_title && ` · จาก ${post.party_title}`}
          </small>
        </div>
      </header>

      {isEditing ? (
        <div className="community-edit-box">
          <textarea
            value={editBodyText}
            maxLength={POST_MAX}
            rows={3}
            className="community-edit-textarea"
            onChange={(e) => setEditBodyText(e.target.value)}
          />
          <div className="community-edit-actions">
            <small className="muted">{editBodyText.length}/{POST_MAX}</small>
            <div className="community-edit-buttons">
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={pending}
                onClick={() => {
                  setEditBodyText(post.body);
                  setIsEditing(false);
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={pending || !editBodyText.trim()}
                onClick={handleSaveEdit}
              >
                {pending ? "กำลังบันทึก…" : "บันทึก"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="community-post-body">{post.body}</p>
      )}

      {mediaUrl && (
        <div className="community-post-media">
          {isVideo ? (
            <video
              src={mediaUrl}
              controls
              playsInline
              preload="metadata"
              className="community-media-player"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl}
              alt="รูปประกอบโพสต์"
              loading="lazy"
              className="community-media-image"
            />
          )}
        </div>
      )}

      <div className="community-post-actions">
        <button
          type="button"
          className={liked ? "liked" : ""}
          disabled={pending}
          onClick={() => run(() => toggleLike(post.post_id))}
        >
          {liked ? "♥" : "♡"} {post.likes > 0 ? post.likes : "ถูกใจ"}
        </button>

        <button type="button" onClick={() => setOpen((v) => !v)}>
          💬 {post.comments > 0 ? post.comments : "ตอบกลับ"}
        </button>

        {canModify && !isEditing && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setIsEditing(true)}
          >
            ✏️ แก้ไข{isAdmin && !mine ? " (แอดมิน)" : ""}
          </button>
        )}

        {canModify ? (
          <button
            type="button"
            className="action-delete"
            disabled={pending}
            onClick={() =>
              confirm(
                isAdmin && !mine
                  ? "ลบโพสต์นี้ในฐานะแอดมิน?"
                  : "ลบโพสต์นี้?"
              ) && run(() => deletePost(post.post_id))
            }
          >
            🗑️ ลบ{isAdmin && !mine ? " (แอดมิน)" : ""}
          </button>
        ) : (
          <button
            type="button"
            disabled={pending || reported}
            onClick={() => report("post", post.post_id)}
          >
            {reported ? "รายงานแล้ว" : "🚩 รายงาน"}
          </button>
        )}
      </div>

      {open && (
        <div className="community-comments">
          {comments.length === 0 && <p className="muted">ยังไม่มีใครตอบ เป็นคนแรกเลยไหม</p>}
          {comments.map((c) => {
            const mineComment = myKey !== null && c.author_key === myKey;
            const canDeleteComment = mineComment || isAdmin;
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
                    canDeleteComment
                      ? confirm(
                          isAdmin && !mineComment
                            ? "ลบความเห็นนี้ในฐานะแอดมิน?"
                            : "ลบความเห็นนี้?"
                        ) && run(() => deleteComment(c.comment_id))
                      : report("comment", c.comment_id)
                  }
                >
                  {canDeleteComment ? "ลบ" : "รายงาน"}
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
