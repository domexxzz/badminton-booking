"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CourtArt } from "@/components/CourtArt";
import { CourtRules } from "@/components/CourtRules";
import { CalendarIcon, ClockIcon, CourtIcon, MoonIcon, ReceiptIcon, ShuttleIcon } from "@/components/icons";
import { formatBaht, formatTime } from "@/lib/format";
import { formatHour, getVenueStatus, isActive, type Occupancy, type VenueStatus } from "@/lib/slots";

type Court = {
  id: number;
  name: string;
  price_per_hour: number;
};

type HomeClientViewProps = {
  courts: Court[];
  occupancy: Occupancy[];
  openHour: number;
  closeHour: number;
};

const TODAY_ROWS = 6;
const pad2 = (n: number) => n.toString().padStart(2, "0");

export function HomeClientView({
  courts,
  occupancy,
  openHour,
  closeHour,
}: HomeClientViewProps) {
  const [now, setNow] = useState(() => new Date());

  // Live timer ticks every 1000ms (1 second) to keep countdown and status reactive
  useEffect(() => {
    const id = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const status: VenueStatus = getVenueStatus(now, openHour, closeHour);
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const todayQueue = occupancy.filter((o) => isActive(o, now)).slice(0, TODAY_ROWS);
  const minPrice = Math.min(...courts.map((c) => c.price_per_hour));

  const targetDateParam = `date=${status.targetDateStr}`;

  return (
    <>
      {status.isOpen ? (
        /* Daytime Open Banner */
        <section className="banner">
          <div className="banner-badge-wrap">
            <span className="open-live-badge">
              <span className="pulse-dot green" />
              เปิดให้บริการอยู่
            </span>
          </div>
          <h2>จองสนามแบดได้ใน 1 นาที</h2>
          <p>
            {courts.length} สนาม · {formatBaht(minPrice)}/ชม. · เปิด {formatHour(openHour)}–{formatHour(closeHour)} น.
          </p>
          <Link
            href="/book"
            className="btn btn-sm btn-banner-cta"
            style={{ marginTop: 14, background: "#fff", color: "var(--primary-strong)", fontWeight: 600, boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}
          >
            🏸 จองสนามเลย
          </Link>
          <ShuttleIcon size={110} className="shuttle" />
        </section>
      ) : (
        /* Nighttime / Closed Hybrid Banner */
        <section className="banner-closed">
          <div className="closed-badge-row">
            <span className="closed-live-badge">
              <span className="pulse-dot red" />
              ปิดให้บริการแล้ววันนี้
            </span>
            <span className="closed-hours-tag">
              เวลาทำการ {formatHour(openHour)}–{formatHour(closeHour)} น.
            </span>
          </div>

          <div className="closed-hero-head">
            <h2 className="closed-title">
              <MoonIcon size={24} className="closed-title-icon" />
              ถึงเวลาปิดร้านแล้วครับ
            </h2>
            <p className="closed-desc">
              วันนี้สนามปิดทำการแล้ว ขอความกรุณาจองสนามสำหรับวันถัดไปได้เลยครับ
            </p>
          </div>

          {/* Countdown Timer */}
          <div className="countdown-card">
            <div className="countdown-header">
              <ClockIcon size={16} />
              <span>เปิดให้บริการรอบถัดไปในอีก</span>
            </div>
            <div className="countdown-boxes">
              <div className="countdown-box">
                <strong>{pad2(status.remainingHours)}</strong>
                <span>ชั่วโมง</span>
              </div>
              <span className="countdown-sep">:</span>
              <div className="countdown-box">
                <strong>{pad2(status.remainingMinutes)}</strong>
                <span>นาที</span>
              </div>
              <span className="countdown-sep">:</span>
              <div className="countdown-box">
                <strong>{pad2(status.remainingSeconds)}</strong>
                <span>วินาที</span>
              </div>
            </div>
            <div className="countdown-next-note">
              ✨ เปิดบริการ: {status.isTodayClosed ? "วันพรุ่งนี้" : "วันนี้"} เวลา {formatHour(openHour)}:00 น.
            </div>
          </div>

          {/* Action buttons */}
          <div className="closed-action-buttons">
            <Link
              href={`/book?${targetDateParam}`}
              className="btn btn-block btn-book-tomorrow"
            >
              📅 จองสนามวันพรุ่งนี้
            </Link>
            <Link
              href={`/schedule?${targetDateParam}`}
              className="btn btn-ghost btn-block btn-sm"
              style={{ color: "#e2e8f0", borderColor: "rgba(255,255,255,0.2)" }}
            >
              ดูตารางคิววันพรุ่งนี้
            </Link>
          </div>

          <MoonIcon size={120} className="closed-bg-moon" />
        </section>
      )}

      {/* Quick Actions */}
      <section className="quick-actions" aria-label="เมนูลัด">
        <Link href={status.isOpen ? "/book" : `/book?${targetDateParam}`} className="quick">
          <span className="icon"><CourtIcon /></span>
          {status.isOpen ? "จองสนาม" : "จองวันพรุ่งนี้"}
        </Link>
        <Link href={status.isOpen ? "/schedule" : `/schedule?${targetDateParam}`} className="quick">
          <span className="icon"><CalendarIcon /></span>
          ตารางคิว
        </Link>
        <Link href="/me" className="quick">
          <span className="icon"><ReceiptIcon /></span>
          การจองของฉัน
        </Link>
      </section>

      {/* Today's Queue */}
      <section>
        <div className="section-head">
          <h2>{status.isOpen ? "คิววันนี้" : "คิววันนี้ (ร้านปิดแล้ว)"}</h2>
          <Link href={status.isOpen ? "/schedule" : `/schedule?${targetDateParam}`}>
            {status.isOpen ? "ดูทั้งหมด" : "ดูคิววันพรุ่งนี้"}
          </Link>
        </div>

        {!status.isOpen && todayQueue.length === 0 ? (
          <div className="card closed-notice-card">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>🌙</span>
              <strong>สนามปิดบริการสำหรับวันนี้แล้ว</strong>
            </div>
            <span className="muted" style={{ fontSize: 13 }}>
              หมดเวลาทำการ {formatHour(closeHour)}:00 น. คุณสามารถตรวจสอบตารางเวลาและจองสำหรับวันถัดไปได้เลยครับ
            </span>
            <Link
              href={`/schedule?${targetDateParam}`}
              className="link-btn"
              style={{ color: "var(--primary-strong)", fontSize: 13, fontWeight: 600, textAlign: "left", marginTop: 4 }}
            >
              ดูตารางคิววันพรุ่งนี้ →
            </Link>
          </div>
        ) : todayQueue.length === 0 ? (
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

      {/* Our Courts */}
      <section>
        <div className="section-head">
          <h2>สนามของเรา</h2>
        </div>
        <div className="court-cards">
          {courts.map((c) => (
            <div key={c.id} className="court-card">
              <CourtArt label={c.name} />
              <strong>{c.name}</strong>
              <span className="price">{formatBaht(c.price_per_hour)}/ชม.</span>
              <Link
                href={
                  status.isOpen
                    ? `/book?court=${c.id}`
                    : `/book?court=${c.id}&${targetDateParam}`
                }
                className="btn btn-sm btn-block"
              >
                {status.isOpen ? "จองสนามนี้" : "จองวันพรุ่งนี้"}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <CourtRules />
    </>
  );
}
