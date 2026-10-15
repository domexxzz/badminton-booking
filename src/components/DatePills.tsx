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
      {dates.map((d, i) => {
        const { weekday, date } = formatDayParts(d);
        return (
          <button key={d} type="button" className="date-pill" aria-pressed={d === value} onClick={() => onChange(d)}>
            <span>{i === 0 ? "วันนี้" : weekday}</span>
            <strong>{date}</strong>
          </button>
        );
      })}
    </div>
  );
}
