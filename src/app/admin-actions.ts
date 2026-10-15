"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setAdmin(userId: string, isAdmin: boolean): Promise<ActionResult> {
  if (!UUID_RE.test(userId) || typeof isAdmin !== "boolean") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_admin", { p_user_id: userId, p_is_admin: isAdmin });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/admin/team");
  return { ok: true, data: null };
}
