"use server";

import { revalidatePath } from "next/cache";
import { notifyNewBooking } from "@/lib/line/notify-shop";
import { friendlyError } from "@/lib/errors";
import { PARTY_CAPACITY, PARTY_NAME_MAX, PARTY_TITLE_MAX, type PartyMode, type PartyPreview, type PartyScoring, type PartyTeam, type PartyVisibility } from "@/lib/party";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validText = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
const validSlot = (slot: unknown) => Number.isInteger(slot) && Number(slot) >= 1 && Number(slot) <= PARTY_CAPACITY;

function refreshParty(partyId?: string) {
  revalidatePath("/queue");
  if (partyId) revalidatePath(`/queue/${partyId}`);
}

export async function createPartyBooking(input: {
  courtId: number; startsAt: string; hours: number; mode: PartyMode; title: string; hostName: string;
  visibility?: PartyVisibility; scoring?: PartyScoring;
}): Promise<ActionResult<{ partyId: string; bookingId: string; joinCode: string | null }>> {
  const visibility = input.visibility ?? "public";
  const scoring = input.scoring ?? "ranked";
  if (!Number.isInteger(input.courtId) || input.courtId < 1 || input.courtId > 99 ||
      !["singles", "doubles"].includes(input.mode) || !validText(input.title, PARTY_TITLE_MAX) ||
      !validText(input.hostName, PARTY_NAME_MAX) || typeof input.hours !== "number" || input.hours < 0.5 ||
      input.hours > 4 || input.hours * 2 !== Math.round(input.hours * 2) || Number.isNaN(Date.parse(input.startsAt)) ||
      !["public", "private"].includes(visibility) || !["ranked", "casual"].includes(scoring)) {
    return { ok: false, error: "ข้อมูลเปิดห้องไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_party_booking", {
    p_court_id: input.courtId, p_starts_at: input.startsAt, p_hours: input.hours,
    p_mode: input.mode, p_title: input.title.trim(), p_host_name: input.hostName.trim(),
    p_visibility: visibility, p_scoring: scoring,
  }).single<{ party_id: string; booking_id: string; join_code: string | null }>();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  refreshParty(data.party_id);
  await notifyNewBooking(data.booking_id);
  return { ok: true, data: { partyId: data.party_id, bookingId: data.booking_id, joinCode: data.join_code } };
}

export async function joinParty(partyId: string, name: string, slotNo: number, team: PartyTeam, code?: string | null): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || !validText(name, PARTY_NAME_MAX) || !validSlot(slotNo) || !["A", "B", "C", "D", "E", "F"].includes(team)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_party", { p_party_id: partyId, p_name: name.trim(), p_slot_no: slotNo, p_team: team, p_code: code ?? null });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

export async function movePartySlot(entryId: string, partyId: string, slotNo: number, team: PartyTeam): Promise<ActionResult> {
  if (!UUID_RE.test(entryId) || !UUID_RE.test(partyId) || !validSlot(slotNo) || !["A", "B", "C", "D", "E", "F"].includes(team)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_party_slot", { p_entry_id: entryId, p_slot_no: slotNo, p_team: team });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

export async function leaveParty(entryId: string, partyId: string): Promise<ActionResult> {
  if (!UUID_RE.test(entryId) || !UUID_RE.test(partyId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_party", { p_entry_id: entryId });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

export async function kickPartyMember(partyId: string, entryId: string): Promise<ActionResult> {
  if (!UUID_RE.test(entryId) || !UUID_RE.test(partyId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("kick_party_member", { p_party_id: partyId, p_entry_id: entryId });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

export async function advancePartyMatch(partyId: string, winner: PartyTeam | null): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || (winner !== null && !["A", "B", "C", "D", "E", "F"].includes(winner))) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_party_match", { p_party_id: partyId, p_winner: winner });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

/** The host decides how many games in a row one side may hold the court. */
export async function setPartyMatchRules(partyId: string, winStreakCap: number): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || !Number.isInteger(winStreakCap) || winStreakCap < 1 || winStreakCap > 10) {
    return { ok: false, error: friendlyError({ message: "INVALID_STREAK_CAP" }) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_party_match_rules", { p_party_id: partyId, p_win_streak_cap: winStreakCap });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

export async function advanceSinglesMatch(partyId: string, winnerEntry: string | null): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || (winnerEntry !== null && !UUID_RE.test(winnerEntry))) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_singles_match", { p_party_id: partyId, p_winner_entry: winnerEntry });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

/** What a room code opens, so the player sees where they are going before joining. */
export async function findPartyByCode(code: string): Promise<ActionResult<PartyPreview>> {
  if (typeof code !== "string" || code.replace(/[^A-Za-z0-9]/g, "").length !== 6) {
    return { ok: false, error: friendlyError({ message: "WRONG_PARTY_CODE" }) };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("find_party_by_code", { p_code: code }).single<PartyPreview>();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  return { ok: true, data };
}

/** Drop the player into a public room of the kind they asked for. */
export async function autoJoinParty(
  mode: PartyMode, scoring: PartyScoring, name: string,
): Promise<ActionResult<{ partyId: string }>> {
  if (!["singles", "doubles"].includes(mode) || !["ranked", "casual"].includes(scoring) || !validText(name, PARTY_NAME_MAX)) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("auto_join_party", {
    p_mode: mode, p_scoring: scoring, p_name: name.trim(),
  });
  if (error || !data) return { ok: false, error: friendlyError(error) };
  refreshParty(String(data));
  return { ok: true, data: { partyId: String(data) } };
}

/** Hand the room to another member. Only the host may do this. */
export async function transferPartyHost(partyId: string, entryId: string): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || !UUID_RE.test(entryId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_party_host", { p_party_id: partyId, p_entry_id: entryId });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

/** Let another member run the night (call winners, set the rules) without owning the room. */
export async function setPartyModerator(partyId: string, entryId: string, isModerator: boolean): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || !UUID_RE.test(entryId) || typeof isModerator !== "boolean") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_party_moderator", {
    p_party_id: partyId, p_entry_id: entryId, p_is_moderator: isModerator,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}
