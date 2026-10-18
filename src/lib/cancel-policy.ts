import { BANGKOK_OFFSET } from "./config";
import { bangkokDate } from "./slots";

// Keep in sync with self_cancel_deadline() in migration 0013.
export const SELF_CANCEL_HOUR = 12;

/** 12:00 Bangkok on the day of play, or the start time if that comes first. */
export function selfCancelDeadline(startsAt: string): Date {
  const start = new Date(startsAt);
  const noon = new Date(`${bangkokDate(start)}T${String(SELF_CANCEL_HOUR).padStart(2, "0")}:00:00${BANGKOK_OFFSET}`);
  return noon < start ? noon : start;
}

export function canSelfCancel(startsAt: string, now: Date = new Date()): boolean {
  return now < selfCancelDeadline(startsAt);
}
