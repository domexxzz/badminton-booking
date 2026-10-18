"use client";

import { useState } from "react";
import { formatBaht } from "@/lib/format";

export type TimeDataPoint = {
  label: string;       // e.g. "09:00", "01 ต.ค.", "ม.ค."
  fullLabel: string;   // detailed for tooltip e.g. "09:00 - 10:00", "วันเสาร์ที่ 1 ต.ค. 2569"
  revenue: number;
  bookingsCount: number;
  hours: number;
  isWeekend?: boolean;
};

export type CourtStat = {
  courtId: number;
  courtName: string;
  revenue: number;
  hours: number;
  bookingsCount: number;
};

export type ChannelStat = {
  channel: string;
  label: string;
  count: number;
  revenue: number;
  color: string;
};

type Props = {
  periodLabel: string;
  timeData: TimeDataPoint[];
  courtStats: CourtStat[];
  channelStats: ChannelStat[];
  totalRevenue: number;
  totalBookings: number;
};

export function AnalyticsCharts({
  periodLabel,
  timeData,
  courtStats,
  channelStats,
  totalRevenue,
  totalBookings,
}: Props) {
  const [metric, setMetric] = useState<"revenue" | "count">("revenue");
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // SVG Chart Dimensions
  const height = 240;
  const paddingBottom = 32;
  const paddingTop = 20;
  const paddingLeft = 45;
  const paddingRight = 15;
  const chartHeight = height - paddingTop - paddingBottom;
  const chartWidth = 720; // viewBox units

  const values = timeData.map((d) => (metric === "revenue" ? d.revenue : d.bookingsCount));
  const rawMax = Math.max(...values, 0);
  // Round up max for nice axis ticks
  const maxVal = metric === "revenue" ? (rawMax === 0 ? 1000 : Math.ceil(rawMax / 500) * 500) : (rawMax === 0 ? 5 : Math.ceil(rawMax / 2) * 2);

  const slotWidth = (chartWidth - paddingLeft - paddingRight) / Math.max(timeData.length, 1);
  const barWidth = Math.max(4, Math.min(slotWidth * 0.65, 32));

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => ({
    val: Math.round(maxVal * pct),
    y: paddingTop + chartHeight * (1 - pct),
  }));

  const hoveredItem = hoveredIdx !== null ? timeData[hoveredIdx] : null;

  return (
    <div className="analytics-charts-grid">
      {/* Main Bar Chart */}
      <div className="card chart-card main-chart-card">
        <div className="chart-header">
          <div>
            <h3 style={{ margin: 0, fontSize: "1.05rem" }}>
              {metric === "revenue" ? "📈 กราฟสรุปรายรับ" : "🏸 กราฟจำนวนการจอง"} ({periodLabel})
            </h3>
            <span className="muted" style={{ fontSize: "0.85rem" }}>
              {metric === "revenue"
                ? `รายรับรวม ${formatBaht(totalRevenue)}`
                : `จำนวนการจองทั้งหมด ${totalBookings} คิว`}
            </span>
          </div>

          <div className="metric-toggle">
            <button
              type="button"
              className={`metric-btn ${metric === "revenue" ? "active" : ""}`}
              onClick={() => setMetric("revenue")}
            >
              ฿ รายรับ
            </button>
            <button
              type="button"
              className={`metric-btn ${metric === "count" ? "active" : ""}`}
              onClick={() => setMetric("count")}
            >
              🏸 จำนวนคิว
            </button>
          </div>
        </div>

        {/* Hover Tooltip Box */}
        <div className="chart-tooltip-banner">
          {hoveredItem ? (
            <div className="tooltip-content">
              <strong>{hoveredItem.fullLabel}:</strong>
              <span>
                รายรับ <strong>{formatBaht(hoveredItem.revenue)}</strong>
              </span>
              <span>•</span>
              <span>
                <strong>{hoveredItem.bookingsCount}</strong> การจอง ({hoveredItem.hours} ชม.)
              </span>
            </div>
          ) : (
            <span className="muted tooltip-hint">แตะหรือชี้ที่แท่งกราฟเพื่อดูรายละเอียดเฉพาะช่วงเวลา</span>
          )}
        </div>

        <div className="svg-chart-container">
          <svg
            viewBox={`0 0 ${chartWidth} ${height}`}
            className="analytics-svg"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="barGradientPrimary" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <linearGradient id="barGradientWeekend" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0284c7" />
              </linearGradient>
              <linearGradient id="barGradientCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#d97706" />
              </linearGradient>
            </defs>

            {/* Gridlines & Y-axis labels */}
            {yTicks.map((tick, i) => (
              <g key={i}>
                <line
                  x1={paddingLeft}
                  y1={tick.y}
                  x2={chartWidth - paddingRight}
                  y2={tick.y}
                  stroke="currentColor"
                  strokeOpacity="0.08"
                  strokeDasharray={i === 0 ? "none" : "3 3"}
                />
                <text
                  x={paddingLeft - 8}
                  y={tick.y + 3}
                  textAnchor="end"
                  fontSize="10"
                  fill="currentColor"
                  opacity="0.5"
                >
                  {metric === "revenue"
                    ? tick.val >= 1000
                      ? `${(tick.val / 1000).toFixed(tick.val % 1000 === 0 ? 0 : 1)}k`
                      : tick.val
                    : tick.val}
                </text>
              </g>
            ))}

            {/* Bars */}
            {timeData.map((d, i) => {
              const val = metric === "revenue" ? d.revenue : d.bookingsCount;
              const barHeight = maxVal > 0 ? (val / maxVal) * chartHeight : 0;
              const x = paddingLeft + i * slotWidth + (slotWidth - barWidth) / 2;
              const y = paddingTop + chartHeight - barHeight;
              const isHovered = hoveredIdx === i;

              const gradientId =
                metric === "count"
                  ? "url(#barGradientCount)"
                  : d.isWeekend
                  ? "url(#barGradientWeekend)"
                  : "url(#barGradientPrimary)";

              // Show x-label every N steps if too crowded
              const step = timeData.length > 20 ? 3 : timeData.length > 14 ? 2 : 1;
              const showLabel = i % step === 0 || i === timeData.length - 1;

              return (
                <g
                  key={i}
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  onTouchStart={() => setHoveredIdx(i)}
                  style={{ cursor: "pointer" }}
                >
                  {/* Invisible hit area */}
                  <rect
                    x={paddingLeft + i * slotWidth}
                    y={paddingTop}
                    width={slotWidth}
                    height={chartHeight + paddingBottom}
                    fill="transparent"
                  />

                  {/* Active highlight background column */}
                  {isHovered && (
                    <rect
                      x={paddingLeft + i * slotWidth}
                      y={paddingTop}
                      width={slotWidth}
                      height={chartHeight}
                      fill="currentColor"
                      opacity="0.05"
                      rx="4"
                    />
                  )}

                  {/* The bar */}
                  {val > 0 ? (
                    <rect
                      x={x}
                      y={y}
                      width={barWidth}
                      height={Math.max(barHeight, 2)}
                      rx={barWidth > 6 ? 4 : 2}
                      fill={gradientId}
                      opacity={isHovered ? 1 : 0.88}
                      style={{
                        transition: "all 0.15s ease",
                        filter: isHovered ? "drop-shadow(0 2px 6px rgba(0,0,0,0.25))" : "none",
                      }}
                    />
                  ) : (
                    // Subtle dot for zero
                    <circle
                      cx={x + barWidth / 2}
                      cy={paddingTop + chartHeight - 1}
                      r="1.5"
                      fill="currentColor"
                      opacity="0.2"
                    />
                  )}

                  {/* X-axis label */}
                  {showLabel && (
                    <text
                      x={x + barWidth / 2}
                      y={height - 10}
                      textAnchor="middle"
                      fontSize="9.5"
                      fill="currentColor"
                      opacity={isHovered ? 1 : d.isWeekend ? 0.85 : 0.6}
                      fontWeight={isHovered || d.isWeekend ? "600" : "400"}
                    >
                      {d.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Side Breakdown Panels */}
      <div className="side-breakdown-col stack" style={{ gap: 14 }}>
        {/* Court Distribution */}
        <div className="card chart-card">
          <h3 style={{ margin: "0 0 10px 0", fontSize: "0.95rem" }}>🏸 สัดส่วนรายรับแยกตามสนาม</h3>
          <div className="breakdown-list">
            {courtStats.map((c) => {
              const pct = totalRevenue > 0 ? Math.round((c.revenue / totalRevenue) * 100) : 0;
              return (
                <div key={c.courtId} className="breakdown-item">
                  <div className="row" style={{ fontSize: "0.86rem", marginBottom: 4 }}>
                    <strong>{c.courtName}</strong>
                    <span>
                      {formatBaht(c.revenue)} <span className="muted" style={{ fontSize: 11 }}>({pct}%)</span>
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill primary"
                      style={{ width: `${pct}%`, transition: "width 0.4s ease" }}
                    />
                  </div>
                  <div className="row muted" style={{ fontSize: "0.75rem", marginTop: 2 }}>
                    <span>{c.bookingsCount} คิว</span>
                    <span>{c.hours} ชั่วโมง</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Channel Distribution */}
        <div className="card chart-card">
          <h3 style={{ margin: "0 0 10px 0", fontSize: "0.95rem" }}>📱 สัดส่วนช่องทางการจอง</h3>
          <div className="breakdown-list">
            {channelStats.map((ch) => {
              const pct = totalBookings > 0 ? Math.round((ch.count / totalBookings) * 100) : 0;
              return (
                <div key={ch.channel} className="breakdown-item">
                  <div className="row" style={{ fontSize: "0.86rem", marginBottom: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="dot" style={{ background: ch.color }} />
                      <strong>{ch.label}</strong>
                    </div>
                    <span>
                      {ch.count} คิว <span className="muted" style={{ fontSize: 11 }}>({pct}%)</span>
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{ width: `${pct}%`, background: ch.color, transition: "width 0.4s ease" }}
                    />
                  </div>
                  <div className="row muted" style={{ fontSize: "0.75rem", marginTop: 2 }}>
                    <span>รายรับ</span>
                    <span>{formatBaht(ch.revenue)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
