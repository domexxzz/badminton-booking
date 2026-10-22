// Helpers for lessons with a coach (migration 0019). Pure functions only.

export const LESSON_HOUR_OPTIONS = [1, 1.5, 2, 3] as const;
export const LESSON_PRICE_MAX = 5000;
export const COACH_BIO_MAX = 500;
export const COACH_NAME_MAX = 60;

/** Matches extract(dow): 0 = Sunday. */
export const WEEKDAY_LABELS = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"] as const;
export const WEEKDAY_SHORT = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

export type AvailabilitySlot = { weekday: number; start_minute: number; end_minute: number };

/** 1110 -> "18:30". Minutes since midnight, Bangkok. */
export function formatMinute(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute % 60;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** "18:30" -> 1110, or null when it is not a half-hour time of day. */
export function parseMinute(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const minute = Number(match[1]) * 60 + Number(match[2]);
  if (minute < 0 || minute > 1440 || minute % 30 !== 0) return null;
  return minute;
}

/** True when the slot is one the database will accept. */
export function isValidSlot(slot: AvailabilitySlot): boolean {
  return (
    Number.isInteger(slot.weekday) &&
    slot.weekday >= 0 &&
    slot.weekday <= 6 &&
    Number.isInteger(slot.start_minute) &&
    Number.isInteger(slot.end_minute) &&
    slot.start_minute % 30 === 0 &&
    slot.end_minute % 30 === 0 &&
    slot.start_minute >= 0 &&
    slot.end_minute <= 1440 &&
    slot.end_minute > slot.start_minute
  );
}

/** Weekly hours in one list per weekday, each sorted by time. */
export function slotsByWeekday(slots: readonly AvailabilitySlot[]): AvailabilitySlot[][] {
  return WEEKDAY_LABELS.map((_, weekday) =>
    slots.filter((s) => s.weekday === weekday).sort((a, b) => a.start_minute - b.start_minute),
  );
}

/** "จ 17:00–21:00 · ส 09:00–12:00", for a coach card. */
export function summariseAvailability(slots: readonly AvailabilitySlot[]): string {
  return slotsByWeekday(slots)
    .flatMap((daySlots, weekday) =>
      daySlots.map((s) => `${WEEKDAY_SHORT[weekday]} ${formatMinute(s.start_minute)}–${formatMinute(s.end_minute)}`),
    )
    .join(" · ");
}

export function lessonFee(pricePerHour: number, hours: number): number {
  return Math.round(pricePerHour * hours);
}

/** What the customer pays: court time plus the lesson fee. */
export function lessonTotal(courtPricePerHour: number, pricePerHour: number, hours: number): number {
  return Math.round(courtPricePerHour * hours) + lessonFee(pricePerHour, hours);
}

/**
 * The open start times from `coach_open_starts`, which returns a set of timestamps.
 * PostgREST may hand back bare strings or one-key rows depending on the version, so
 * accept both rather than risk an empty page.
 */
export function toStartTimes(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => {
      if (typeof row === "string") return row;
      if (row && typeof row === "object") {
        const first = Object.values(row).find((v) => typeof v === "string");
        return typeof first === "string" ? first : null;
      }
      return null;
    })
    .filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value)));
}

export function isLessonHours(hours: number): boolean {
  return (LESSON_HOUR_OPTIONS as readonly number[]).includes(hours);
}
