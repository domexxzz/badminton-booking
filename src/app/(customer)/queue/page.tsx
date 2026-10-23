import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PartyCreateForm } from "@/components/party/PartyCreateForm";
import { PartyRoomListCard, type PartyRoomListView } from "@/components/party/PartyRoomListCard";
import { ShopContactCard } from "@/components/ShopContactCard";
import { getPublicCourts, getPublicVenueHours } from "@/lib/public-data";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type MyParty = { entry_id: string; party_id: string; slot_no: number; is_host: boolean };
type PartyMemberRow = { entry_id: string; party_id: string; name: string; slot_no: number; joined_at: string };

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string }> }) {
  const { view: rawView, q = "" } = await searchParams;
  const view = rawView === "create" ? "create" : "join";
  const [{ supabase, user, displayName, isPartyHost }, courts, hours] = await Promise.all([getSessionUser(), getPublicCourts(), getPublicVenueHours()]);
  if (!courts) return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  const [{ data: rooms, error: roomError }, mine] = await Promise.all([
    supabase.from("party_room_board").select("party_id, host_name, title, mode, capacity, court_id, starts_at, ends_at").gt("ends_at", new Date().toISOString()).order("starts_at"),
    user ? supabase.rpc("my_party_entries") : Promise.resolve({ data: [] }),
  ]);
  if (roomError) return <p className="error">ระบบห้องก๊วนยังไม่พร้อมใช้งาน กรุณาติดต่อร้าน</p>;
  // Read members only for the rooms on screen. party_member_board keeps a row for every
  // member of every room that has ever run, and PostgREST caps a reply at 1000 rows, so
  // reading it whole quietly drops members of live rooms once enough rooms have finished.
  const roomIds = (rooms ?? []).map((room) => room.party_id);
  const { data: memberRows } = roomIds.length
    ? await supabase.from("party_member_board").select("entry_id, party_id, name, slot_no, joined_at").in("party_id", roomIds).order("slot_no").returns<PartyMemberRow[]>()
    : { data: [] as PartyMemberRow[] };
  const courtNames = new Map(courts.map((c) => [c.id, c.name]));
  const myEntries = (mine.data ?? []) as MyParty[];
  const normalizedQuery = q.trim().toLocaleLowerCase("th");
  const visibleRooms = (rooms ?? []).filter((room) => !normalizedQuery || `${room.title} ${room.host_name} ${courtNames.get(room.court_id) ?? ""}`.toLocaleLowerCase("th").includes(normalizedQuery));
  return <div className="stack party-page">
    <LiveRefresh table="party_room_board" /><LiveRefresh table="party_member_board" />
    <div className="page-head"><div><h1>คิวก๊วน</h1><p className="muted">สร้างห้องหรือเลือกเข้าร่วมก๊วนที่เปิดอยู่</p></div><span className="live"><span className="live-dot on" aria-hidden="true" /> อัปเดตสด</span></div>
    <nav className="party-view-tabs" aria-label="เลือกการใช้งานคิวก๊วน">
      <Link href="/queue?view=create" className={view === "create" ? "active" : ""}><span>＋</span><strong>สร้างห้อง</strong><small>จองสนามและชำระเงิน</small></Link>
      <Link href="/queue?view=join" className={view === "join" ? "active" : ""}><span>♟</span><strong>เข้าห้อง</strong><small>เลือกทีมและสล็อต</small></Link>
      {/* The ladder lives off this page, not in the bottom bar, which is full at five tabs. */}
      <Link href="/leaderboard"><span>🏆</span><strong>อันดับ</strong><small>แต้มสะสมทั้งร้าน</small></Link>
    </nav>
    {view === "create" && (
      !user ? (
        <section className="card stack">
          <h2>เข้าสู่ระบบเพื่อสร้างห้อง</h2>
          <p className="muted">หัวห้องต้องจองสนามและชำระค่าจองเต็มจำนวนก่อนห้องเปิด</p>
          <Link href="/login?next=/queue%3Fview%3Dcreate" className="btn btn-block">
            เข้าสู่ระบบ
          </Link>
        </section>
      ) : isPartyHost ? (
        <PartyCreateForm
          courts={courts}
          defaultName={displayName ?? ""}
          openHour={hours.openHour}
          closeHour={hours.closeHour}
        />
      ) : (
        <section className="card stack" style={{ textAlign: "center", gap: 14 }}>
          <div style={{ fontSize: 44 }} aria-hidden="true">🏸</div>
          <div>
            <h2>ต้องการเปิดห้องก๊วนตีแบด?</h2>
            <p className="muted" style={{ margin: "6px 0 0" }}>
              การสร้างห้องก๊วนสงวนสิทธิ์เฉพาะผู้ใช้ที่ได้รับบทบาทหัวหน้าก๊วน หากต้องการเปิดห้องก๊วน กรุณาโทรติดต่อทางร้าน หรือทักแอดมินเพื่อขอเปิดสิทธิ์การใช้งาน
            </p>
          </div>
          <ShopContactCard title="ติดต่อทางร้านเพื่อเปิดสิทธิ์หัวหน้าก๊วน" />
        </section>
      )
    )}
    {view === "join" && <><form className="party-room-search"><input name="q" defaultValue={q} placeholder="ค้นหาชื่อห้อง เจ้าของห้อง หรือสนาม" /><input type="hidden" name="view" value="join" /><button type="submit" aria-label="ค้นหา"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg></button></form><div className="party-list-head"><h2>ห้องที่เปิดอยู่</h2><span>{visibleRooms.length} ห้อง</span></div>
    {!visibleRooms.length ? <section className="card party-empty"><strong>{q ? "ไม่พบห้องที่ค้นหา" : "ยังไม่มีห้องก๊วนเปิดอยู่"}</strong><span className="muted">{q ? "ลองค้นหาด้วยชื่ออื่น" : "สร้างห้องแรก เลือกสนามและชำระเงินเพื่อเปิด Party ได้เลย"}</span></section> : visibleRooms.map((row) => {
      const room = { ...row, court_name: courtNames.get(row.court_id) ?? "สนาม" } as PartyRoomListView;
      const members = (memberRows ?? []).filter((m) => m.party_id === row.party_id);
      const my = myEntries.find((entry) => entry.party_id === row.party_id);
      return <PartyRoomListCard key={row.party_id} room={room} memberCount={members.length} isMine={Boolean(my)} />;
    })}</>}
  </div>;
}
