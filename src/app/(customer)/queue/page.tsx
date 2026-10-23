import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PartyCreateForm } from "@/components/party/PartyCreateForm";
import { PartyRoomCard, type PartyRoomView } from "@/components/party/PartyRoomCard";
import { getPublicCourts, getPublicVenueHours } from "@/lib/public-data";
import type { PartyMember } from "@/lib/party";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type MyParty = { entry_id: string; party_id: string; slot_no: number; is_host: boolean };

export default async function QueuePage() {
  const [{ supabase, user, displayName }, courts, hours] = await Promise.all([getSessionUser(), getPublicCourts(), getPublicVenueHours()]);
  if (!courts) return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  const [{ data: rooms, error: roomError }, { data: memberRows }, mine] = await Promise.all([
    supabase.from("party_room_board").select("party_id, host_name, title, mode, capacity, court_id, starts_at, ends_at").gt("ends_at", new Date().toISOString()).order("starts_at"),
    supabase.from("party_member_board").select("entry_id, party_id, name, slot_no, joined_at").order("slot_no"),
    user ? supabase.rpc("my_party_entries") : Promise.resolve({ data: [] }),
  ]);
  if (roomError) return <p className="error">ระบบห้องก๊วนยังไม่พร้อมใช้งาน กรุณาติดต่อร้าน</p>;
  const courtNames = new Map(courts.map((c) => [c.id, c.name]));
  const myEntries = (mine.data ?? []) as MyParty[];
  return <div className="stack party-page">
    <LiveRefresh table="party_room_board" /><LiveRefresh table="party_member_board" />
    <div className="page-head"><div><h1>คิวก๊วน</h1><p className="muted">เปิด Party จองสนาม แล้วเลือกทีมเล่นด้วยกัน</p></div><span className="live"><span className="live-dot on" aria-hidden="true" /> อัปเดตสด</span></div>
    {user ? <PartyCreateForm courts={courts} defaultName={displayName ?? ""} openHour={hours.openHour} closeHour={hours.closeHour} /> : <section className="card stack"><h2>อยากเปิดห้องหรือเข้าร่วม?</h2><p className="muted">เข้าสู่ระบบเพื่อสร้าง Party และเลือกช่องของคุณ</p><Link href="/login?next=/queue" className="btn btn-block">เข้าสู่ระบบ</Link></section>}
    <div className="party-list-head"><h2>ห้องที่เปิดอยู่</h2><span>{rooms?.length ?? 0} ห้อง</span></div>
    {!rooms?.length ? <section className="card party-empty"><strong>ยังไม่มีห้องก๊วนเปิดอยู่</strong><span className="muted">สร้างห้องแรก เลือกสนามและชำระเงินเพื่อเปิด Party ได้เลย</span></section> : rooms.map((row) => {
      const room = { ...row, court_name: courtNames.get(row.court_id) ?? "สนาม" } as PartyRoomView;
      const members = (memberRows ?? []).filter((m) => m.party_id === row.party_id) as PartyMember[];
      const my = myEntries.find((entry) => entry.party_id === row.party_id);
      return <PartyRoomCard key={row.party_id} room={room} members={members} loggedIn={Boolean(user)} defaultName={displayName ?? ""} myEntry={my?.entry_id ?? null} isHost={my?.is_host ?? false} />;
    })}
  </div>;
}
