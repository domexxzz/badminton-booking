import { readCourtStatus } from "@/lib/court-status-data";

/**
 * GET /api/court-status - how many courts are free right now.
 *
 * Public and read-only: no authentication, no cookies, no personal data. It
 * answers one aggregate reading of `court_occupancy`, the PII-free mirror
 * migration 0001 made for the public board, and says when it was read.
 *
 * ChivaGo (the sustainable-tourism app) calls this when someone opens
 * แบดมินตัน@สินธานี's place screen, behind its own cache, and shows the figure
 * above its "Book" button. Nothing is written and nothing about a booker is
 * returned, so this is safe to leave open; a caller that cannot be reached
 * gets a 503 and says so, which is what that app expects.
 *
 *   { "ok": true, "data": { "courts": { "total": 4, "free": 2, "busy": 2 },
 *                           "openNow": true, "nextOpenAt": null,
 *                           "observedAt": 1761296400000 } }
 *
 * `free` is the count whether the venue is open or shut; `openNow` is the
 * separate fact, against the venue's own hours on Bangkok's clock, with
 * `nextOpenAt` (epoch ms) when it is shut. Never a guessed zero: when the
 * database cannot be read this answers 503 { ok: false }, so the caller can
 * tell "no courts free" from "we could not look".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public aggregate numbers, so any origin may read them - the ChivaGo web demo
// asks from the browser. Nothing here is per-caller, so no credentials ever.
const HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  // Half a minute: the figure moves when a booking starts or a hold lapses,
  // and a caller refreshing faster than that learns nothing new.
  "cache-control": "public, max-age=30, stale-while-revalidate=30",
} as const;

export async function GET() {
  const status = await readCourtStatus();
  if (!status) {
    return new Response(JSON.stringify({ ok: false, error: "court status could not be read" }), {
      status: 503,
      headers: { ...HEADERS, "cache-control": "no-store" },
    });
  }
  const { total, free, busy, openNow, nextOpenAt, observedAt } = status;
  return new Response(
    JSON.stringify({ ok: true, data: { courts: { total, free, busy }, openNow, nextOpenAt, observedAt } }),
    { status: 200, headers: HEADERS },
  );
}
