import Link from "next/link";
import { CourtArt } from "@/components/CourtArt";
import { CourtRules } from "@/components/CourtRules";
import { CalendarIcon, CourtIcon, ReceiptIcon, ShuttleIcon } from "@/components/icons";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht, formatTime } from "@/lib/format";
import { bangkokDate, formatHour, isActive, slotStart, type Occupancy } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TODAY_ROWS = 6;

export default async function HomePage() {
  const { supabase } = await getSessionUser();
  const now = new Date();
  const today = bangkokDate(now);

  const [courts, occupancy] = await Promise.all([
    supabase.from("courts").select("id, name, price_per_hour").eq("is_active", true).order("id"),
    supabase
      .from("court_occupancy")
      .select("booking_id, court_id, starts_at, ends_at, state, hold_expires_at")
      .lt("starts_at", slotStart(today, 24))
      .gt("ends_at", now.toISOString())
      .order("starts_at")
      .returns<Occupancy[]>(),
  ]);

  if (courts.error) {
    console.error("Failed to load courts:", courts.error);
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }

  const courtName = new Map(courts.data.map((c) => [c.id, c.name]));
  const todayQueue = (occupancy.data ?? []).filter((o) => isActive(o, now)).slice(0, TODAY_ROWS);
  const minPrice = Math.min(...courts.data.map((c) => c.price_per_hour));

  return (
    <>
      <section className="banner">
        <h2>จองสนามแบดได้ใน 1 นาที</h2>
        <p>
          {courts.data.length} สนาม · {formatBaht(minPrice)}/ชม. · เปิดทุกวัน {formatHour(BOOKING_RULES.openHour)}–
          {formatHour(BOOKING_RULES.closeHour)}
        </p>
        <Link href="/book" className="btn btn-sm" style={{ marginTop: 12, background: "#fff", color: "#3f9d70" }}>
          จองเลย
        </Link>
        <ShuttleIcon size={110} className="shuttle" />
      </section>

      <section className="quick-actions" aria-label="เมนูลัด">
        <Link href="/book" className="quick">
          <span className="icon"><CourtIcon /></span>
          จองสนาม
        </Link>
        <Link href="/schedule" className="quick">
          <span className="icon"><CalendarIcon /></span>
          ตารางคิว
        </Link>
        <Link href="/me" className="quick">
          <span className="icon"><ReceiptIcon /></span>
          การจองของฉัน
        </Link>
      </section>

      <section>
        <div className="section-head">
          <h2>คิววันนี้</h2>
          <Link href="/schedule">ดูทั้งหมด</Link>
        </div>
        {todayQueue.length === 0 ? (
          <div className="card muted">วันนี้ยังว่างทุกสนาม จองได้เลย</div>
        ) : (
          <table className="queue-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>สนาม</th>
                <th>สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {todayQueue.map((o) => (
                <tr key={o.booking_id}>
                  <td>
                    {formatTime(o.starts_at)}–{formatTime(o.ends_at)}
                  </td>
                  <td>{courtName.get(o.court_id) ?? `สนาม ${o.court_id}`}</td>
                  <td>
                    <span className={`badge ${o.state === "booked" ? "confirmed" : "pending_payment"}`}>
                      {o.state === "booked" ? "จองแล้ว" : "รอชำระ"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2>สนามของเรา</h2>
        </div>
        <div className="court-cards">
          {courts.data.map((c) => (
            <div key={c.id} className="court-card">
              <CourtArt label={c.name} />
              <strong>{c.name}</strong>
              <span className="price">{formatBaht(c.price_per_hour)}/ชม.</span>
              <Link href={`/book?court=${c.id}`} className="btn btn-sm btn-block">
                จองสนามนี้
              </Link>
            </div>
          ))}
        </div>
      </section>

      <CourtRules />
    </>
  );
}
