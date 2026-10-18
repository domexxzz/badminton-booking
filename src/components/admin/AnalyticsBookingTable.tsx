"use client";

import { useMemo, useState } from "react";
import { CHANNEL_LABEL, STATUS_LABEL, formatBaht, formatTime } from "@/lib/format";

export type BookingRowItem = {
  id: string;
  courtId: number;
  courtName: string;
  startsAt: string;
  endsAt: string;
  amount: number;
  status: string;
  channel: string;
  customerName: string;
  customerPhone: string | null;
  adminNote: string | null;
  createdAt: string;
};

type Props = {
  bookings: BookingRowItem[];
  courts: { id: number; name: string }[];
  periodLabel: string;
};

export function AnalyticsBookingTable({ bookings, courts, periodLabel }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [courtFilter, setCourtFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");

  const filtered = useMemo(() => {
    return bookings
      .filter((b) => {
        if (statusFilter !== "all" && b.status !== statusFilter) return false;
        if (courtFilter !== "all" && String(b.courtId) !== courtFilter) return false;
        if (channelFilter !== "all" && b.channel !== channelFilter) return false;

        if (search.trim()) {
          const q = search.toLowerCase().trim();
          const matchName = b.customerName.toLowerCase().includes(q);
          const matchPhone = b.customerPhone?.includes(q) ?? false;
          const matchNote = b.adminNote?.toLowerCase().includes(q) ?? false;
          const matchId = b.id.toLowerCase().includes(q);
          if (!matchName && !matchPhone && !matchNote && !matchId) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const tA = Date.parse(a.startsAt);
        const tB = Date.parse(b.startsAt);
        return sortOrder === "desc" ? tB - tA : tA - tB;
      });
  }, [bookings, search, statusFilter, courtFilter, channelFilter, sortOrder]);

  const totalFilteredAmount = useMemo(() => {
    return filtered
      .filter((b) => b.status === "confirmed")
      .reduce((sum, b) => sum + b.amount, 0);
  }, [filtered]);

  function exportCsv() {
    const headers = [
      "รหัสการจอง",
      "วันที่",
      "เวลาเริ่ม",
      "เวลาสิ้นสุด",
      "สนาม",
      "ชื่อลูกค้า",
      "เบอร์โทร",
      "ช่องทาง",
      "ยอดเงิน(บาท)",
      "สถานะ",
      "หมายเหตุ",
    ];

    const rows = filtered.map((b) => {
      const d = new Date(b.startsAt);
      const dateStr = d.toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" });
      const startTime = formatTime(b.startsAt);
      const endTime = formatTime(b.endsAt);
      const cleanNote = (b.adminNote ?? "").replace(/"/g, '""');
      const cleanName = b.customerName.replace(/"/g, '""');

      return [
        `"${b.id}"`,
        `"${dateStr}"`,
        `"${startTime}"`,
        `"${endTime}"`,
        `"${b.courtName}"`,
        `"${cleanName}"`,
        `"${b.customerPhone ?? ""}"`,
        `"${CHANNEL_LABEL[b.channel] ?? b.channel}"`,
        b.amount,
        `"${STATUS_LABEL[b.status] ?? b.status}"`,
        `"${cleanNote}"`,
      ].join(",");
    });

    // UTF-8 BOM for Thai language compatibility in Excel
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `badminton-bookings-${periodLabel.replace(/\s+/g, "_")}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function printReport() {
    window.print();
  }

  return (
    <div className="card analytics-table-card stack" style={{ gap: 14 }}>
      <div className="table-header-row">
        <div>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>📋 รายการจองทั้งหมด ({periodLabel})</h3>
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            แสดง {filtered.length} จากทั้งหมด {bookings.length} รายการ (ยอดที่ยืนยันแล้ว: {formatBaht(totalFilteredAmount)})
          </span>
        </div>

        <div className="action-btns">
          <button type="button" className="btn btn-sm btn-ghost" onClick={printReport} title="พิมพ์รายงาน">
            🖨️ พิมพ์
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={exportCsv} title="ดาวน์โหลดเป็นไฟล์ Excel/CSV">
            📥 ส่งออก CSV
          </button>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="table-filter-toolbar">
        <div className="search-wrap">
          <input
            type="search"
            placeholder="🔍 ค้นหาชื่อ, เบอร์โทร, ID..."
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="filter-selects">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">สถานะทั้งหมด</option>
            <option value="confirmed">ยืนยันแล้ว</option>
            <option value="awaiting_review">รอตรวจสลิป</option>
            <option value="pending_payment">รอชำระเงิน</option>
            <option value="cancelled">ยกเลิกแล้ว</option>
          </select>

          <select
            value={courtFilter}
            onChange={(e) => setCourtFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">ทุกสนาม</option>
            {courts.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={channelFilter}
            onChange={(e) => setChannelFilter(e.target.value)}
            className="filter-select"
          >
            <option value="all">ทุกช่องทาง</option>
            <option value="online">ออนไลน์</option>
            <option value="phone">โทรศัพท์</option>
            <option value="line">LINE</option>
            <option value="walk_in">หน้าร้าน</option>
          </select>

          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setSortOrder((o) => (o === "desc" ? "asc" : "desc"))}
            title="สลับการเรียงเวลา"
          >
            {sortOrder === "desc" ? "เวลารอบ: ใหม่ → เก่า" : "เวลารอบ: เก่า → ใหม่"}
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="table-responsive">
        <table className="analytics-data-table">
          <thead>
            <tr>
              <th>วัน/เวลา</th>
              <th>สนาม</th>
              <th>ลูกค้า</th>
              <th>ช่องทาง</th>
              <th style={{ textAlign: "right" }}>ยอดเงิน</th>
              <th style={{ textAlign: "center" }}>สถานะ</th>
              <th>หมายเหตุ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "32px 16px" }} className="muted">
                  ไม่พบรายการจองตามเงื่อนไขที่ค้นหา
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                const isRecurring = b.adminNote?.includes("[จองประจำ]") ?? false;
                const d = new Date(b.startsAt);
                const dateDisplay = d.toLocaleDateString("th-TH", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Bangkok",
                });

                return (
                  <tr key={b.id} className={isRecurring ? "row-recurring" : ""}>
                    <td className="cell-datetime">
                      <strong>{dateDisplay}</strong>
                      <span className="muted" style={{ fontSize: 12 }}>
                        {formatTime(b.startsAt)}–{formatTime(b.endsAt)}
                      </span>
                    </td>
                    <td>
                      <span className="court-tag">🏸 {b.courtName}</span>
                    </td>
                    <td>
                      <div className="customer-info">
                        <strong>{b.customerName}</strong>
                        {b.customerPhone && (
                          <a href={`tel:${b.customerPhone}`} className="phone-link">
                            {b.customerPhone}
                          </a>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`channel-badge ${b.channel}`}>
                        {CHANNEL_LABEL[b.channel] ?? b.channel}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <strong className="amount-text">{formatBaht(b.amount)}</strong>
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <span className={`badge ${b.status}`}>
                        {STATUS_LABEL[b.status] ?? b.status}
                      </span>
                    </td>
                    <td className="cell-note">
                      {isRecurring && (
                        <span className="recurring-tag" title="ก๊วนจองประจำ">
                          🔒 ก๊วนประจำ
                        </span>
                      )}
                      {b.adminNote ? (
                        <span className="note-text">{b.adminNote.replace("[จองประจำ]", "").trim()}</span>
                      ) : (
                        <span className="muted" style={{ fontSize: 12 }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
