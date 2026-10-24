/**
 * How many courts are free right now - one public number, and nothing else.
 *
 * ChivaGo (the sustainable-tourism app) shows this on the venue's place screen
 * so a student can see whether it is worth the trip before tapping through to
 * book. It is read on every place-screen open, behind that app's cache, so it
 * must stay cheap: three selects of already-public rows, no joins, no writes.
 *
 * Nothing here touches a booker. `court_occupancy` is the PII-free mirror
 * migration 0001 created for the public board - court, time, held-or-booked -
 * and this counts rows in it. No name, no phone, no user id, not even a
 * booking id leaves the building, whatever the caller asks for.
 *
 * Pure: the counting is here and the reading is in court-status-data.ts, so
 * every rule below is tested without a database.
 */

import { getVenueStatus, slotStart, type Occupancy } from "./slots";

/** What one reading of the courts says. Times are epoch milliseconds. */
export type CourtStatus = {
  /** Active courts the venue has. */
  total: number;
  /** Free right now. Never negative, never more than `total`. */
  free: number;
  /** Taken right now by a booking or a hold that has not lapsed. */
  busy: number;
  /** Against the venue's own opening hours, on Bangkok's clock. */
  openNow: boolean;
  /** When it opens next, when it is shut now; null while it is open. */
  nextOpenAt: number | null;
  /** When these figures were read. */
  observedAt: number;
};

/** The occupancy columns this needs - a subset, so the query can select only these. */
export type OccupancyRow = Pick<Occupancy, "court_id" | "state" | "starts_at" | "ends_at" | "hold_expires_at">;

/**
 * Whether a row takes a court off the floor at `now`.
 *
 * A held slot whose `hold_expires_at` has passed does NOT: migration 0002 says
 * in as many words that the board shows a stale hold as free, and this number
 * must agree with the board a customer is looking at. `expire_holds()` clears
 * them a minute later; until it does, the court is free here too.
 */
function holdsCourt(row: OccupancyRow, now: number): boolean {
  const starts = Date.parse(row.starts_at);
  const ends = Date.parse(row.ends_at);
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) return false;
  if (now < starts || now >= ends) return false;
  if (row.state !== "held") return true;
  const until = row.hold_expires_at === null ? null : Date.parse(row.hold_expires_at);
  return until === null || !Number.isFinite(until) || until > now;
}

/**
 * The courts taken right now, counted once each.
 *
 * `active` keeps a row for a court the venue has switched off out of the count:
 * such a court is in neither `total` nor `busy`, so `free` cannot come out
 * larger than the floor.
 */
export function busyCourtIds(rows: readonly OccupancyRow[], active: ReadonlySet<number>, now: number): Set<number> {
  const busy = new Set<number>();
  for (const row of rows) {
    if (!active.has(row.court_id)) continue;
    if (holdsCourt(row, now)) busy.add(row.court_id);
  }
  return busy;
}

/**
 * One reading of the courts, from the active court ids, the occupancy rows
 * overlapping now, and the venue's hours.
 *
 * `free` is reported whether the venue is open or shut - it is the count, and
 * `openNow` is the other fact. Reading one without the other is the caller's
 * business; this says both rather than folding a closed venue into "0 free",
 * which would read as "full".
 */
export function courtStatus(input: {
  courtIds: readonly number[];
  occupancy: readonly OccupancyRow[];
  openHour: number;
  closeHour: number;
  now?: number;
}): CourtStatus {
  const now = input.now ?? Date.now();
  const active = new Set(input.courtIds);
  const busy = busyCourtIds(input.occupancy, active, now);
  const status = getVenueStatus(new Date(now), input.openHour, input.closeHour);
  return {
    total: active.size,
    free: active.size - busy.size,
    busy: busy.size,
    openNow: status.isOpen,
    nextOpenAt: status.isOpen ? null : Date.parse(slotStart(status.targetDateStr, status.targetHour)),
    observedAt: now,
  };
}
