"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronLeft,
  CourtOutlineIcon,
  UserCircleIcon,
} from "@/components/icons";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht } from "@/lib/format";
import { cellState, formatHour, openingSlots, upcomingDates } from "@/lib/slots";
import { DatePills } from "./DatePills";
import { useOccupancy } from "./useOccupancy";

type Court = { id: number; name: string; price_per_hour: number };

const CLOCK_TICK_MS = 30_000;
const STATE_LABEL = { free: "ว่าง", held: "รอชำระ", booked: "จองแล้ว", past: "เลยเวลา" } as const;

export function ScheduleBoard({
  courts,
  initialDate,
  openHour = BOOKING_RULES.openHour,
  closeHour = BOOKING_RULES.closeHour,
}: {
  courts: Court[];
  initialDate?: string;
  openHour?: number;
  closeHour?: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const dates = upcomingDates(now, BOOKING_RULES.maxDaysAhead);
  const [date, setDate] = useState(initialDate && dates.includes(initialDate) ? initialDate : dates[0]);
  const { occupancy, loadError } = useOccupancy(date);

  // Expanded court state for viewing detailed time slots
  const [expandedCourtId, setExpandedCourtId] = useState<number | null>(null);

  // Re-evaluate past slots and lapsed holds without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const slots = openingSlots(0.5, openHour, closeHour);

  // Generate tick hours every 3 hours (e.g. 09, 12, 15, 18, 21)
  const tickHours: number[] = [];
  for (let h = openHour; h <= closeHour; h += 3) {
    tickHours.push(h);
  }

  function toggleCourt(courtId: number) {
    setExpandedCourtId((prev) => (prev === courtId ? null : courtId));
  }

  return (
    <div className="schedule-view">
      {/* 1. Header with Back Button, Title, and Profile */}
      <header className="schedule-header">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="schedule-back-btn"
          aria-label="ย้อนกลับไปหน้าแรก"
        >
          <ChevronLeft size={22} />
        </button>

        <h1 className="schedule-title">ตารางคิวสนาม</h1>

        <Link href="/me" className="schedule-profile-btn" aria-label="โปรไฟล์">
          <UserCircleIcon size={22} />
        </Link>
      </header>

      {/* 2. Date Selection Pills (Weekday, Date, Month) */}
      <section className="schedule-date-section" aria-label="เลือกวันที่">
        <DatePills dates={dates} value={date} onChange={setDate} />
      </section>

      {loadError && <p className="error">{loadError}</p>}

      {/* 3. Court Timeline Cards (Dropdown to view detailed time slots) */}
      <div className="schedule-court-list">
        {courts.map((court) => {
          const isExpanded = expandedCourtId === court.id;
          return (
            <section
              key={court.id}
              className={`schedule-court-card ${isExpanded ? "expanded" : ""}`}
              aria-label={court.name}
            >
              {/* Top row: Click to expand/collapse detailed time slots */}
              <button
                type="button"
                onClick={() => toggleCourt(court.id)}
                className="schedule-court-top"
                aria-expanded={isExpanded}
              >
                <div className="court-badge-icon" aria-hidden="true">
                  <CourtOutlineIcon size={24} />
                </div>
                <div className="court-title-group">
                  <strong className="court-name">{court.name}</strong>
                  <span className="court-price-sub">
                    {formatBaht(court.price_per_hour)}/ชม. ({formatBaht(Math.round(court.price_per_hour / 2))}/30 นาที)
                  </span>
                </div>
                <span className={`court-expand-arrow ${isExpanded ? "open" : ""}`} aria-hidden="true">
                  <ChevronDown size={22} />
                </span>
              </button>

              {/* Visual Timeline Bar */}
              <div className="timeline-track-wrap">
                <div className="timeline-track" role="group" aria-label={`ช่วงเวลาของ ${court.name}`}>
                  {slots.map((slotH) => {
                    const state = cellState(court.id, date, slotH, occupancy, now);
                    return (
                      <button
                        key={slotH}
                        type="button"
                        className={`timeline-slot ${state}`}
                        title={`${court.name} ${formatHour(slotH)}: ${STATE_LABEL[state]}`}
                        aria-label={`${court.name} ${formatHour(slotH)} ${STATE_LABEL[state]}`}
                        onClick={() => toggleCourt(court.id)}
                      />
                    );
                  })}
                </div>

                {/* Time axis ticks below the track (09, 12, 15, 18, 21) */}
                <div className="timeline-ticks" aria-hidden="true">
                  {tickHours.map((h) => {
                    const pct = ((h - openHour) / (closeHour - openHour)) * 100;
                    return (
                      <span
                        key={h}
                        className="timeline-tick"
                        style={{ left: `${pct}%` }}
                      >
                        {String(h).padStart(2, "0")}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* Expanded In-Depth Time Slots (View & tap to go book) */}
              {isExpanded && (
                <div className="schedule-court-expanded">
                  <div className="expanded-divider" />

                  <div className="field">
                    <div className="row" style={{ marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 13.5 }}>
                        ตารางเวลา ({court.name}) — แตะเวลาที่ว่างเพื่อไปจอง
                      </span>
                    </div>

                    {/* Detailed 30-min Slot Chips */}
                    <div className="chip-grid">
                      {slots.map((h) => {
                        const state = cellState(court.id, date, h, occupancy, now);
                        const free = state === "free";
                        const cls = free
                          ? "free"
                          : state === "held"
                            ? "held"
                            : state === "booked"
                              ? "booked"
                              : "unavailable";
                        const startStr = formatHour(h).replace(":", ".");
                        const endStr = formatHour(h + 0.5).replace(":", ".");
                        const statusText = free
                          ? `– ${endStr}`
                          : state === "held"
                            ? "⏳ รอชำระ"
                            : "🔒 ล็อกแล้ว";

                        return (
                          <button
                            key={h}
                            type="button"
                            className={`chip time-slot ${cls}`}
                            disabled={!free}
                            aria-label={`รอบ ${formatHour(h)} ถึง ${formatHour(h + 0.5)} ${STATE_LABEL[state]}`}
                            onClick={() =>
                              free &&
                              router.push(`/book?date=${date}&court=${court.id}&hour=${h}`)
                            }
                          >
                            <span className="chip-time-start">{startStr}</span>
                            <span className="chip-time-end">{statusText}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Link button to go to booking page */}
                  <div className="multi-court-hint">
                    <span>ต้องการจองสนามนี้ หรือเลือกหลายสนามพร้อมกัน?</span>
                    <Link
                      href={`/book?date=${date}&court=${court.id}`}
                      className="multi-court-link"
                    >
                      ไปที่หน้าจองสนาม →
                    </Link>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* 4. Legend Section */}
      <div className="schedule-legend" aria-label="คำอธิบายสถานะ">
        <div className="legend-item">
          <span className="legend-dot dot-free" aria-hidden="true" />
          <span>ว่าง (จองได้)</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-held" aria-hidden="true" />
          <span>รอชำระ</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-booked" aria-hidden="true" />
          <span>ล็อก</span>
        </div>
      </div>

      {/* 5. Bottom decorative artwork (01.png) */}
      <div className="schedule-bottom-decoration" aria-hidden="true">
        <Image
          src="/brand/01.png"
          alt="Badminton Play Train Be Better"
          width={500}
          height={250}
          className="schedule-bottom-img"
        />
      </div>
    </div>
  );
}
