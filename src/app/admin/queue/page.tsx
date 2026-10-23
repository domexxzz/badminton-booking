import { LiveRefresh } from "@/components/LiveRefresh";
import { STATUS_LABEL, formatBaht, formatSlot } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type Room = { id: string; booking_id: string; host_name: string; title: string; mode: "singles" | "doubles"; capacity: number; court_id: number; starts_at: string; ends_at: string; status: string; created_at: string };
type Member = { id: string; party_id: string; name: string; slot_no: number; team: "A" | "B"; status: "active" | "left" | "kicked"; joined_at: string; left_at: string | null };
type Booking = { id: string; amount: number; status: string };
const ROOM_STATUS: Record<string, string> = { pending_payment: "รอหัวห้องชำระ", open: "เปิดรับสมาชิก", closed: "จบแล้ว", cancelled: "ยกเลิก" };
const MEMBER_STATUS: Record<string, string> = { active: "อยู่ในห้อง", left: "ออกเอง", kicked: "หัวห้องนำออก" };

export default async function AdminQueuePage() {
  const { supabase } = await getSessionUser();
  const [{ data: rooms, error }, { data: courts }] = await Promise.all([
    supabase.from("party_rooms").select("id, booking_id, host_name, title, mode, capacity, court_id, starts_at, ends_at, status, created_at").order("created_at", { ascending: false }).limit(100).returns<Room[]>(),
    supabase.from("courts").select("id, name"),
  ]);
  if (error) return <p className="error">โหลดประวัติคิวก๊วนไม่สำเร็จ</p>;
  const partyIds = (rooms ?? []).map((r) => r.id);
  const bookingIds = (rooms ?? []).map((r) => r.booking_id);
  const [{ data: members }, { data: bookings }] = await Promise.all([
    partyIds.length ? supabase.from("party_members").select("id, party_id, name, slot_no, team, status, joined_at, left_at").in("party_id", partyIds).order("joined_at").returns<Member[]>() : Promise.resolve({ data: [] as Member[] }),
    bookingIds.length ? supabase.from("bookings").select("id, amount, status").in("id", bookingIds).returns<Booking[]>() : Promise.resolve({ data: [] as Booking[] }),
  ]);
  const courtName = new Map((courts ?? []).map((c) => [c.id, c.name]));
  const bookingById = new Map((bookings ?? []).map((b) => [b.id, b]));
  const openCount = (rooms ?? []).filter((r) => r.status === "open" && new Date(r.ends_at) > new Date()).length;
  const uniquePlayers = new Set((members ?? []).map((m) => m.name)).size;
  return <section className="stack admin-party-page">
    <LiveRefresh table="party_rooms" /><LiveRefresh table="party_members" /><LiveRefresh table="bookings" />
    <div className="page-head"><div><h1>คิวก๊วน</h1><p className="muted">ห้องปัจจุบันและประวัติล่าสุด 100 ห้อง</p></div></div>
    <div className="kpi-grid"><div className="card kpi"><span className="label">ห้องทั้งหมด</span><span className="value">{rooms?.length ?? 0}</span></div><div className="card kpi"><span className="label">กำลังเปิด</span><span className="value">{openCount}</span></div><div className="card kpi"><span className="label">ผู้เล่นในประวัติ</span><span className="value">{uniquePlayers}</span></div></div>
    {!rooms?.length && <div className="card muted">ยังไม่มีประวัติห้องก๊วน</div>}
    {(rooms ?? []).map((room) => {
      const roomMembers = (members ?? []).filter((m) => m.party_id === room.id);
      const booking = bookingById.get(room.booking_id);
      const displayedStatus = room.status === "open" && new Date(room.ends_at) <= new Date() ? "closed" : room.status;
      return <article key={room.id} className="card stack admin-party-card">
        <div className="admin-party-head"><div><span className="badge confirmed">จองแบบก๊วน</span><h2>{room.title}</h2><span className="muted">เลขจอง {room.booking_id.slice(0, 8).toUpperCase()}</span></div><span className={`badge ${booking?.status ?? displayedStatus}`}>{ROOM_STATUS[displayedStatus] ?? displayedStatus}</span></div>
        <div className="admin-party-facts"><div><span>สนามและเวลา</span><strong>{courtName.get(room.court_id) ?? `สนาม ${room.court_id}`}</strong><small>{formatSlot(room.starts_at, room.ends_at)}</small></div><div><span>รายละเอียดห้อง</span><strong>{room.mode === "singles" ? "เดี่ยว 1 ต่อ 1" : "คู่ 2 ต่อ 2"}</strong><small>หัวห้อง: {room.host_name}</small></div><div><span>การชำระเงิน</span><strong>{formatBaht(booking?.amount ?? 0)}</strong><small>{STATUS_LABEL[booking?.status ?? ""] ?? booking?.status ?? "ไม่พบข้อมูล"}</small></div><div><span>สมาชิก</span><strong>{roomMembers.filter((m) => m.status === "active").length}/{room.capacity} คน</strong><small>เคยเข้ารวม {roomMembers.length} รายการ</small></div></div>
        <details className="admin-party-history"><summary>ดูประวัติสมาชิก ({roomMembers.length})</summary>{roomMembers.length === 0 ? <p className="muted">ยังไม่มีสมาชิก</p> : <div>{roomMembers.map((m) => <div key={m.id}><span className="party-slot-no">{m.slot_no}</span><strong>{m.name} · ทีม {m.team}</strong><span className={`member-state ${m.status}`}>{MEMBER_STATUS[m.status]}</span><small>เข้า {new Date(m.joined_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })}{m.left_at ? ` · สิ้นสุด ${new Date(m.left_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" })}` : ""}</small></div>)}</div>}</details>
      </article>;
    })}
  </section>;
}
