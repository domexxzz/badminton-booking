"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const { occupancy, live, loadError } = useOccupancy(date);

  // Re-evaluate past slots and lapsed holds without a reload.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="stack">
      <div className="row">
        <h1>ตารางคิว</h1>
        <span className="live" title={live ? "อัปเดตทันที" : "กำลังเชื่อมต่อ"}>
          <span className={`live-dot ${live ? "on" : ""}`} /> {live ? "อัปเดตสด" : "กำลังเชื่อมต่อ…"}
        </span>
      </div>

      <DatePills dates={dates} value={date} onChange={setDate} />

      <div className="legend">
        <span><i style={{ background: "var(--surface-2)" }} />ว่าง (แตะเพื่อจอง)</span>
        <span><i className="legend-booked" />🔒 จองแล้ว / ก๊วนประจำ (Non-active)</span>
        <span><i style={{ background: "var(--held)" }} />รอชำระ</span>
      </div>

      {loadError && <p className="error">{loadError}</p>}

      {courts.map((court) => (
        <section key={court.id} className="card court-section">
          <h2>
            {court.name} <span>{formatBaht(court.price_per_hour)}/ชม. ({formatBaht(court.price_per_hour / 2)}/30 นาที)</span>
          </h2>
          <div className="chip-grid">
            {openingSlots(0.5, openHour, closeHour).map((hour) => {
              const state = cellState(court.id, date, hour, occupancy, now);
              return (
                <button
                  key={hour}
                  type="button"
                  className={`chip ${state}`}
                  disabled={state !== "free"}
                  aria-label={`${court.name} ${formatHour(hour)} ${state === "booked" ? "จองแล้ว/ล็อกไว้ (Non-active)" : STATE_LABEL[state]}`}
                  onClick={() => router.push(`/book?date=${date}&court=${court.id}&hour=${hour}`)}
                >
                  {formatHour(hour).replace(":", ".")}
                  {state === "booked" && <span className="chip-lock-icon">🔒</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
