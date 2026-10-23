import { formatBaht } from "@/lib/format";

type Props = {
  revenue: number;
  confirmedCount: number;
  pendingCount: number;
  /** Confirmed plus still-waiting. Cancelled and expired are counted separately. */
  activeCount: number;
  droppedCount: number;
  totalHours: number;
  capacityHours: number;
  utilization: number;
  courtCount: number;
  periodLabel: string;
};

export function AnalyticsKpiCards({
  revenue,
  confirmedCount,
  pendingCount,
  activeCount,
  droppedCount,
  totalHours,
  capacityHours,
  utilization,
  courtCount,
  periodLabel,
}: Props) {
  return (
    <section className="analytics-kpi-grid" aria-label={`สรุปยอดภาพรวม ${periodLabel}`}>
      <div className="card kpi-card revenue-kpi">
        <div className="kpi-icon-wrap" style={{ background: "rgba(16, 185, 129, 0.15)", color: "#10b981" }}>
          <span>💰</span>
        </div>
        <div className="kpi-body">
          <span className="label">รายรับรวม ({periodLabel})</span>
          <span className="value">{formatBaht(revenue)}</span>
          <span className="sub">จาก {confirmedCount} คิวที่ยืนยันแล้ว</span>
        </div>
      </div>

      <div className="card kpi-card bookings-kpi">
        <div className="kpi-icon-wrap" style={{ background: "rgba(59, 130, 246, 0.15)", color: "#3b82f6" }}>
          <span>🏸</span>
        </div>
        <div className="kpi-body">
          <span className="label">การจองทั้งหมด ({periodLabel})</span>
          <span className="value">{activeCount} คิว</span>
          <span className="sub">
            {pendingCount > 0
              ? `ยืนยัน ${confirmedCount} · รอชำระ/ตรวจ ${pendingCount}`
              : `ยืนยันแล้วครบทั้ง ${confirmedCount} คิว`}
          </span>
          <span className="kpi-note">
            {droppedCount > 0 ? `ไม่รวมที่ยกเลิก/หมดเวลา ${droppedCount} คิว` : "ไม่มีรายการที่ยกเลิกหรือหมดเวลา"}
          </span>
        </div>
      </div>

      <div className="card kpi-card hours-kpi">
        <div className="kpi-icon-wrap" style={{ background: "rgba(245, 158, 11, 0.15)", color: "#f59e0b" }}>
          <span>⏱️</span>
        </div>
        <div className="kpi-body">
          <span className="label">เวลาใช้งานสนามรวม</span>
          <span className="value">{totalHours} ชม.</span>
          <span className="sub">
            เฉลี่ย {courtCount > 0 ? (totalHours / courtCount).toFixed(1) : 0} ชม./สนาม ({courtCount} สนาม)
          </span>
        </div>
      </div>

      <div className="card kpi-card utilization-kpi">
        <div className="kpi-icon-wrap" style={{ background: "rgba(168, 85, 247, 0.15)", color: "#a855f7" }}>
          <span>📊</span>
        </div>
        <div className="kpi-body">
          <span className="label">อัตราใช้งานสนาม</span>
          <span className="value">{utilization}%</span>
          <span className="sub">จากความจุ {capacityHours} ชม. ในช่วงเวลานี้</span>
        </div>
      </div>
    </section>
  );
}
