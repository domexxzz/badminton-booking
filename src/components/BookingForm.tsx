"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createBooking } from "@/app/actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht, formatDayShort } from "@/lib/format";
import {
  cellState,
  formatHour,
  getVenueStatus,
  maxBookableHours,
  openingSlots,
  slotStart,
  upcomingDates,
} from "@/lib/slots";
import { DatePills } from "./DatePills";
import { CourtArt } from "./CourtArt";
import { useOccupancy } from "./useOccupancy";

type Court = { id: number; name: string; price_per_hour: number };
type Initial = { date?: string; court?: number; hour?: number };

export type CartItem = {
  key: string;
  courtId: number;
  date: string;
  hour: number;
  hours: number;
};

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
  const [activeCourtId, setActiveCourtId] = useState<number>(() => {
    if (initial.court && courts.some((c) => c.id === initial.court)) return initial.court;
    return courts[0]?.id ?? 1;
  });
  const [hour, setHour] = useState<number | null>(initial.hour ?? null);
  const [hours, setHours] = useState(1);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { occupancy } = useOccupancy(date);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Check if a half-hour slot [h, h+0.5) on (courtId, d) is already inside cartItems
  function isSlotInCart(courtId: number, d: string, h: number): boolean {
    return cartItems.some(
      (item) => item.courtId === courtId && item.date === d && h >= item.hour && h < item.hour + item.hours,
    );
  }

  // Max bookable hours from startHour on (courtId, d) considering both DB occupancy and cartItems
  function getAvailableHoursForCourt(courtId: number, d: string, startH: number): number {
    const dbMax = maxBookableHours(courtId, d, startH, occupancy, now, 0.5, closeHour);
    let maxH = 0;
    while (maxH + 0.5 <= dbMax) {
      if (isSlotInCart(courtId, d, startH + maxH)) break;
      maxH += 0.5;
    }
    return maxH;
  }

  const maxHours = hour === null ? 0 : getAvailableHoursForCourt(activeCourtId, date, hour);

  // If someone else took the currently selected time in realtime
  useEffect(() => {
    if (hour === null || pending) return;
    if (maxHours === 0) {
      setHour(null);
      setError("เวลาที่เลือกไม่ว่างแล้ว กรุณาเลือกเวลาใหม่");
    } else if (hours > maxHours) {
      setHours(maxHours);
    }
  }, [hour, hours, maxHours, pending]);

  const [payLater, setPayLater] = useState(false);
  const [agreedTotal, setAgreedTotal] = useState("");

  const activeCourt = courts.find((c) => c.id === activeCourtId) ?? courts[0];

  // Current pending selection (not yet clicked "+ เพิ่มลงในรายการจอง")
  const pendingDraftItem: CartItem | null =
    hour !== null && maxHours >= hours
      ? {
          key: `draft-${date}-${activeCourtId}-${hour}`,
          courtId: activeCourtId,
          date,
          hour,
          hours,
        }
      : null;

  // Effective items to book: cartItems + pendingDraftItem (if not already in cart)
  const effectiveItems: CartItem[] =
    pendingDraftItem && !isSlotInCart(pendingDraftItem.courtId, pendingDraftItem.date, pendingDraftItem.hour)
      ? [...cartItems, pendingDraftItem]
      : cartItems;

  const itemPrice = (item: CartItem) => {
    const c = courts.find((court) => court.id === item.courtId);
    return c ? Math.round(c.price_per_hour * item.hours) : 0;
  };

  const total = effectiveItems.reduce((sum, item) => sum + itemPrice(item), 0);
  const agreedValue = isCoach && agreedTotal.trim() !== "" ? Number(agreedTotal) : null;

  // Courts that are completely free for the currently selected [hour, hour + hours] window
  const freeCourtsForCurrentWindow =
    hour !== null
      ? courts.filter((c) => getAvailableHoursForCourt(c.id, date, hour) >= hours)
      : [];

  function changeDate(next: string) {
    setDate(next);
    setHour(null);
    setError(null);
  }

  function selectCourt(courtId: number) {
    setActiveCourtId(courtId);
    setError(null);
    if (hour !== null) {
      const avail = getAvailableHoursForCourt(courtId, date, hour);
      if (avail === 0) {
        setHour(null);
      } else if (hours > avail) {
        setHours(avail);
      }
    }
  }

  function addCurrentToCart() {
    if (hour === null) {
      setError("กรุณาเลือกเวลาเริ่มต้นก่อนเพิ่มลงในรายการจอง");
      return;
    }
    if (cartItems.length >= 8) {
      setError("เพิ่มรายการได้สูงสุด 8 รายการต่อบิล");
      return;
    }
    const newItem: CartItem = {
      key: `${date}-${activeCourtId}-${hour}`,
      courtId: activeCourtId,
      date,
      hour,
      hours,
    };
    const nextCart = [...cartItems, newItem];
    setCartItems(nextCart);
    setHour(null);
    setError(null);

    // Automatically move activeCourtId to the next court so the user can pick the next court's time right away
    const otherCourt = courts.find(
      (c) => c.id !== activeCourtId && !nextCart.some((item) => item.courtId === c.id && item.date === date),
    );
    if (otherCourt) {
      setActiveCourtId(otherCourt.id);
    }
  }

  function addAllFreeCourtsForCurrentWindow() {
    if (hour === null || freeCourtsForCurrentWindow.length === 0) return;
    const toAdd: CartItem[] = freeCourtsForCurrentWindow.map((c) => ({
      key: `${date}-${c.id}-${hour}`,
      courtId: c.id,
      date,
      hour,
      hours,
    }));
    const combined = [...cartItems, ...toAdd].slice(0, 8);
    setCartItems(combined);
    setHour(null);
    setError(null);
  }

  function removeItem(key: string) {
    if (key.startsWith("draft-")) {
      setHour(null);
      return;
    }
    setCartItems((prev) => prev.filter((item) => item.key !== key));
    setError(null);
  }

  function book() {
    if (effectiveItems.length === 0) return;
    if (!isLoggedIn) {
      const first = effectiveItems[0];
      router.push(
        `/login?next=${encodeURIComponent(`/book?date=${first.date}&court=${first.courtId}&hour=${first.hour}`)}`,
      );
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
        items: effectiveItems.map((item) => ({
          courtId: item.courtId,
          startsAt: slotStart(item.date, item.hour),
          hours: item.hours,
        })),
        coach: isCoach ? { payLater, total: agreed } : undefined,
      });
      if (result.ok) router.push(`/bookings/${result.data.id}`);
      else setError(result.error);
    });
  }

  return (
    <div className="stack booking-cart-page">
      {/* Top Date Selector */}
      <DatePills dates={dates} value={date} onChange={changeDate} />

      {/* Step 1: Select Court, Start Time, Duration & Add to Cart */}
      <section className="card stack booking-picker-card">
        <div className="field">
          <span className="booking-section-title">เลือกสนามและเวลาที่ต้องการ</span>
          <div className="booking-court-scroller" role="tablist" aria-label="เลือกสนาม">
            {courts.map((c) => {
              const isSelected = c.id === activeCourtId;
              const inCartCount = cartItems.filter((item) => item.courtId === c.id && item.date === date).length;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  className={`booking-court-horiz-card ${isSelected ? "selected" : ""}`}
                  onClick={() => selectCourt(c.id)}
                >
                  <div className="booking-court-horiz-thumb">
                    <CourtArt label={c.name} />
                  </div>
                  <div className="booking-court-horiz-info">
                    <strong>
                      {c.name} ({c.price_per_hour}฿/ชม.)
                    </strong>
                    <span>
                      {inCartCount > 0
                        ? `✓ เลือกไว้ในรายการแล้ว ${inCartCount} รอบ`
                        : "เลือกเวลาด้านล่างเพื่อเพิ่มในรายการ"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div className="row" style={{ marginBottom: 2 }}>
            <span className="booking-section-title">เลือกเวลาเริ่มต้น</span>
            {hour !== null && (
              <span className="badge confirmed" style={{ fontSize: 12.5, fontWeight: 600 }}>
                {activeCourt?.name} · {formatHour(hour)} – {formatHour(hour + hours)} น.
              </span>
            )}
          </div>

          {date === dates[0] && venueStatus.isTodayClosed && (
            <div className="card closed-notice-card" style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>🌙</span>
                <strong>วันนี้สนามปิดบริการแล้ว (รอบสุดท้าย {formatHour(closeHour)} น.)</strong>
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
              const inCart = isSlotInCart(activeCourtId, date, h);
              const state = cellState(activeCourtId, date, h, occupancy, now);
              const free = state === "free" && !inCart;
              const inRange = hour !== null && h > hour && h < hour + hours;
              const isSelected = h === hour;
              const cls = isSelected
                ? "selected"
                : inRange
                ? "in-range"
                : inCart
                ? "in-cart"
                : free
                ? "free"
                : "unavailable";
              return (
                <button
                  key={h}
                  type="button"
                  className={`chip time-slot ${cls}`}
                  disabled={!free && !isSelected && !inRange}
                  aria-pressed={isSelected || inRange}
                  aria-label={`รอบ ${formatHour(h)} ถึง ${formatHour(h + 0.5)} ${
                    inCart ? "อยู่ในรายการจองแล้ว" : free ? "ว่าง" : "ไม่ว่าง"
                  }`}
                  onClick={() => {
                    setError(null);
                    setHour(h);
                    const avail = getAvailableHoursForCourt(activeCourtId, date, h);
                    setHours(avail >= 1 ? 1 : 0.5);
                  }}
                >
                  <span className="chip-time-start">{formatHour(h)}</span>
                  <span className="chip-time-end">
                    {inCart ? "✓ ในรายการ" : free ? `– ${formatHour(h + 0.5)}` : "🔒 ล็อกแล้ว"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <div className="row" style={{ marginBottom: 2 }}>
            <span className="booking-section-title">ระยะเวลา</span>
            {hour !== null && (
              <span className="muted" style={{ fontSize: 12 }}>
                เล่นถึง {formatHour(hour + hours)} น.
              </span>
            )}
          </div>
          <div className="hours-grid">
            {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((h) => {
              const isSelected = h === hours && hour !== null;
              const isAvailable = hour !== null && h <= maxHours;
              const endHourStr = hour !== null ? formatHour(hour + h) : null;
              return (
                <button
                  key={h}
                  type="button"
                  className={`chip duration-chip ${
                    isSelected ? "selected" : isAvailable ? "free" : "unavailable"
                  }`}
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

        {/* Add to Booking List Button */}
        <div className="booking-add-actions">
          <button
            type="button"
            className="btn btn-block booking-add-cart-btn"
            disabled={hour === null}
            onClick={addCurrentToCart}
          >
            <span style={{ fontSize: 20, fontWeight: 400, lineHeight: 1 }}>＋</span>
            <span>เพิ่มลงในรายการจอง ({activeCourt?.name ?? "สนาม"})</span>
          </button>

          {hour !== null && freeCourtsForCurrentWindow.length > 1 && (
            <button
              type="button"
              className="booking-add-all-courts-btn"
              onClick={addAllFreeCourtsForCurrentWindow}
            >
              ⚡ เลือกเวลาเดียวกัน ({formatHour(hour)}–{formatHour(hour + hours)}) ทั้ง{" "}
              {freeCourtsForCurrentWindow.length} 
            </button>
          )}
        </div>
      </section>

      {/* Step 2: Booking Cart List & Total Summary */}
      <section className="card stack booking-cart-summary-card" aria-live="polite">
        <div className="row" style={{ marginBottom: 2 }}>
          <h2 className="booking-section-title" style={{ margin: 0 }}>
            รายการจองของคุณ ({effectiveItems.length} สนาม)
          </h2>
          {cartItems.length > 1 && (
            <button
              type="button"
              className="link-btn"
              style={{ fontSize: 12.5, color: "var(--danger)" }}
              onClick={() => setCartItems([])}
            >
              ล้างทั้งหมด
            </button>
          )}
        </div>

        {effectiveItems.length === 0 ? (
          <div className="booking-cart-empty">
            เลือกเวลาด้านบน แล้วกดปุ่ม <strong>“＋ เพิ่มลงในรายการจอง”</strong> เพื่อเพิ่มสนามได้เลย
          </div>
        ) : (
          <div className="booking-cart-list">
            {effectiveItems.map((item) => {
              const courtObj = courts.find((c) => c.id === item.courtId);
              const price = itemPrice(item);
              const durationLabel = item.hours === 0.5 ? "30 นาที" : `${item.hours} ชม.`;
              return (
                <div key={item.key} className="booking-cart-item">
                  <div className="booking-cart-item-text">
                    <strong>{courtObj?.name ?? `สนาม ${item.courtId}`}</strong>
                    <span>
                      {" · "}
                      {formatDayShort(item.date)}
                      {" · "}
                      {formatHour(item.hour)} - {formatHour(item.hour + item.hours)} ({durationLabel})
                      {" · "}
                      <strong>{price}฿</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="booking-cart-remove-btn"
                    onClick={() => removeItem(item.key)}
                    aria-label={`ลบ ${courtObj?.name ?? "สนาม"} เวลา ${formatHour(item.hour)}`}
                    title="ลบรายการนี้"
                  >
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1Zm1 4a1 1 0 0 0-1 1v9a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v9a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="summary-line" style={{ marginTop: 4 }}>
          <span className="muted">
            ผู้จอง: {isLoggedIn ? (bookerName ?? "บัญชีของคุณ") : "ยังไม่ได้เข้าสู่ระบบ"}
          </span>
          <strong style={{ fontWeight: 600 }}>
            {isLoggedIn ? (bookerName ?? "ผู้เล่น") : "–"}
          </strong>
        </div>

        <div className="summary-total">
          <span>รวมทั้งหมด</span>
          <span>{effectiveItems.length === 0 ? "0 บาท" : `${(agreedValue ?? total).toLocaleString("th-TH")} บาท`}</span>
        </div>

        {isCoach && effectiveItems.length > 0 && (
          <div className="coach-terms stack" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
              🏅 ตัวเลือกสำหรับโค้ช
            </span>
            <div className="hours" role="radiogroup" aria-label="วิธีชำระเงิน" style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={`chip ${!payLater ? "selected" : "free"}`}
                aria-pressed={!payLater}
                onClick={() => setPayLater(false)}
              >
                ชำระทันที
              </button>
              <button
                type="button"
                className={`chip ${payLater ? "selected" : "free"}`}
                aria-pressed={payLater}
                onClick={() => setPayLater(true)}
              >
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

        <button
          className="btn btn-block"
          type="button"
          onClick={book}
          disabled={effectiveItems.length === 0 || pending}
        >
          {pending
            ? "กำลังจอง…"
            : isLoggedIn
            ? isCoach && payLater
              ? `จองและชำระภายหลัง (${(agreedValue ?? total).toLocaleString("th-TH")}฿)`
              : `จองและชำระเงิน (${(agreedValue ?? total).toLocaleString("th-TH")}฿)`
            : "เข้าสู่ระบบเพื่อจอง"}
        </button>
      </section>
    </div>
  );
}
