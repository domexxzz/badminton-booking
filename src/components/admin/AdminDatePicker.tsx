"use client";

import { useRouter } from "next/navigation";
import { formatDayLong } from "@/lib/format";
import { ChevronLeft } from "../icons";

const DAY_MS = 24 * 60 * 60 * 1000;
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Day picker for the admin dashboard; past days are allowed (revenue history). */
export function AdminDatePicker({ date, today }: { date: string; today: string }) {
  const router = useRouter();
  const go = (day: string) => router.push(day === today ? "/admin" : `/admin?date=${day}`);

  return (
    <div className="date-nav">
      <button type="button" className="back" aria-label="วันก่อนหน้า" onClick={() => go(shift(date, -1))}>
        <ChevronLeft size={20} />
      </button>
      <label className="date-label">
        <strong>{date === today ? "วันนี้" : formatDayLong(date)}</strong>
        <input
          type="date"
          value={date}
          aria-label="เลือกวัน"
          onChange={(e) => e.target.value && go(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="back"
        aria-label="วันถัดไป"
        style={{ transform: "rotate(180deg)" }}
        onClick={() => go(shift(date, 1))}
      >
        <ChevronLeft size={20} />
      </button>
    </div>
  );
}
