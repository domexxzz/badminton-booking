"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { requestReschedule } from "@/app/request-actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatDayLong } from "@/lib/format";
import { bangkokDate, formatHour, maxBookableHours, openingSlots, upcomingDates } from "@/lib/slots";
import { DatePills } from "./DatePills";
import { ChevronDown } from "./icons";
import { useOccupancy } from "./useOccupancy";

type Court = { id: number; name: string };

/** Pick a new court/day/start for a paid booking of the same length. */
export function RescheduleForm({
  bookingId,
  currentCourtId,
  durationHours,
  courts,
  onCancel,
}: {
  bookingId: string;
  currentCourtId: number;
  durationHours: number;
  courts: Court[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const now = useMemo(() => new Date(), []);
  const dates = useMemo(() => upcomingDates(now, BOOKING_RULES.maxDaysAhead), [now]);
  const [date, setDate] = useState(bangkokDate(now));
  const [courtId, setCourtId] = useState(currentCourtId);
  const [hour, setHour] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { occupancy } = useOccupancy(date);
  // The booking itself is about to move, so its current slot counts as free.
  const others = useMemo(() => occupancy.filter((o) => o.booking_id !== bookingId), [occupancy, bookingId]);

  const fits = (h: number) => maxBookableHours(courtId, date, h, others, now) >= durationHours - 1e-6;

  function submit() {
    if (hour === null) return;
    setError(null);
    startTransition(async () => {
      const result = await requestReschedule({ bookingId, courtId, date, hour });
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <DatePills dates={dates} value={date} onChange={(d) => { setDate(d); setHour(null); }} />
      <label className="field">
        <span>สนาม</span>
        <div className="select-wrap">
          <select value={courtId} onChange={(e) => { setCourtId(Number(e.target.value)); setHour(null); }}>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <ChevronDown size={18} />
        </div>
      </label>
      <div className="field">
        <span>เวลาเริ่มใหม่ (เล่น {durationHours} ชม. เท่าเดิม)</span>
        <div className="chip-grid">
          {openingSlots().map((h) => {
            const ok = fits(h);
            return (
              <button
                key={h}
                type="button"
                className={`chip ${h === hour ? "selected" : ok ? "free" : "unavailable"}`}
                disabled={!ok}
                aria-pressed={h === hour}
                onClick={() => setHour(h)}
              >
                {formatHour(h).replace(":", ".")}
              </button>
            );
          })}
        </div>
      </div>
      {hour !== null && (
        <p className="muted" style={{ margin: 0 }}>
          ขอเลื่อนเป็น {formatDayLong(date)} {formatHour(hour)}–{formatHour(hour + durationHours)}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={pending}>ย้อนกลับ</button>
        <button type="button" className="btn btn-block" onClick={submit} disabled={hour === null || pending}>
          {pending ? "กำลังส่ง…" : "ส่งคำขอเลื่อน"}
        </button>
      </div>
    </div>
  );
}
