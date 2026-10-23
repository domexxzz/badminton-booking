"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

// The shop's ladder (migration 0030). The database decides who may change what:
// a player can only ever change their own listing.

/** Put yourself on the shop's ladder, or take yourself off it. */
export async function setLeaderboardVisibility(show: boolean): Promise<ActionResult> {
  if (typeof show !== "boolean") return { ok: false, error: friendlyError({ message: "INVALID_VISIBILITY" }) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_leaderboard_visibility", { p_show: show });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/me");
  revalidatePath("/leaderboard");
  return { ok: true, data: null };
}
