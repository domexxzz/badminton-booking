"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { cleanQueueName } from "@/lib/queue";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

// Play queue (คิวก๊วน, migration 0018). The database checks who may do what.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTRY_ACTIONS = new Set(["play", "back", "done", "remove"]);
export type QueueEntryAction = "play" | "back" | "done" | "remove";

const isCourtId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0 && (id as number) < 100;

function refreshQueuePages() {
  revalidatePath("/queue");
  revalidatePath("/admin/queue");
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, error: friendlyError(error) };
  refreshQueuePages();
  return { ok: true, data: null };
}

export async function joinQueue(courtId: number, name: string): Promise<ActionResult> {
  const cleaned = typeof name === "string" ? cleanQueueName(name) : null;
  if (!isCourtId(courtId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  if (!cleaned) return { ok: false, error: friendlyError({ message: "INVALID_NAME" }) };
  return callRpc("join_queue", { p_court_id: courtId, p_name: cleaned });
}

export async function leaveQueue(entryId: string): Promise<ActionResult> {
  if (!UUID_RE.test(entryId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  return callRpc("leave_queue", { p_entry_id: entryId });
}

export async function setCourtQueue(courtId: number, isOpen: boolean, playersPerGame: number): Promise<ActionResult> {
  if (!isCourtId(courtId) || typeof isOpen !== "boolean" || ![2, 3, 4].includes(playersPerGame)) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  return callRpc("set_court_queue", { p_court_id: courtId, p_is_open: isOpen, p_players_per_game: playersPerGame });
}

export async function adminAddToQueue(courtId: number, name: string): Promise<ActionResult> {
  const cleaned = typeof name === "string" ? cleanQueueName(name) : null;
  if (!isCourtId(courtId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  if (!cleaned) return { ok: false, error: friendlyError({ message: "INVALID_NAME" }) };
  return callRpc("admin_add_to_queue", { p_court_id: courtId, p_name: cleaned });
}

/**
 * `seenCalledAt` is the called_at of the game the admin has on screen (null for an
 * empty court). The database refuses the call if the court changed meanwhile, so two
 * staff tapping at once cannot send one group of players off twice.
 */
export async function queueNextGame(courtId: number, seenCalledAt: string | null): Promise<ActionResult> {
  const validSeen = seenCalledAt === null || (typeof seenCalledAt === "string" && !Number.isNaN(Date.parse(seenCalledAt)));
  if (!isCourtId(courtId) || !validSeen) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  return callRpc("queue_next_game", { p_court_id: courtId, p_seen_called_at: seenCalledAt });
}

export async function queueEntryAction(entryId: string, action: QueueEntryAction): Promise<ActionResult> {
  if (!UUID_RE.test(entryId) || !ENTRY_ACTIONS.has(action)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  return callRpc("queue_entry_action", { p_entry_id: entryId, p_action: action });
}
