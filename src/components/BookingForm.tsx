"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { createBooking } from "@/app/actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht, formatDayShort, formatDuration } from "@/lib/format";
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
import { CalendarIcon } from "./icons";
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
const MAX_CART_ITEMS = 8;
const STEPS = ["เลือกสนาม", "เลือกเวลา", "ยืนยัน"] as const;

const durationLabel = (h: number) => (h === 0.5 ? "30 นาที" : `${h} ชม.`);

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
  const [courtChosen, setCourtChosen] = useState(() => Boolean(initial.court));
  const [hour, setHour] = useState<number | null>(initial.hour ?? null);
  const [hours, setHours] = useState(1);
  // Half-hour starts are still bookable, just not in the first grid a customer sees.
  // Show the same precise half-hour cards as the booking reference flow.
  const [halfHourStarts, setHalfHourStarts] = useState(true);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { occupancy, loaded, loadError } = useOccupancy(date);

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

  // Current pending selection (not yet added with "เพิ่มลงรายการ")
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
  const payable = agreedValue ?? total;

  // The time grid: hourly by default, every half hour when asked for.
  const slotStep = halfHourStarts ? 0.5 : 1;
  const slots = openingSlots(slotStep, openHour, closeHour);
  const courtIsFreeAt = (h: number) => getAvailableHoursForCourt(activeCourtId, date, h) >= slotStep;

  const currentStep = effectiveItems.length > 0 ? 3 : !courtChosen ? 1 : 2;

  function changeDate(next: string) {
    setDate(next);
    setHour(null);
    setAwaitingEnd(false);
    setError(null);
  }

  function pickTime(h: number) {
    setError(null);
    const avail = getAvailableHoursForCourt(activeCourtId, date, h);
    if (avail < slotStep) {
      setError(`${courtName(activeCourtId)} ไม่ว่างในเวลานี้`);
      return;
    }
    setHour(h);
    setHours(avail >= 1 ? 1 : 0.5);
  }

  // The first tap sets the start. Every later tap extends or shortens the end, so a customer
  // can keep tapping consecutive hours until the wanted continuous range is selected.
  const [awaitingEnd, setAwaitingEnd] = useState(false);

  function tapSlot(h: number) {
    setError(null);
    if (hour === null) return pickTime(h);

    const end = hour + hours;
    // Tapping an adjacent half-hour card extends the selected range exactly
    // through that card; no extra card is included implicitly.
    if (h === end && courtIsFreeAt(h)) {
      setHours(Number((hours + slotStep).toFixed(2)));
      return;
    }
    if (h + slotStep === hour && courtIsFreeAt(h)) {
      setHour(h);
      setHours(Number((hours + slotStep).toFixed(2)));
      return;
    }

    // Tapping a selected edge card removes only that exact card.
    if (h === hour && hours > slotStep) {
      setHour(Number((hour + slotStep).toFixed(2)));
      setHours(Number((hours - slotStep).toFixed(2)));
      return;
    }
    if (h === end - slotStep && hours > slotStep) {
      setHours(Number((hours - slotStep).toFixed(2)));
      return;
    }
    if (h === hour && hours === slotStep) {
      setHour(null);
      setHours(1);
      return;
    }

    // A non-adjacent click starts a new exact selection.
    pickTime(h);
  }

  /** Selects the displayed range [a, b), keeping the clicked card as the end card. */
  function selectRange(a: number, b: number): boolean {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    // A second tap on the next card extends the range through that card's
    // start. A single tap remains the normal one-slot selection.
    const length = Math.min(Math.max(end - start, slotStep), BOOKING_RULES.maxHours);
    if (getAvailableHoursForCourt(activeCourtId, date, start) < length) return false;
    setError(null);
    setHour(start);
    setHours(length);
    return true;
  }

  function selectCourt(courtId: number) {
    setActiveCourtId(courtId);
    setCourtChosen(true);
    setHour(null);
    setAwaitingEnd(false);
    setError(null);
  }

  function addCurrentToCart() {
    if (hour === null) {
      setError("กรุณาเลือกเวลาก่อนเพิ่มลงรายการ");
      return;
    }
    if (cartItems.length >= MAX_CART_ITEMS) {
      setError(`เพิ่มรายการได้สูงสุด ${MAX_CART_ITEMS} รายการต่อบิล`);
      return;
    }
    setCartItems([...cartItems, { key: `${date}-${activeCourtId}-${hour}`, courtId: activeCourtId, date, hour, hours }]);
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

  const courtName = (id: number) => courts.find((c) => c.id === id)?.name ?? `สนาม ${id}`;
  const itemLine = (item: CartItem) =>
    `${courtName(item.courtId)} · ${formatDayShort(item.date)} · ${formatHour(item.hour)}–${formatHour(item.hour + item.hours)}`;
  const totalHours = effectiveItems.reduce((sum, item) => sum + item.hours, 0);

  return (
    <div className="stack booking-cart-page court-first-booking">
      <ol className="booking-steps" aria-label="ขั้นตอนการจอง">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const state = n < currentStep ? "done" : n === currentStep ? "current" : "todo";
          return (
            <li key={label} className={`booking-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="booking-step-dot">{state === "done" ? "✓" : n}</span>
              <span className="booking-step-label">{label}</span>
            </li>
          );
        })}
      </ol>

      <DatePills dates={dates} value={date} onChange={changeDate} />

      <Link href={`/schedule?date=${date}`} className="booking-schedule-link">
        <CalendarIcon size={18} />
        <span>ดูตารางคิวทั้งวัน · ใครจองสนามไหนช่วงไหน</span>
        <span aria-hidden="true">›</span>
      </Link>

      {/* Step 1: choose the court before looking at its available times. */}
      <section className="card stack booking-picker-card" aria-labelledby="pick-court-title">
        <div className="booking-section-title">
          <span id="pick-court-title">เลือกสนามก่อน</span>
          {courtChosen && <span className="badge confirmed">{courtName(activeCourtId)}</span>}
        </div>
        <div className="court-pick-grid" role="radiogroup" aria-label="เลือกสนาม">
          {courts.map((c) => {
            const isSelected = courtChosen && c.id === activeCourtId;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                className={`court-pick ${isSelected ? "selected" : "free"}`}
                onClick={() => selectCourt(c.id)}
              >
                <strong>{c.name}</strong>
                <span>{c.price_per_hour}฿/ชม.</span>
              </button>
            );
          })}
        </div>
        {courtChosen && (
          <div className="booking-selected-court-timeline" aria-label={`ตารางคิวของ ${courtName(activeCourtId)}`}>
            <div className="booking-selected-court-timeline-head">
              <strong>{courtName(activeCourtId)}</strong>
              <Link href={`/schedule?date=${date}&court=${activeCourtId}`}>ดูรายละเอียด</Link>
            </div>
            <div className="timeline-track-wrap">
              <div className="timeline-track" role="img" aria-label={`คิวสนาม ${courtName(activeCourtId)} ตั้งแต่ ${formatHour(openHour)} ถึง ${formatHour(closeHour)}`}>
                {openingSlots(0.5, openHour, closeHour).map((slotH) => (
                  <span key={slotH} className={`timeline-slot ${cellState(activeCourtId, date, slotH, occupancy, now)}`} aria-hidden="true" />
                ))}
              </div>
              <div className="timeline-ticks" aria-hidden="true">
                {[openHour, 12, 15, 18, 21].filter((h) => h >= openHour && h <= closeHour).map((h) => (
                  <span key={h} className="timeline-tick" style={{ left: `${((h - openHour) / (closeHour - openHour)) * 100}%` }}>{String(h).padStart(2, "0")}</span>
                ))}
              </div>
            </div>
            <p className="booking-timeline-hint">แถบสีแสดงคิวสนาม แตะ “ดูรายละเอียด” หากต้องการดูเวลาแบบเต็ม</p>
          </div>
        )}
        {!courtChosen && <p className="booking-drag-hint">เลือกสนามที่ต้องการ แล้วระบบจะแสดงเวลาว่างของสนามนั้น</p>}
      </section>

      {/* Step 2: tap a start and end time on the selected court. */}
      {courtChosen && <section className="card stack booking-picker-card" aria-labelledby="pick-time-title">
        <div className="booking-section-title">
          <span id="pick-time-title">เลือกเวลาของ {courtName(activeCourtId)}</span>
          {hour !== null ? (
            <span className="booking-duration-badge" aria-live="polite">
              ⏱ {formatDuration(hours)} · {formatHour(hour)}–{formatHour(hour + hours)}
            </span>
          ) : (
            <span className="booking-slot-legend">
              <span className="court-dot free" aria-hidden="true" /> = สนามว่าง
            </span>
          )}
        </div>

        {date === dates[0] && venueStatus.isTodayClosed && (
          <div className="card closed-notice-card">
            <strong>🌙 วันนี้สนามปิดบริการแล้ว (รอบสุดท้าย {formatHour(closeHour)} น.)</strong>
            <span className="muted" style={{ fontSize: 13 }}>
              กรุณาเลือกวันถัดไปเพื่อเลือกช่วงเวลาที่ต้องการจอง
            </span>
            {dates[1] && (
              <button
                type="button"
                className="btn btn-sm btn-book-tomorrow"
                style={{ width: "fit-content" }}
                onClick={() => changeDate(dates[1])}
              >
                📅 ไปที่วันพรุ่งนี้
              </button>
            )}
          </div>
        )}

        {loadError && <p className="error">{loadError}</p>}

        <div className={`hour-slot-grid ${halfHourStarts ? "half-hours" : ""}`} aria-busy={!loaded}>
          {slots.map((h) => {
            // Until the day's bookings arrive, say so instead of showing every court as free.
            if (!loaded) {
              return (
                <div key={h} className="hour-slot loading" aria-hidden="true">
                  <span className="hour-slot-time">
                    {formatHour(h)} – {formatHour(h + slotStep)}
                  </span>
                  <span className="hour-slot-note">กำลังเช็กสนามว่าง…</span>
                </div>
              );
            }
            const isFree = courtIsFreeAt(h);
            const isSelected = h === hour;
            const inRange = hour !== null && h > hour && h < hour + hours;
            const disabled = !isFree && !isSelected && !inRange;
            return (
              <button
                key={h}
                type="button"
                className={`hour-slot ${isSelected ? "selected" : inRange ? "in-range" : disabled ? "full" : "free"}`}
                disabled={disabled}
                aria-pressed={isSelected || inRange}
                aria-label={`${formatHour(h)} ถึง ${formatHour(h + slotStep)} ${
                  isFree ? `${courtName(activeCourtId)} ว่าง` : "ไม่ว่าง"
                }`}
                onClick={() => tapSlot(h)}
              >
                <span className="hour-slot-time">
                  {formatHour(h)} – {formatHour(h + slotStep)}
                </span>
                <span className="hour-slot-dots" aria-hidden="true">
                  <span className={`court-dot ${isFree ? "free" : "taken"}`} />
                </span>
                <span className="hour-slot-note">
                  {isSelected
                    ? awaitingEnd
                      ? "เริ่ม · แตะเวลาจบ"
                      : "เริ่ม"
                    : hour !== null && hours > slotStep && h === hour + hours - slotStep
                    ? "จบ"
                    : isFree
                    ? "ว่าง"
                    : "ไม่ว่าง"}
                </span>
              </button>
            );
          })}
        </div>

        {loaded && (
          <p className="booking-drag-hint">
            {hour === null
              ? "คลิกช่องเวลาที่ต้องการได้เลย ระบบจะเลือกช่วงนั้นตรง ๆ"
              : "หากต้องการเพิ่มช่วงเวลาอื่น ให้กดเพิ่มรายการ แล้วเลือกช่องถัดไป"}
          </p>
        )}

        <details className="booking-more" open={halfHourStarts || undefined}>
          <summary>ตัวเลือกเพิ่มเติม</summary>
          <label className="booking-more-option">
            <input
              type="checkbox"
              checked={halfHourStarts}
              onChange={(e) => {
                setHalfHourStarts(e.target.checked);
                setHour(null);
              }}
            />
            <span>แสดงเวลาเริ่มทุก 30 นาที (เช่น 13:30)</span>
          </label>
        </details>
        {hour !== null && (
          <div className="booking-add-actions">
            <button type="button" className="booking-add-more-btn" onClick={addCurrentToCart}>
              ＋ เพิ่มลงรายการ แล้วเลือกช่วงเวลาอื่นต่อ
            </button>
          </div>
        )}
      </section>}

      {/* Step 3: what will be booked */}
      {(effectiveItems.length > 0 || isCoach) && (
        <section className="card stack booking-cart-summary-card" aria-live="polite">
          <div className="row">
            <h2 className="booking-section-title" style={{ margin: 0 }}>
              รายการจอง ({effectiveItems.length})
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

          {effectiveItems.length > 0 && (
            <div className="booking-cart-list">
              {effectiveItems.map((item) => (
                <div key={item.key} className="booking-cart-item">
                  <div className="booking-cart-item-text">
                    <strong>{courtName(item.courtId)}</strong>
                    <span>
                      {" · "}
                      {formatDayShort(item.date)} · {formatHour(item.hour)} - {formatHour(item.hour + item.hours)} (
                      {durationLabel(item.hours)}) · <strong>{itemPrice(item)}฿</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="booking-cart-remove-btn"
                    onClick={() => removeItem(item.key)}
                    aria-label={`ลบ ${courtName(item.courtId)} เวลา ${formatHour(item.hour)}`}
                    title="ลบรายการนี้"
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1Zm1 4a1 1 0 0 0-1 1v9a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v9a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="summary-line">
            <span className="muted">ผู้จอง</span>
            <strong style={{ fontWeight: 600 }}>
              {isLoggedIn ? (bookerName ?? "บัญชีของคุณ") : "ยังไม่ได้เข้าสู่ระบบ"}
            </strong>
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
        </section>
      )}

      {/* Always in reach: what is chosen, the price, and one button */}
      <div className="booking-sticky-bar" aria-live="polite">
        {error && <p className="error booking-sticky-error">{error}</p>}
        <div className="booking-sticky-row">
          <div className="booking-sticky-summary">
            {effectiveItems.length === 0 ? (
              <span className="muted">เลือกเวลาที่ต้องการด้านบน</span>
            ) : effectiveItems.length === 1 ? (
              <span className="booking-sticky-line">{itemLine(effectiveItems[0])}</span>
            ) : (
              <span className="booking-sticky-line">
                {effectiveItems.length} รายการ · รวม {totalHours} ชม.
              </span>
            )}
            {effectiveItems.length > 0 && (
              <strong className="booking-sticky-total">{payable.toLocaleString("th-TH")} บาท</strong>
            )}
          </div>
          <button
            className="btn booking-sticky-btn"
            type="button"
            onClick={book}
            disabled={effectiveItems.length === 0 || pending}
          >
            {pending
              ? "กำลังจอง…"
              : !isLoggedIn
              ? "เข้าสู่ระบบเพื่อจอง"
              : isCoach && payLater
              ? "จองและชำระภายหลัง"
              : "จองเลย"}
          </button>
        </div>
      </div>
    </div>
  );
}
