import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getPublicCourts, getPublicVenueHours } from "./public-data";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase/env";
import { courtStatus, type CourtStatus, type OccupancyRow } from "./court-status";

/**
 * Reading the courts for the public status endpoint.
 *
 * The anon key, not the service role: this reads only what RLS already lets
 * anybody read, so a bug here cannot reach a booker's row. No cookies either -
 * the answer is the same for everyone, so one client serves every caller.
 *
 * Courts and hours come from the 60-second cache customer pages already use
 * (public-data.ts): they change a few times a year. Only the occupancy is read
 * live, because that is the number that moves.
 */

// Only the columns the count needs. court_occupancy carries no personal data at
// all, and booking_id is left out too: an id is nobody's business here.
const OCCUPANCY_COLUMNS = "court_id, state, starts_at, ends_at, hold_expires_at";

const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

/**
 * How many courts are free right now, or null when the database could not be
 * read. Null, never a zero: "no courts free" and "we could not look" are
 * different answers, and the caller must be able to tell them apart.
 */
export async function readCourtStatus(now = Date.now()): Promise<CourtStatus | null> {
  try {
    const nowIso = new Date(now).toISOString();
    const [courts, hours, occupancy] = await Promise.all([
      getPublicCourts(),
      getPublicVenueHours(),
      anon().from("court_occupancy").select(OCCUPANCY_COLUMNS).lte("starts_at", nowIso).gt("ends_at", nowIso),
    ]);
    if (!courts) throw new Error("courts could not be read");
    if (occupancy.error) throw occupancy.error;
    return courtStatus({
      courtIds: courts.map((c) => c.id),
      occupancy: (occupancy.data ?? []) as OccupancyRow[],
      openHour: hours.openHour,
      closeHour: hours.closeHour,
      now,
    });
  } catch (error) {
    console.error("Failed to read court status:", error);
    return null;
  }
}
