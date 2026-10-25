import { createDailySummaryHandler } from "@/lib/telegram/daily-summary";
import { sendTelegramDailySummary } from "@/lib/telegram/notify";

/**
 * POST /api/telegram/daily-summary?kind=morning|closing - sends the daily summary
 * to the shop's Telegram group.
 *
 * Called by the GitHub Actions schedule in .github/workflows/telegram-daily-summary.yml
 * with `Authorization: Bearer <CRON_SECRET>`. Without CRON_SECRET set on the server
 * it answers 503 and sends nothing.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return createDailySummaryHandler({ secret: process.env.CRON_SECRET, send: sendTelegramDailySummary })(request);
}
