"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createBooking } from "@/app/actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht, formatDayLong } from "@/lib/format";
import { cellState, formatHour, getVenueStatus, maxBookableHours, openingSlots, slotStart, upcomingDates } from "@/lib/slots";
import { DatePills } from "./DatePills";
import { CourtArt } from "./CourtArt";
import { ChevronDown } from "./icons";
import { useOccupancy } from "./useOccupancy";

type Court = { id: number; name: string; price_per_hour: number };
type Initial = { date?: string; court?: number; hour?: number };

const CLOCK_TICK_MS = 30_000;

export function BookingForm({
  courts,
  isLoggedIn,
  bookerName,
  isCoach = false,
  initial,
  openHour = BOOKING_RULES.openHour,
  closeHour = BOOKING_RULES.closeHour,
}: {
  courts: Court[];
  isLoggedIn: boolean;
  bookerName: string | null;
  isCoach?: boolean;
  initial: Initial;
  openHour?: number;
  closeHour?: number;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date());
  const dates = upcomingDates(now, BOOKING_RULES.maxDaysAhead);
  const venueStatus = getVenueStatus(now, openHour, closeHour);
  const defaultDate =
    initial.date && dates.includes(initial.date)
      ? initial.date
      : venueStatus.isTodayClosed && dates[1]
      ? dates[1]
      : dates[0];
  const [date, setDate] = useState(defaultDate);
  const [selectedCourts, setSelectedCourts] = useState<number[]>(() => {
    if (initial.court && courts.some((c) => c.id === initial.court)) return [initial.court];
    return courts[0] ? [courts[0].id] : [1];
  });
  const [hour, setHour] = useState<number | null>(initial.hour ?? null);
  const [hours, setHours] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { occupancy } = useOccupancy(date);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const maxHours =
    hour === null
      ? 0
      : Math.min(
          ...selectedCourts.map((cid) =>
            maxBookableHours(cid, date, hour, occupancy, now, 0.5, closeHour),
          ),
        );

  // Someone else took the chosen time (ignore our own booking arriving over realtime).
  useEffect(() => {
    if (hour === null || pending) return;
    if (maxHours === 0) {
      setHour(null);
      setError("เวลาที่เลือกมีสนามที่ไม่ว่างแล้ว กรุณาเลือกใหม่");
    } else if (hours > maxHours) {
      setHours(maxHours);
    }
  }, [hour, hours, maxHours, pending]);

  const [payLater, setPayLater] = useState(false);
  const [agreedTotal, setAgreedTotal] = useState("");
  const total =
    hour !== null
      ? selectedCourts.reduce((sum, cid) => {
          const c = courts.find((item) => item.id === cid);
          return sum + (c ? Math.round(c.price_per_hour * hours) : 0);
        }, 0)
      : 0;

  const agreedValue = isCoach && agreedTotal.trim() !== "" ? Number(agreedTotal) : null;

  function changeDate(next: string) {
    setDate(next);
    setHour(null);
    setError(null);
  }

  function book() {
    if (hour === null || selectedCourts.length === 0) return;
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(`/book?date=${date}&court=${selectedCourts[0]}&hour=${hour}`)}`);
      return;
    }
    setError(null);
    startTransition(async () => {
      const agreed = agreedTotal.trim() === "" ? null : Number(agreedTotal);
      if (agreed !== null && (!Number.isInteger(agreed) || agreed <= 0 || agreed > total)) {
        setError(`ใส่ยอดเป็นจำนวนเต็มบาท ไม่เกินราคาปกติ ${formatBaht(total)}`);
        return;
      }
      const result = await createBooking({
        courtIds: selectedCourts,
        startsAt: slotStart(date, hour),
        hours,
        coach: isCoach ? { payLater, total: agreed } : undefined,
      });
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

        <div className="field">
          <div className="row" style={{ marginBottom: 4 }}>
            <span>สนาม (เลือกได้หลายสนาม รวมบิลเดียว)</span>
            <button
             type="button"
  className="link-btn"
  style={{
    fontSize: 13,
    color: "var(--primary-strong)",
    fontWeight: 500,
    padding: "2px 2px",         
    display: "inline-flex",      
    alignItems: "center",
  }}
              onClick={() => {
                setError(null);
                if (selectedCourts.length === courts.length) {
                  setSelectedCourts([courts[0]?.id ?? 1]);
                } else {
                  setSelectedCourts(courts.map((c) => c.id));
                }
              }}
            >
              {selectedCourts.length === courts.length ? "เลือกสนามเดียว" : "⚡ จองเหมา 4 สนาม"}
            </button>
          </div>
          <div className="court-chip-grid">
            {courts.map((c) => {
              const isSelected = selectedCourts.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`chip court-select-pill ${isSelected ? "selected" : "free"}`}
                  onClick={() => {
                    setError(null);
                    if (isSelected) {
                      if (selectedCourts.length > 1) {
                        setSelectedCourts(selectedCourts.filter((id) => id !== c.id));
                      }
                    } else {
                      setSelectedCourts([...selectedCourts, c.id].sort((a, b) => a - b));
                    }
                  }}
                  aria-pressed={isSelected}
                >
                  <CourtArt label={c.name} />
                  {isSelected && <span className="court-selected-mark" aria-hidden="true">✓</span>}
                  <span className="court-pill-title">{c.name}</span>
                  <span className="court-pill-sub">{formatBaht(c.price_per_hour)}/ชม.</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div className="row" style={{ marginBottom: 2 }}>
            <span>เวลาเริ่ม</span>
            {hour !== null && (
              <span className="badge confirmed" style={{ fontSize: 13, fontWeight: 600 }}>
                {formatHour(hour)} – {formatHour(hour + hours)} น. ({hours === 0.5 ? "30 นาที" : `${hours} ชม.`})
              </span>
            )}
          </div>

          {hour !== null && (
            <div className="selected-time-banner">
              <div>
                จองรอบ: <strong>{formatHour(hour)} &ndash; {formatHour(hour + hours)} น.</strong>
                <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>
                  เริ่ม {formatHour(hour)} น. &bull; เล่นเสร็จ {formatHour(hour + hours)} น.
                </div>
              </div>
              <span className="time-end-highlight">
                เลิก {formatHour(hour + hours)} น.
              </span>
            </div>
          )}

          {date === dates[0] && venueStatus.isTodayClosed && (
            <div className="card closed-notice-card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>🌙</span>
                <strong>วันนี้สนามปิดบริการแล้ว (รอบสุดท้าย {formatHour(closeHour)}:00 น.)</strong>
              </div>
              <span className="muted" style={{ fontSize: 13 }}>
                กรุณาเลือกวันถัดไปเพื่อเลือกช่วงเวลาที่ต้องการจอง
              </span>
              {dates[1] && (
                <button
                  type="button"
                  className="btn btn-sm btn-book-tomorrow"
                  style={{ marginTop: 4, width: "fit-content" }}
                  onClick={() => changeDate(dates[1])}
                >
                  📅 ไปที่วันพรุ่งนี้
                </button>
              )}
            </div>
          )}

          <div className="chip-grid">
            {openingSlots(0.5, openHour, closeHour).map((h) => {
              const free = selectedCourts.every(
                (cid) => cellState(cid, date, h, occupancy, now) === "free",
              );
              const inRange = hour !== null && h > hour && h < hour + hours;
              const isSelected = h === hour;
              const cls = isSelected ? "selected" : inRange ? "in-range" : free ? "free" : "unavailable";
              const startStr = formatHour(h).replace(":", ".");
              const endStr = formatHour(h + 0.5).replace(":", ".");
              return (
                <button
                  key={h}
                  type="button"
                  className={`chip time-slot ${cls}`}
                  disabled={!free && !isSelected && !inRange}
                  aria-pressed={isSelected || inRange}
                  aria-label={`รอบ ${formatHour(h)} ถึง ${formatHour(h + 0.5)} ${free ? "ว่าง" : "ไม่ว่าง"}`}
                  onClick={() => {
                    setError(null);
                    setHour(h);
                    const maxH = Math.min(
                      ...selectedCourts.map((cid) =>
                        maxBookableHours(cid, date, h, occupancy, now, 0.5, closeHour),
                      ),
                    );
                    setHours(maxH >= 1 ? 1 : maxH >= 0.5 ? 0.5 : 0.5);
                  }}
                >
                  <span className="chip-time-start">{startStr}</span>
                  <span className="chip-time-end">{free ? `– ${endStr}` : "🔒 ล็อกแล้ว"}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div className="row" style={{ marginBottom: 2 }}>
            <span>ระยะเวลา</span>
            {hour !== null && (
              <span className="muted" style={{ fontSize: 12 }}>
                เล่นถึง {formatHour(hour + hours)} น.
              </span>
            )}
          </div>
          <div className="hours-grid">
            {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((h) => {
              const isSelected = h === hours;
              const isAvailable = h <= maxHours;
              const endHourStr = hour !== null ? formatHour(hour + h).replace(":", ".") : null;
              return (
                <button
                  key={h}
                  type="button"
                  className={`chip duration-chip ${isSelected ? "selected" : isAvailable ? "free" : "unavailable"}`}
                  disabled={hour === null || !isAvailable}
                  onClick={() => setHours(h)}
                >
                  <span className="duration-title">{h === 0.5 ? "30 นาที" : `${h} ชม.`}</span>
                  {endHourStr && <span className="duration-sub">เลิก {endHourStr}</span>}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card stack" aria-live="polite">
        <div className="summary-line">
          <span className="muted">ผู้จอง</span>
          <span>{isLoggedIn ? (bookerName ?? "บัญชีของคุณ") : "ยังไม่ได้เข้าสู่ระบบ"}</span>
        </div>
        <div className="summary-line">
          <span className="muted">สนาม</span>
          <span style={{ fontWeight: 600 }}>
            {selectedCourts.length === 1
              ? (courts.find((c) => c.id === selectedCourts[0])?.name ?? "สนาม")
              : `${selectedCourts.length} สนาม (${selectedCourts.map((cid) => courts.find((c) => c.id === cid)?.name ?? `สนาม ${cid}`).join(", ")})`}
          </span>
        </div>
        <div className="summary-line">
          <span className="muted">วันเวลา</span>
          <span>
            {hour === null
              ? "เลือกเวลาเริ่ม"
              : `${formatDayLong(date)} ${formatHour(hour)}–${formatHour(hour + hours)} (${hours === 0.5 ? "30 นาที" : `${hours} ชม.`})`}
          </span>
        </div>
        <div className="summary-total">
          <span>รวมทั้งหมด</span>
          <span>{hour === null ? "–" : formatBaht(agreedValue ?? total)}</span>
        </div>
        {isCoach && hour !== null && (
          <div className="coach-terms stack" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>🏅 ตัวเลือกสำหรับโค้ช</span>
            <div className="hours" role="radiogroup" aria-label="วิธีชำระเงิน" style={{ display: "flex", gap: 6 }}>
              <button type="button" className={`chip ${!payLater ? "selected" : "free"}`} aria-pressed={!payLater} onClick={() => setPayLater(false)}>
                ชำระทันที
              </button>
              <button type="button" className={`chip ${payLater ? "selected" : "free"}`} aria-pressed={payLater} onClick={() => setPayLater(true)}>
                ชำระภายหลัง
              </button>
            </div>
            <label className="field">
              <span>ยอดตามที่ตกลงกับร้าน (เว้นว่าง = ราคาปกติ {formatBaht(total)})</span>
              <input
                id="coach-agreed-total"
                type="text"
                inputMode="numeric"
                placeholder={String(total)}
                value={agreedTotal}
                onChange={(e) => setAgreedTotal(e.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn btn-block" type="button" onClick={book} disabled={hour === null || pending}>
          {pending
            ? "กำลังจอง…"
            : isLoggedIn
              ? isCoach && payLater
                ? `จอง ${selectedCourts.length} สนาม · ชำระภายหลัง (${formatBaht(agreedValue ?? total)})`
                : `จอง ${selectedCourts.length} สนามและชำระเงิน (${formatBaht(agreedValue ?? total)})`
              : "เข้าสู่ระบบเพื่อจอง"}
        </button>
      </section>
    </div>
  );
}
