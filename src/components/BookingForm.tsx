"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { createBooking } from "@/app/actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht, formatDayShort, formatDuration } from "@/lib/format";
import {
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
const DURATIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const STEPS = ["เลือกเวลา", "เลือกสนาม", "ยืนยัน"] as const;

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
  const [hour, setHour] = useState<number | null>(initial.hour ?? null);
  const [hours, setHours] = useState(0.5);
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

  // Courts that are completely free for the currently selected [hour, hour + hours] window
  const freeCourtsForCurrentWindow =
    hour !== null
      ? courts.filter((c) => getAvailableHoursForCourt(c.id, date, hour) >= hours)
      : [];

  // The time grid: every half hour by default.
  const slotStep = 0.5;
  const slots = openingSlots(slotStep, openHour, closeHour);
  const freeCourtsAt = (h: number) => courts.filter((c) => getAvailableHoursForCourt(c.id, date, h) >= slotStep);

  const currentStep = effectiveItems.length === 0 ? 1 : hour !== null ? 2 : 3;

  function changeDate(next: string) {
    setDate(next);
    setHour(null);
    setAwaitingEnd(false);
    setError(null);
  }

  function pickTime(h: number) {
    setError(null);
    // Keep the court the customer already had if it is free; otherwise the first free one.
    const keep = getAvailableHoursForCourt(activeCourtId, date, h) >= slotStep;
    const courtId = keep ? activeCourtId : (freeCourtsAt(h)[0]?.id ?? activeCourtId);
    setActiveCourtId(courtId);
    setHour(h);
    setHours(0.5);
  }

  // Like a hotel calendar: the first tap is the start, the next tap later in the day is the
  // end. A tap after that starts a new choice. One tap alone still books the default hour.
  const [awaitingEnd, setAwaitingEnd] = useState(false);

  function tapSlot(h: number) {
    if (hour !== null && awaitingEnd && h > hour) {
      const tooLong = h + slotStep - hour > BOOKING_RULES.maxHours;
      if (!selectRange(hour, h)) {
        setError("ช่วงนี้ไม่มีสนามว่างต่อเนื่องตลอด ลองเลือกเวลาจบที่เร็วขึ้น");
        return;
      }
      setAwaitingEnd(false);
      // selectRange caps the stretch at the longest booking allowed; say so.
      if (tooLong) setError(`จองต่อเนื่องได้สูงสุด ${BOOKING_RULES.maxHours} ชม. เลือกให้ ${BOOKING_RULES.maxHours} ชม. แล้ว`);
      return;
    }
    if (hour !== null && awaitingEnd && h === hour) {
      setAwaitingEnd(false);
      return;
    }
    pickTime(h);
    setAwaitingEnd(true);
  }

  // Dragging across the grid picks one continuous stretch of time. On a phone the drag
  // starts on the block already chosen, so a swipe anywhere else still scrolls the page;
  // with a mouse it can start on any free slot.
  const gridRef = useRef<HTMLDivElement>(null);
  // anchor = the end of the stretch that stays put; null until the first move shows the direction.
  const dragRef = useRef<{
    anchor: number | null;
    origin: number;
    first: number;
    lastSlot: number;
    last: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);

  /** Selects [a, b] (slot starts, either order) if one court is free for all of it. */
  function selectRange(a: number, b: number): boolean {
    const start = Math.min(a, b);
    const length = Math.min(Math.max(a, b) + slotStep - start, BOOKING_RULES.maxHours);
    const fits = (courtId: number) => getAvailableHoursForCourt(courtId, date, start) >= length;
    const courtId = fits(activeCourtId) ? activeCourtId : courts.find((c) => fits(c.id))?.id;
    if (courtId === undefined) return false;
    setError(null);
    setActiveCourtId(courtId);
    setHour(start);
    setHours(length);
    return true;
  }

  function startDrag(e: React.PointerEvent, h: number) {
    const inSelection = hour !== null && h >= hour && h < hour + hours;
    if (e.pointerType !== "mouse" && !inSelection) return;
    if (!inSelection && !selectRange(h, h)) return;
    const first = inSelection ? (hour as number) : h;
    const lastSlot = inSelection ? (hour as number) + hours - slotStep : h;
    dragRef.current = { anchor: inSelection ? null : h, origin: h, first, lastSlot, last: h, moved: false };
    try {
      gridRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (a very quick tap): nothing to follow.
    }
  }

  function moveDrag(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-slot]");
    const h = el ? Number(el.dataset.slot) : NaN;
    if (Number.isNaN(h) || h === drag.last) return;
    drag.last = h;
    // Grabbing the last slot moves the end; pulling the first slot back moves the start;
    // anything else moves the end, so "tap a time, then drag on" always lengthens.
    if (drag.anchor === null) {
      const grabbedEnd = drag.origin === drag.lastSlot && drag.lastSlot !== drag.first;
      drag.anchor = !grabbedEnd && h < drag.origin && drag.origin === drag.first ? drag.lastSlot : drag.first;
    }
    // A stretch with no court free all the way is skipped: the last good one stays chosen.
    if (selectRange(drag.anchor, h)) drag.moved = true;
  }

  function endDrag() {
    if (dragRef.current?.moved) {
      suppressClickRef.current = true;
      setAwaitingEnd(false);
    }
    dragRef.current = null;
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

  function addAllFreeCourtsForCurrentWindow() {
    if (hour === null || freeCourtsForCurrentWindow.length === 0) return;
    const toAdd: CartItem[] = freeCourtsForCurrentWindow.map((c) => ({
      key: `${date}-${c.id}-${hour}`,
      courtId: c.id,
      date,
      hour,
      hours,
    }));
    setCartItems([...cartItems, ...toAdd].slice(0, MAX_CART_ITEMS));
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
    <div className="stack booking-cart-page time-first-booking">
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

      {/* Step 1: a time, with how many courts are free at it */}
      <section className="card stack booking-picker-card" aria-labelledby="pick-time-title">
        <div className="booking-section-title">
          <span id="pick-time-title">เลือกเวลา</span>
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

        <div
          ref={gridRef}
          className="hour-slot-grid half-hours"
          aria-busy={!loaded}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
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
            const free = freeCourtsAt(h);
            const freeIds = new Set(free.map((c) => c.id));
            const isSelected = h === hour;
            const inRange = hour !== null && h > hour && h < hour + hours;
            const disabled = free.length === 0 && !isSelected && !inRange;
            return (
              <button
                key={h}
                type="button"
                className={`hour-slot ${isSelected ? "selected" : inRange ? "in-range" : disabled ? "full" : "free"}`}
                disabled={disabled}
                aria-pressed={isSelected || inRange}
                aria-label={`${formatHour(h)} ถึง ${formatHour(h + slotStep)} ${
                  free.length > 0 ? `ว่าง ${free.length} สนาม` : "เต็ม"
                }`}
                data-slot={h}
                onPointerDown={(e) => startDrag(e, h)}
                onClick={() => {
                  // The click that ends a drag must not shrink the stretch back to one slot.
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false;
                    return;
                  }
                  tapSlot(h);
                }}
              >
                <span className="hour-slot-time">
                  {formatHour(h)} – {formatHour(h + slotStep)}
                </span>
                <span className="hour-slot-dots" aria-hidden="true">
                  {courts.map((c) => (
                    <span key={c.id} className={`court-dot ${freeIds.has(c.id) ? "free" : "taken"}`} />
                  ))}
                </span>
                <span className="hour-slot-note">
                  {isSelected
                    ? awaitingEnd
                      ? "เริ่ม · แตะเวลาจบ"
                      : "เริ่ม"
                    : hour !== null && hours > slotStep && h === hour + hours - slotStep
                    ? "จบ"
                    : free.length > 0
                    ? `ว่าง ${free.length} สนาม`
                    : "เต็ม"}
                </span>
              </button>
            );
          })}
        </div>

        {loaded && (
          <p className="booking-drag-hint">
            {hour === null
              ? "แตะเวลาเริ่ม แล้วแตะอีกช่องเป็นเวลาจบ (หรือลากก็ได้)"
              : awaitingEnd
              ? "แตะช่องเวลาจบ หรือกดจองได้เลยถ้าเล่นช่วงเดียว"
              : "แตะช่องอื่นเพื่อเลือกใหม่ หรือลากช่องสีเขียวเพื่อปรับเวลา"}
          </p>
        )}
      </section>

      {/* Step 2: which court, and for how long */}
      {hour !== null && (
        <section className="card stack booking-picker-card" aria-labelledby="pick-court-title">
          <div className="booking-section-title">
            <span id="pick-court-title">เลือกสนาม</span>
            <span className="badge confirmed" style={{ fontSize: 12.5, fontWeight: 600 }}>
              {formatHour(hour)} – {formatHour(hour + hours)} น.
            </span>
          </div>

          <div className="court-pick-grid" role="radiogroup" aria-label="เลือกสนาม">
            {courts.map((c) => {
              const avail = getAvailableHoursForCourt(c.id, date, hour);
              const isSelected = c.id === activeCourtId;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  className={`court-pick ${isSelected ? "selected" : avail > 0 ? "free" : "taken"}`}
                  disabled={avail === 0}
                  onClick={() => selectCourt(c.id)}
                >
                  <strong>{c.name}</strong>
                  <span>{avail > 0 ? `${c.price_per_hour}฿/ชม.` : "ไม่ว่างช่วงนี้"}</span>
                </button>
              );
            })}
          </div>

          <div className="field">
            <span className="booking-section-sub">เล่นนานเท่าไร</span>
            <div className="duration-scroller">
              {DURATIONS.map((h) => {
                const isSelected = h === hours;
                const isAvailable = h <= maxHours;
                return (
                  <button
                    key={h}
                    type="button"
                    className={`chip duration-chip ${isSelected ? "selected" : isAvailable ? "free" : "unavailable"}`}
                    disabled={!isAvailable}
                    onClick={() => setHours(h)}
                  >
                    <span className="duration-title">{durationLabel(h)}</span>
                    <span className="duration-sub">เลิก {formatHour(hour + h)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="booking-add-actions">
            <button type="button" className="booking-add-more-btn" onClick={addCurrentToCart}>
              ＋ เพิ่มลงรายการ แล้วเลือกสนาม/เวลาอื่นต่อ
            </button>
            {freeCourtsForCurrentWindow.length > 1 && (
              <button type="button" className="booking-add-all-courts-btn" onClick={addAllFreeCourtsForCurrentWindow}>
                ⚡ จองทุกสนามที่ว่างช่วงนี้ ({freeCourtsForCurrentWindow.length} สนาม)
              </button>
            )}
          </div>
        </section>
      )}

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
