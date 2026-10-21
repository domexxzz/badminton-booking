"use client";

import { formatDayParts } from "@/lib/format";

export function DatePills({
  dates,
  value,
  onChange,
}: {
  dates: string[];
  value: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="date-scroll" role="group" aria-label="เลือกวัน">
      {dates.map((d) => {
        const { weekday, date, month } = formatDayParts(d);
        return (
          <button
            key={d}
            type="button"
            className="date-pill"
            aria-pressed={d === value}
            onClick={() => onChange(d)}
          >
            <span className="pill-weekday">{weekday}</span>
            <strong className="pill-date">{date}</strong>
            <span className="pill-month">{month}</span>
          </button>
        );
      })}
    </div>
  );
}
