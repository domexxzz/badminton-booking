"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createBooking } from "@/app/actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht, formatDayLong } from "@/lib/format";
import { cellState, formatHour, maxBookableHours, openingSlots, slotStart, upcomingDates } from "@/lib/slots";
import { DatePills } from "./DatePills";
import { ChevronDown } from "./icons";
import { useOccupancy } from "./useOccupancy";

type Court = { id: number; name: string; price_per_hour: number };
type Initial = { date?: string; court?: number; hour?: number };

const CLOCK_TICK_MS = 30_000;

export function BookingForm({
  courts,
  isLoggedIn,
  bookerName,
  initial,
  openHour = BOOKING_RULES.openHour,
  closeHour = BOOKING_RULES.closeHour,
}: {
  courts: Court[];
  isLoggedIn: boolean;
  bookerName: string | null;
  initial: Initial;
  openHour?: number;
  closeHour?: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const dates = upcomingDates(now, BOOKING_RULES.maxDaysAhead);
  const [date, setDate] = useState(initial.date && dates.includes(initial.date) ? initial.date : dates[0]);
  const [courtId, setCourtId] = useState(courts.some((c) => c.id === initial.court) ? initial.court! : courts[0]?.id);
  const [hour, setHour] = useState<number | null>(initial.hour ?? null);
  const [hours, setHours] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { occupancy } = useOccupancy(date);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const maxHours = hour === null ? 0 : maxBookableHours(courtId, date, hour, occupancy, now, 0.5, closeHour);

  // Someone else took the chosen time (ignore our own booking arriving over realtime).
  useEffect(() => {
    if (hour === null || pending) return;
    if (maxHours === 0) {
      setHour(null);
      setError("เวลาที่เลือกเพิ่งถูกจองไป กรุณาเลือกใหม่");
    } else if (hours > maxHours) {
      setHours(maxHours);
    }
  }, [hour, hours, maxHours, pending]);

  const court = courts.find((c) => c.id === courtId);
  const total = court && hour !== null ? Math.round(court.price_per_hour * hours) : 0;

  function changeDate(next: string) {
    setDate(next);
    setHour(null);
    setError(null);
  }

  function changeCourt(next: number) {
    setCourtId(next);
    setHour(null);
    setError(null);
  }

  function book() {
    if (hour === null || !court) return;
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(`/book?date=${date}&court=${court.id}&hour=${hour}`)}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createBooking({ courtId: court.id, startsAt: slotStart(date, hour), hours });
      if (result.ok) router.push(`/bookings/${result.data.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className="stack">
      <h1>จองสนาม</h1>

      <section className="card stack">
        <div className="field">
          <span>วันที่</span>
          <DatePills dates={dates} value={date} onChange={changeDate} />
        </div>

        <label className="field">
          <span>สนาม</span>
          <div className="select-wrap">
            <select value={courtId} onChange={(e) => changeCourt(Number(e.target.value))}>
              {courts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {formatBaht(c.price_per_hour)}/ชม. ({formatBaht(c.price_per_hour / 2)}/30 นาที)
                </option>
              ))}
            </select>
            <ChevronDown size={18} />
          </div>
        </label>

        <div className="field">
          <span>เวลาเริ่ม</span>
          <div className="chip-grid">
            {openingSlots(0.5, openHour, closeHour).map((h) => {
              const free = cellState(courtId, date, h, occupancy, now) === "free";
              const inRange = hour !== null && h > hour && h < hour + hours;
              const cls = h === hour ? "selected" : inRange ? "in-range" : free ? "free" : "unavailable";
              return (
                <button
                  key={h}
                  type="button"
                  className={`chip ${cls}`}
                  disabled={!free && h !== hour && !inRange}
                  aria-pressed={h === hour}
                  aria-label={`${formatHour(h)} ${free ? "ว่าง" : "ไม่ว่าง"}`}
                  onClick={() => {
                    setError(null);
                    setHour(h);
                    const maxH = maxBookableHours(courtId, date, h, occupancy, now, 0.5, closeHour);
                    setHours(maxH >= 1 ? 1 : maxH >= 0.5 ? 0.5 : 0.5);
                  }}
                >
                  {formatHour(h).replace(":", ".")}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <span>ระยะเวลา</span>
          <div className="hours" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((h) => (
              <button
                key={h}
                type="button"
                className={`chip ${h === hours ? "selected" : h <= maxHours ? "free" : "unavailable"}`}
                disabled={hour === null || h > maxHours}
                onClick={() => setHours(h)}
              >
                {h === 0.5 ? "30 นาที" : `${h} ชม.`}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack" aria-live="polite">
        <div className="summary-line">
          <span className="muted">ผู้จอง</span>
          <span>{isLoggedIn ? (bookerName ?? "บัญชีของคุณ") : "ยังไม่ได้เข้าสู่ระบบ"}</span>
        </div>
        <div className="summary-line">
          <span className="muted">วันเวลา</span>
          <span>
            {hour === null
              ? "เลือกเวลาเริ่ม"
              : `${formatDayLong(date)} ${formatHour(hour)}–${formatHour(hour + hours)}`}
          </span>
        </div>
        <div className="summary-total">
          <span>รวม</span>
          <span>{hour === null ? "–" : formatBaht(total)}</span>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-block" type="button" onClick={book} disabled={hour === null || pending}>
          {pending ? "กำลังจอง…" : isLoggedIn ? "จองและชำระเงิน" : "เข้าสู่ระบบเพื่อจอง"}
        </button>
      </section>
    </div>
  );
}
