import { BANGKOK_OFFSET, BANGKOK_OFFSET_MS, BOOKING_RULES } from "./config";

export type Occupancy = {
  booking_id: string;
  court_id: number;
  starts_at: string;
  ends_at: string;
  state: "held" | "booked";
  hold_expires_at: string | null;
};

export type CellState = "free" | "held" | "booked" | "past";

export type OccupancyChange =
  | { eventType: "INSERT" | "UPDATE"; new: Occupancy }
  | { eventType: "DELETE"; old: Partial<Occupancy> };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const pad2 = (n: number) => n.toString().padStart(2, "0");

/** YYYY-MM-DD of the given instant in Asia/Bangkok. */
export function bangkokDate(at: Date): string {
  return new Date(at.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** ISO instant for `hour` o'clock on `date` in Bangkok (hour can be decimal, e.g. 17.5 = 17:30). */
export function slotStart(date: string, hour: number): string {
  const base = Date.parse(`${date}T00:00:00${BANGKOK_OFFSET}`);
  return new Date(base + Math.round(hour * HOUR_MS)).toISOString();
}

export function upcomingDates(now: Date, count: number): string[] {
  const first = Date.parse(`${bangkokDate(now)}T00:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(first + i * DAY_MS).toISOString().slice(0, 10));
}

export function openingHours(open: number = BOOKING_RULES.openHour, close: number = BOOKING_RULES.closeHour): number[] {
  return Array.from({ length: close - open }, (_, i) => open + i);
}

export function openingSlots(step = 0.5, open: number = BOOKING_RULES.openHour, close: number = BOOKING_RULES.closeHour): number[] {
  const count = Math.round((close - open) / step);
  return Array.from({ length: count }, (_, i) => Number((open + i * step).toFixed(2)));
}

export type VenueStatus = {
  isOpen: boolean;
  isTodayClosed: boolean;
  isBeforeOpen: boolean;
  currentBangkokHour: number;
  bangkokDateStr: string;
  tomorrowDateStr: string;
  targetDateStr: string;
  targetHour: number;
  targetType: "open" | "close";
  remainingMs: number;
  remainingHours: number;
  remainingMinutes: number;
  remainingSeconds: number;
};

export function getVenueStatus(
  now: Date = new Date(),
  openHour: number = BOOKING_RULES.openHour,
  closeHour: number = BOOKING_RULES.closeHour
): VenueStatus {
  const bkkTime = now.getTime() + BANGKOK_OFFSET_MS;
  const bkkDate = new Date(bkkTime);
  const y = bkkDate.getUTCFullYear();
  const m = bkkDate.getUTCMonth();
  const d = bkkDate.getUTCDate();
  const h = bkkDate.getUTCHours();
  const min = bkkDate.getUTCMinutes();
  const sec = bkkDate.getUTCSeconds();
  const currentBangkokHour = h + min / 60 + sec / 3600;
  const bangkokDateStr = `${y}-${pad2(m + 1)}-${pad2(d)}`;

  const tomorrowBkk = new Date(bkkTime + DAY_MS);
  const tomorrowDateStr = `${tomorrowBkk.getUTCFullYear()}-${pad2(tomorrowBkk.getUTCMonth() + 1)}-${pad2(tomorrowBkk.getUTCDate())}`;

  const isOpen = currentBangkokHour >= openHour && currentBangkokHour < closeHour;
  const isTodayClosed = currentBangkokHour >= closeHour;
  const isBeforeOpen = currentBangkokHour < openHour;

  let targetType: "open" | "close";
  let targetHour: number;
  let targetDateStr: string;

  if (isOpen) {
    targetType = "close";
    targetHour = closeHour;
    targetDateStr = bangkokDateStr;
  } else if (isTodayClosed) {
    targetType = "open";
    targetHour = openHour;
    targetDateStr = tomorrowDateStr;
  } else {
    targetType = "open";
    targetHour = openHour;
    targetDateStr = bangkokDateStr;
  }

  const targetInstant = Date.parse(slotStart(targetDateStr, targetHour));
  const remainingMs = Math.max(0, targetInstant - now.getTime());
  const totalSec = Math.floor(remainingMs / 1000);
  const remainingHours = Math.floor(totalSec / 3600);
  const remainingMinutes = Math.floor((totalSec % 3600) / 60);
  const remainingSeconds = totalSec % 60;

  return {
    isOpen,
    isTodayClosed,
    isBeforeOpen,
    currentBangkokHour,
    bangkokDateStr,
    tomorrowDateStr,
    targetDateStr,
    targetHour,
    targetType,
    remainingMs,
    remainingHours,
    remainingMinutes,
    remainingSeconds,
  };
}

/** Holds whose payment window has lapsed no longer block the slot. */
export function isActive(o: Occupancy, now: Date): boolean {
  if (o.state === "booked") return true;
  return o.hold_expires_at === null || Date.parse(o.hold_expires_at) > now.getTime();
}

export function cellState(
  courtId: number,
  date: string,
  hour: number,
  occupancy: readonly Occupancy[],
  now: Date,
  durationHours = 0.5,
): CellState {
  const start = Date.parse(slotStart(date, hour));
  const end = start + Math.round(durationHours * HOUR_MS);
  const hit = occupancy.find(
    (o) =>
      o.court_id === courtId &&
      isActive(o, now) &&
      Date.parse(o.starts_at) < end &&
      Date.parse(o.ends_at) > start,
  );
  if (hit) return hit.state;
  if (start <= now.getTime()) return "past";
  return "free";
}

/** How many consecutive free hours (in 0.5-hour steps) can be booked starting at `hour`. */
export function maxBookableHours(
  courtId: number,
  date: string,
  hour: number,
  occupancy: readonly Occupancy[],
  now: Date,
  step = 0.5,
  closeHour: number = BOOKING_RULES.closeHour,
): number {
  let hours = 0;
  while (
    hours + step <= BOOKING_RULES.maxHours + 1e-6 &&
    hour + hours + step <= closeHour + 1e-6 &&
    cellState(courtId, date, hour + hours, occupancy, now, step) === "free"
  ) {
    hours = Number((hours + step).toFixed(2));
  }
  return hours;
}

export function applyOccupancyChange(list: readonly Occupancy[], change: OccupancyChange): Occupancy[] {
  if (change.eventType === "DELETE") {
    return list.filter((o) => o.booking_id !== change.old.booking_id);
  }
  const without = list.filter((o) => o.booking_id !== change.new.booking_id);
  return [...without, change.new];
}

export function formatHour(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${pad2(h)}:${pad2(m)}`;
}
