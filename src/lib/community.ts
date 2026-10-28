// Limits the community feed is built around (migration 0032 & 0035). They live here, not in
// community-actions.ts, because a "use server" file may only export async functions.
// The database enforces the same numbers; these keep the page from letting someone type
// past a limit it already knows about.

export const POST_MAX = 2000;
export const COMMENT_MAX = 500;
export const REPORT_MAX = 300;

/** Per hour, per account — the same ceilings create_community_post() and friends apply. */
export const POSTS_PER_HOUR = 10;
export const COMMENTS_PER_HOUR = 30;

/** Media upload limits and supported formats for the community feed */
export const COMMUNITY_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export const COMMUNITY_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

export const COMMUNITY_MEDIA_MIME_TYPES = [
  ...COMMUNITY_IMAGE_MIME_TYPES,
  ...COMMUNITY_VIDEO_MIME_TYPES,
] as const;

export const COMMUNITY_MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
export const COMMUNITY_MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

/** Checks if a file is an acceptable media file for community posts. */
export function mediaProblem(file: File): string | null {
  const isImage = (COMMUNITY_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
  const isVideo = (COMMUNITY_VIDEO_MIME_TYPES as readonly string[]).includes(file.type);
  if (!isImage && !isVideo) {
    return "รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) หรือวิดีโอ (MP4, WEBM, MOV)";
  }
  if (isImage && file.size > COMMUNITY_MAX_IMAGE_BYTES) {
    return "ไฟล์รูปภาพต้องมีขนาดไม่เกิน 10MB";
  }
  if (isVideo && file.size > COMMUNITY_MAX_VIDEO_BYTES) {
    return "ไฟล์วิดีโอต้องมีขนาดไม่เกิน 50MB";
  }
  return null;
}

/** Determines if a given storage media path represents a video. */
export function isVideoMedia(path: string | null | undefined): boolean {
  if (!path) return false;
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".ogg") ||
    lower.endsWith(".quicktime")
  );
}

/** Generates the public URL for an asset in the public community storage bucket. */
export function communityMediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const baseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${baseUrl}/storage/v1/object/public/community/${path}`;
}
