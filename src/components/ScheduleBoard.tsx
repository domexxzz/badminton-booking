"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CourtOutlineIcon,
  ShuttleIcon,
  UserCircleIcon,
} from "@/components/icons";
import { BOOKING_RULES } from "@/lib/config";
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
  const { occupancy, live, loadError } = useOccupancy(date);

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

      {/* 3. Court Timeline Cards */}
      <div className="schedule-court-list">
        {courts.map((court) => (
          <section key={court.id} className="schedule-court-card" aria-label={court.name}>
            {/* Top row: Court badge icon, name, and chevron arrow */}
            <Link
              href={`/book?court=${court.id}&date=${date}`}
              className="schedule-court-top"
              aria-label={`จอง ${court.name}`}
            >
              <div className="court-badge-icon" aria-hidden="true">
                <CourtOutlineIcon size={24} />
              </div>
              <strong className="court-name">{court.name}</strong>
              <ChevronRight size={20} className="court-chevron" aria-hidden="true" />
            </Link>

            {/* Visual Timeline Bar */}
            <div className="timeline-track-wrap">
              <div className="timeline-track" role="group" aria-label={`ช่วงเวลาของ ${court.name}`}>
                {slots.map((hour) => {
                  const state = cellState(court.id, date, hour, occupancy, now);
                  const isFree = state === "free";
                  return (
                    <button
                      key={hour}
                      type="button"
                      className={`timeline-slot ${state}`}
                      title={`${court.name} ${formatHour(hour)}: ${STATE_LABEL[state]}`}
                      disabled={!isFree}
                      aria-label={`${court.name} ${formatHour(hour)} ${STATE_LABEL[state]}`}
                      onClick={() =>
                        isFree &&
                        router.push(`/book?date=${date}&court=${court.id}&hour=${hour}`)
                      }
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
          </section>
        ))}
      </div>

      {/* 4. Legend Section */}
      <div className="schedule-legend" aria-label="คำอธิบายสถานะ">
        <div className="legend-item">
          <span className="legend-dot dot-free" aria-hidden="true" />
          <span>ว่าง</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-booked" aria-hidden="true" />
          <span>จองแล้ว</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-held" aria-hidden="true" />
          <span>รอชำระ</span>
        </div>
      </div>

      {/* 5. Bottom decorative background wave with 3D shuttlecock */}
      <div className="schedule-bottom-decoration" aria-hidden="true">
        <svg
          className="schedule-swoosh"
          viewBox="0 0 390 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M-20 110 C90 70, 210 100, 410 30 L410 110 Z"
            fill="url(#schedGrad1)"
            opacity="0.22"
          />
          <path
            d="M-20 110 C110 90, 240 60, 410 50 L410 110 Z"
            fill="url(#schedGrad2)"
            opacity="0.28"
          />
          <defs>
            <linearGradient id="schedGrad1" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="100%" stopColor="#007a5e" />
            </linearGradient>
            <linearGradient id="schedGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#86efac" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
        </svg>
        <div className="schedule-shuttle-art">
          <ShuttleIcon size={76} />
        </div>
      </div>
    </div>
  );
}
