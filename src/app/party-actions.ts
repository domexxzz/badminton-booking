"use server";

import { revalidatePath } from "next/cache";
import { notifyNewBooking } from "@/lib/line/notify-shop";
import { friendlyError } from "@/lib/errors";
import { PARTY_CAPACITY, PARTY_NAME_MAX, PARTY_TITLE_MAX, type PartyMode } from "@/lib/party";
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
}): Promise<ActionResult<{ partyId: string; bookingId: string }>> {
  if (!Number.isInteger(input.courtId) || input.courtId < 1 || input.courtId > 99 ||
      !["singles", "doubles"].includes(input.mode) || !validText(input.title, PARTY_TITLE_MAX) ||
      !validText(input.hostName, PARTY_NAME_MAX) || typeof input.hours !== "number" || input.hours < 0.5 ||
      input.hours > 4 || input.hours * 2 !== Math.round(input.hours * 2) || Number.isNaN(Date.parse(input.startsAt))) {
    return { ok: false, error: "ข้อมูลเปิดห้องไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_party_booking", {
    p_court_id: input.courtId, p_starts_at: input.startsAt, p_hours: input.hours,
    p_mode: input.mode, p_title: input.title.trim(), p_host_name: input.hostName.trim(),
  }).single<{ party_id: string; booking_id: string }>();
  if (error || !data) return { ok: false, error: friendlyError(error) };
  refreshParty(data.party_id);
  await notifyNewBooking(data.booking_id);
  return { ok: true, data: { partyId: data.party_id, bookingId: data.booking_id } };
}

export async function joinParty(partyId: string, name: string, slotNo: number): Promise<ActionResult> {
  if (!UUID_RE.test(partyId) || !validText(name, PARTY_NAME_MAX) || !validSlot(slotNo)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_party", { p_party_id: partyId, p_name: name.trim(), p_slot_no: slotNo });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshParty(partyId); return { ok: true, data: null };
}

export async function movePartySlot(entryId: string, partyId: string, slotNo: number): Promise<ActionResult> {
  if (!UUID_RE.test(entryId) || !UUID_RE.test(partyId) || !validSlot(slotNo)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_party_slot", { p_entry_id: entryId, p_slot_no: slotNo });
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
