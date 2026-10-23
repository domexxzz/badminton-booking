"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { COMMENT_MAX, POST_MAX, REPORT_MAX } from "@/lib/community";
import type { ActionResult } from "./actions";

// The community feed (migration 0032). Every rule that matters — who may write, how
// often, and who may hide something — lives in the database, so these only shape input.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const text = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

function refreshFeed() {
  revalidatePath("/community");
  revalidatePath("/admin/community");
}

export async function createPost(body: string, partyId?: string | null, imagePath?: string | null): Promise<ActionResult<{ id: string }>> {
  if (!text(body, POST_MAX)) return { ok: false, error: friendlyError({ message: "INVALID_POST" }) };
  if (partyId != null && !UUID_RE.test(partyId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  if (imagePath != null && typeof imagePath !== "string") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_community_post", {
    p_body: body.trim(), p_party_id: partyId ?? null, p_image_path: imagePath ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: { id: String(data) } };
}

export async function editPost(postId: string, body: string): Promise<ActionResult> {
  if (!UUID_RE.test(postId) || !text(body, POST_MAX)) return { ok: false, error: friendlyError({ message: "INVALID_POST" }) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_community_post", { p_post_id: postId, p_body: body.trim() });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}

export async function deletePost(postId: string): Promise<ActionResult> {
  if (!UUID_RE.test(postId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_community_post", { p_post_id: postId });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}

export async function addComment(postId: string, body: string): Promise<ActionResult> {
  if (!UUID_RE.test(postId) || !text(body, COMMENT_MAX)) return { ok: false, error: friendlyError({ message: "INVALID_POST" }) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_community_comment", { p_post_id: postId, p_body: body.trim() });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  if (!UUID_RE.test(commentId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_community_comment", { p_comment_id: commentId });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}

export async function toggleLike(postId: string): Promise<ActionResult<{ liked: boolean }>> {
  if (!UUID_RE.test(postId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_community_like", { p_post_id: postId });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: { liked: data === true } };
}

/** Anyone signed in can flag something; it lands in the admin queue. */
export async function reportContent(targetType: "post" | "comment", targetId: string, reason: string): Promise<ActionResult> {
  if (!["post", "comment"].includes(targetType) || !UUID_RE.test(targetId) || !text(reason, REPORT_MAX)) {
    return { ok: false, error: friendlyError({ message: "INVALID_REPORT" }) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_community_content", {
    p_target_type: targetType, p_target_id: targetId, p_reason: reason.trim(),
  });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}

/** Admin only, and the database checks that too. */
export async function moderateContent(
  targetType: "post" | "comment", targetId: string, action: "hide" | "restore" | "dismiss", note?: string,
): Promise<ActionResult> {
  if (!["post", "comment"].includes(targetType) || !UUID_RE.test(targetId) || !["hide", "restore", "dismiss"].includes(action)) {
    return { ok: false, error: friendlyError({ message: "INVALID_REPORT" }) };
  }
  const { isAdmin } = await getSessionUser();
  if (!isAdmin) return { ok: false, error: friendlyError({ message: "FORBIDDEN" }) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("moderate_community_content", {
    p_target_type: targetType, p_target_id: targetId, p_action: action, p_note: note?.slice(0, REPORT_MAX) ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}

/** Close the feed to new writing for a while, without a deploy. */
export async function setCommunityPosting(open: boolean): Promise<ActionResult> {
  if (typeof open !== "boolean") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_community_posting", { p_open: open });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshFeed();
  return { ok: true, data: null };
}
