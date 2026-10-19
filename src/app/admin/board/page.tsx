import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { AdminDatePicker } from "@/components/admin/AdminDatePicker";
import { MarkPaidButton } from "@/components/admin/MarkPaidButton";
import { formatBaht, formatTime } from "@/lib/format";
import { bangkokDate, formatHour, openingSlots, slotStart } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";
import { getVenueHours } from "@/lib/venue-settings";

export const dynamic = "force-dynamic";

const SLOT_MS = 30 * 60 * 1000;
const ACTIVE = ["confirmed", "awaiting_review", "pending_payment"];

type Booking = {
  id: string;
  user_id: string;
  court_id: number;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  admin_note: string | null;
  pay_later?: boolean;
  paid_at?: string | null;
};

const isUnpaid = (b: Booking) => b.status === "confirmed" && b.pay_later === true && !b.paid_at;

function cellState(b: Booking): { cls: string; label: string } {
  if (isUnpaid(b)) return { cls: "unpaid", label: "ค้างชำระ" };
  if (b.admin_note?.includes("[จองประจำ]")) return { cls: "regular", label: "🔒 ประจำ" };
  if (b.status === "confirmed") return { cls: "confirmed", label: "จ่ายแล้ว" };
  if (b.status === "awaiting_review") return { cls: "held", label: "รอตรวจสลิป" };
  return { cls: "held", label: "รอชำระ" };
}

/** Courts across, half hours down: who has which court when, for the shop. */
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: param } = await searchParams;
  const today = bangkokDate(new Date());
  const date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today;
  const [{ supabase }, { openHour, closeHour }] = await Promise.all([getSessionUser(), getVenueHours()]);

  const [courts, day] = await Promise.all([
    supabase.from("courts").select("id, name").eq("is_active", true).order("id"),
    supabase
      .from("bookings")
      // "*" so the board still loads before the pay-later columns are migrated.
      .select("*")
      .in("status", ACTIVE)
      .gte("starts_at", slotStart(date, 0))
      .lt("starts_at", slotStart(date, 24))
      .order("starts_at")
      .returns<Booking[]>(),
  ]);
  if (courts.error || day.error) {
    console.error("Board load failed:", courts.error ?? day.error);
    return <p className="error">โหลดตารางไม่สำเร็จ</p>;
  }

  const userIds = [...new Set(day.data.filter((b) => !b.customer_name).map((b) => b.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, display_name, phone").in("id", userIds)
    : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id, p]));
  const nameOf = (b: Booking) => b.customer_name ?? who.get(b.user_id)?.display_name ?? "ลูกค้า";
  const phoneOf = (b: Booking) => b.customer_phone ?? who.get(b.user_id)?.phone ?? null;

  const slots = openingSlots(0.5, openHour, closeHour);
  const dayStart = Date.parse(slotStart(date, openHour));
  const slotIndex = (iso: string) => Math.round((Date.parse(iso) - dayStart) / SLOT_MS);

  // Per court: the booking that starts in each row, and rows a longer booking covers.
  const startsAt = new Map<string, Booking>();
  const covered = new Set<string>();
  for (const b of day.data) {
    const first = Math.max(0, slotIndex(b.starts_at));
    const last = Math.min(slots.length, slotIndex(b.ends_at));
    startsAt.set(`${b.court_id}:${first}`, b);
    for (let i = first + 1; i < last; i++) covered.add(`${b.court_id}:${i}`);
  }

  const unpaid = day.data.filter(isUnpaid);
  const unpaidTotal = unpaid.reduce((sum, b) => sum + Number(b.amount), 0);

  return (
    <>
      <LiveRefresh table="bookings" />
      <AdminDatePicker date={date} today={today} basePath="/admin/board" />

      <section className="stack" style={{ gap: 8 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>ตารางสนาม</h2>
          <span className="muted">{day.data.length} คิว</span>
        </div>
        <div className="board-legend" aria-hidden="true">
          <span className="board-key confirmed">จ่ายแล้ว</span>
          <span className="board-key held">รอชำระ / รอตรวจ</span>
          <span className="board-key unpaid">ชำระภายหลัง (ค้าง)</span>
          <span className="board-key regular">ประจำ</span>
        </div>
        <div className="board-wrap">
          <table className="board">
            <thead>
              <tr>
                <th scope="col">เวลา</th>
                {courts.data.map((c) => (
                  <th key={c.id} scope="col">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slots.map((h, i) => (
                <tr key={h}>
                  <th scope="row">{formatHour(h)}</th>
                  {courts.data.map((c) => {
                    const key = `${c.id}:${i}`;
                    if (covered.has(key)) return null;
                    const b = startsAt.get(key);
                    if (!b) return <td key={key} className="board-free" />;
                    const span = Math.max(1, Math.min(slots.length, slotIndex(b.ends_at)) - i);
                    const state = cellState(b);
                    return (
                      <td key={key} rowSpan={span} className={`board-cell ${state.cls}`}>
                        <Link href={`/bookings/${b.id}`} className="board-link">
                          <strong>{nameOf(b)}</strong>
                          <span>{formatTime(b.starts_at)}–{formatTime(b.ends_at)}</span>
                          <span>{state.label}</span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>ค้างชำระ (ชำระภายหลัง)</h2>
          <strong>{formatBaht(unpaidTotal)}</strong>
        </div>
        {unpaid.length === 0 && <div className="card muted">วันนี้ไม่มียอดค้าง</div>}
        {unpaid.map((b) => (
          <div key={b.id} className="card list-item">
            <div className="meta">
              <strong>{nameOf(b)}</strong>
              <span className="muted">
                {courts.data.find((c) => c.id === b.court_id)?.name} · {formatTime(b.starts_at)}–{formatTime(b.ends_at)}
                {phoneOf(b) && ` · ${phoneOf(b)}`}
              </span>
            </div>
            <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
              <strong>{formatBaht(b.amount)}</strong>
              <MarkPaidButton bookingId={b.id} />
            </div>
          </div>
        ))}
      </section>
    </>
  );
}
