import Link from "next/link";
import { CancelButton } from "@/components/CancelButton";
import { LiveRefresh } from "@/components/LiveRefresh";
import { AdminDatePicker } from "@/components/admin/AdminDatePicker";
import { monthBounds, summarizeDay, confirmedRevenue } from "@/lib/admin/summary";
import { CHANNEL_LABEL, STATUS_LABEL, formatBaht, formatTime } from "@/lib/format";
import { bangkokDate, slotStart } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Booking = {
  id: string;
  user_id: string;
  court_id: number;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
  channel: string;
  customer_name: string | null;
  customer_phone: string | null;
  admin_note: string | null;
  payments: { source: string; status: string }[];
};

const ACTIVE = ["confirmed", "awaiting_review", "pending_payment"];
const MONTH_FMT = new Intl.DateTimeFormat("th-TH", { month: "long", timeZone: "Asia/Bangkok" });

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date: param } = await searchParams;
  const { supabase } = await getSessionUser();
  const today = bangkokDate(new Date());
  const date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : today;
  const month = monthBounds(date);

  const [day, monthRows, courts] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, user_id, court_id, starts_at, ends_at, amount, status, channel, customer_name, customer_phone, admin_note, payments(source, status)",
      )
      .in("status", ACTIVE)
      .gte("starts_at", slotStart(date, 0))
      .lt("starts_at", slotStart(date, 24))
      .order("starts_at")
      .returns<Booking[]>(),
    supabase
      .from("bookings")
      .select("status, amount, starts_at, ends_at")
      .eq("status", "confirmed")
      .gte("starts_at", slotStart(month.start, 0))
      .lt("starts_at", slotStart(month.next, 0)),
    supabase.from("courts").select("id, name").eq("is_active", true).order("id"),
  ]);

  if (day.error || monthRows.error || courts.error) {
    console.error("Dashboard load failed:", day.error ?? monthRows.error ?? courts.error);
    return <p className="error">โหลดข้อมูลไม่สำเร็จ</p>;
  }

  // Online bookings carry the customer's profile; phone/LINE/walk-in carry customer_name.
  const userIds = [...new Set(day.data.filter((b) => !b.customer_name).map((b) => b.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, display_name, phone").in("id", userIds)
    : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id, p]));

  const summary = summarizeDay(day.data, courts.data.length);
  const monthRevenue = confirmedRevenue(monthRows.data);
  const monthName = MONTH_FMT.format(new Date(`${date}T12:00:00+07:00`));

  return (
    <>
      <LiveRefresh table="bookings" />
      <AdminDatePicker date={date} today={today} />

      <section className="kpi-grid" aria-label="สรุปยอด">
        <div className="card kpi">
          <span className="label">รายรับ{date === today ? "วันนี้" : "วันนั้น"}</span>
          <span className="value">{formatBaht(summary.revenue)}</span>
          <span className="sub">จากการจองที่ยืนยันแล้ว</span>
        </div>
        <div className="card kpi">
          <span className="label">รายรับเดือน{monthName}</span>
          <span className="value">{formatBaht(monthRevenue)}</span>
          <span className="sub">{monthRows.data.length} การจอง</span>
        </div>
        <div className="card kpi">
          <span className="label">การจอง</span>
          <span className="value">{summary.confirmedCount}</span>
          <span className="sub">{summary.waitingCount > 0 ? `รอชำระ/รอตรวจ ${summary.waitingCount}` : "ยืนยันแล้วทั้งหมด"}</span>
        </div>
        <div className="card kpi">
          <span className="label">ใช้สนาม</span>
          <span className="value">{summary.utilization}%</span>
          <span className="sub">{summary.bookedHours} ชม. จาก {courts.data.length} สนาม</span>
        </div>
      </section>

      <section
        className="card"
        style={{
          background: "linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(59, 130, 246, 0.08))",
          border: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          padding: "14px 16px",
        }}
      >
        <div>
          <strong style={{ fontSize: "1rem", display: "flex", alignItems: "center", gap: 6 }}>
            <span>📊</span> ดูรายงานสถิติและกราฟรายรับอย่างละเอียด
          </strong>
          <span className="muted" style={{ fontSize: "0.85rem", display: "block", marginTop: 2 }}>
            กราฟแท่งรายรับ ยอดจองรายชั่วโมง/วัน/เดือน/ปี และส่งออกข้อมูลเป็น Excel/CSV
          </span>
        </div>
        <Link href="/admin/analytics" className="btn btn-sm btn-primary">
          เปิดแดชบอร์ดรายงาน →
        </Link>
      </section>

      {courts.data.map((court) => {
        const rows = day.data.filter((b) => b.court_id === court.id);
        return (
          <section key={court.id} className="card">
            <h2 style={{ marginBottom: 6 }}>
              {court.name} <span className="muted" style={{ fontWeight: 400 }}>· {rows.length} คิว</span>
            </h2>
            {rows.length === 0 && <p className="muted" style={{ margin: 0 }}>ว่างทั้งวัน</p>}
            {rows.map((b) => {
              const name = b.customer_name ?? who.get(b.user_id)?.display_name ?? "ลูกค้า";
              const phone = b.customer_phone ?? who.get(b.user_id)?.phone ?? null;
              const paidByTransfer = b.payments.some((p) => p.status === "approved" && p.source === "bank_notification");
              return (
                <div key={b.id} className="booking-row">
                  <div className="time">
                    {formatTime(b.starts_at)}
                    <span>{formatTime(b.ends_at)}</span>
                  </div>
                  <div className="who">
                    <strong>{name}</strong>
                    <span className="muted">
                      {CHANNEL_LABEL[b.channel]}
                      {phone && (
                        <>
                          {" · "}
                          <a href={`tel:${phone}`}>{phone}</a>
                        </>
                      )}
                      {paidByTransfer && " · 🏦 เงินเข้าแล้ว"}
                    </span>
                    {b.admin_note && <span className="muted">📝 {b.admin_note}</span>}
                  </div>
                  <div className="right">
                    <span className={`badge ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                    <span className="muted">{formatBaht(b.amount)}</span>
                    <CancelButton bookingId={b.id} label="ยกเลิก" />
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </>
  );
}
