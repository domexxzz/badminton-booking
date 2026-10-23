import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PartyRoomCard, type PartyRoomView } from "@/components/party/PartyRoomCard";
import type { PartyMember } from "@/lib/party";
import { getPublicCourts } from "@/lib/public-data";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PartyRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [{ supabase, user, displayName, avatarUrl }, courts] = await Promise.all([getSessionUser(), getPublicCourts()]);
  const [{ data: room }, { data: members }, { data: teamQueue }, { data: matches }, mine] = await Promise.all([
    supabase.from("party_room_board").select("party_id, host_name, title, mode, capacity, court_id, starts_at, ends_at").eq("party_id", id).maybeSingle(),
    supabase.from("party_member_board").select("entry_id, name, slot_no, team, avatar_url").eq("party_id", id).order("slot_no"),
    supabase.from("party_team_queue").select("team, ready_at, queued_at, state").eq("party_id", id).order("queued_at"),
    supabase.from("party_match_board").select("id, round_no, team_a, team_b, winner, status, started_at, ended_at").eq("party_id", id).order("round_no", { ascending: false }).limit(20),
    user ? supabase.rpc("my_party_entries") : Promise.resolve({ data: [] }),
  ]);
  if (!room || !courts) notFound();
  const my = (mine.data ?? []).find((entry: { party_id: string }) => entry.party_id === id) as { entry_id: string; is_host: boolean } | undefined;
  const view = { ...room, court_name: courts.find((c) => c.id === room.court_id)?.name ?? "สนาม" } as PartyRoomView;
  return <><LiveRefresh table="party_room_board" /><LiveRefresh table="party_member_board" /><LiveRefresh table="party_team_queue" /><LiveRefresh table="party_match_board" /><PartyRoomCard room={view} members={(members ?? []) as PartyMember[]} teamQueue={teamQueue ?? []} matchRows={matches ?? []} loggedIn={Boolean(user)} defaultName={displayName ?? ""} myEntry={my?.entry_id ?? null} isHost={my?.is_host ?? false} userAvatar={avatarUrl} /></>;
}
