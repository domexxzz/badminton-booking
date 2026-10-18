"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

type Props = {
  period: "day" | "month" | "year";
  currentDate: string;  // YYYY-MM-DD
  currentMonth: string; // YYYY-MM
  currentYear: string;  // YYYY
  today: string;        // YYYY-MM-DD
};

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

export function AnalyticsPeriodPicker({
  period,
  currentDate,
  currentMonth,
  currentYear,
  today,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const updateQuery = useCallback(
    (params: Record<string, string>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [key, val] of Object.entries(params)) {
        if (val) sp.set(key, val);
        else sp.delete(key);
      }
      router.push(`/admin/analytics?${sp.toString()}`);
    },
    [router, searchParams]
  );

  const [currYearNum, currMonthNum] = currentMonth.split("-").map(Number);
  const years = [2024, 2025, 2026, 2027];

  return (
    <div className="card analytics-filter-card stack" style={{ gap: 14 }}>
      <div className="period-switch-row">
        <div className="segmented-control" role="tablist" aria-label="เลือกมุมมองเวลา">
          <button
            type="button"
            className={`seg-btn ${period === "day" ? "active" : ""}`}
            onClick={() => updateQuery({ period: "day" })}
          >
            📅 รายวัน
          </button>
          <button
            type="button"
            className={`seg-btn ${period === "month" ? "active" : ""}`}
            onClick={() => updateQuery({ period: "month" })}
          >
            🗓️ รายเดือน
          </button>
          <button
            type="button"
            className={`seg-btn ${period === "year" ? "active" : ""}`}
            onClick={() => updateQuery({ period: "year" })}
          >
            📈 รายปี
          </button>
        </div>

        {/* Quick buttons */}
        <div className="quick-period-btns">
          {period === "day" && (
            <>
              <button
                type="button"
                className={`btn btn-sm ${currentDate === today ? "btn-primary" : "btn-ghost"}`}
                onClick={() => updateQuery({ period: "day", date: today })}
              >
                วันนี้
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  const d = new Date(`${today}T12:00:00+07:00`);
                  d.setDate(d.getDate() - 1);
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, "0");
                  const day = String(d.getDate()).padStart(2, "0");
                  updateQuery({ period: "day", date: `${y}-${m}-${day}` });
                }}
              >
                เมื่อวาน
              </button>
            </>
          )}

          {period === "month" && (
            <button
              type="button"
              className={`btn btn-sm ${currentMonth === today.slice(0, 7) ? "btn-primary" : "btn-ghost"}`}
              onClick={() => updateQuery({ period: "month", month: today.slice(0, 7) })}
            >
              เดือนนี้
            </button>
          )}

          {period === "year" && (
            <button
              type="button"
              className={`btn btn-sm ${currentYear === today.slice(0, 4) ? "btn-primary" : "btn-ghost"}`}
              onClick={() => updateQuery({ period: "year", year: today.slice(0, 4) })}
            >
              ปีนี้
            </button>
          )}
        </div>
      </div>

      {/* Inputs specific to period */}
      <div className="period-inputs-row">
        {period === "day" && (
          <div className="input-group">
            <label htmlFor="analytics-date-input" className="label">
              เลือกวันที่:
            </label>
            <input
              id="analytics-date-input"
              type="date"
              className="analytics-date-input"
              value={currentDate}
              onChange={(e) => updateQuery({ period: "day", date: e.target.value })}
            />
            <span className="muted" style={{ fontSize: 13, alignSelf: "center" }}>
              {new Date(`${currentDate}T12:00:00+07:00`).toLocaleDateString("th-TH", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "Asia/Bangkok",
              })}
            </span>
          </div>
        )}

        {period === "month" && (
          <div className="input-group" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label className="label">เลือกเดือน:</label>
            <select
              className="analytics-select"
              value={currMonthNum}
              onChange={(e) => {
                const newM = String(e.target.value).padStart(2, "0");
                updateQuery({ period: "month", month: `${currYearNum}-${newM}` });
              }}
            >
              {THAI_MONTHS.map((name, idx) => (
                <option key={idx + 1} value={idx + 1}>
                  {name}
                </option>
              ))}
            </select>
            <select
              className="analytics-select"
              value={currYearNum}
              onChange={(e) => {
                const newY = e.target.value;
                const newM = String(currMonthNum).padStart(2, "0");
                updateQuery({ period: "month", month: `${newY}-${newM}` });
              }}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  พ.ศ. {y + 543} ({y})
                </option>
              ))}
            </select>
          </div>
        )}

        {period === "year" && (
          <div className="input-group" style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label className="label">เลือกปี:</label>
            <select
              className="analytics-select"
              value={Number(currentYear)}
              onChange={(e) => updateQuery({ period: "year", year: e.target.value })}
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  พ.ศ. {y + 543} ({y})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
