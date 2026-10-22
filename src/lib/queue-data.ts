import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCourtQueues, type CourtQueueRow, type CourtQueueView, type QueueBoardRow } from "./queue";

/** Every active court with its queue, read live (the board changes by the second). */
export async function loadCourtQueues(
  supabase: SupabaseClient,
  courts: readonly { id: number; name: string }[],
): Promise<CourtQueueView[] | null> {
  const [queues, board] = await Promise.all([
    supabase.from("court_queues").select("court_id, is_open, players_per_game").returns<CourtQueueRow[]>(),
    supabase
      .from("queue_board")
      .select("entry_id, court_id, name, status, queued_at, called_at")
      .returns<QueueBoardRow[]>(),
  ]);
  if (queues.error || board.error) {
    console.error("Failed to load the play queue:", queues.error ?? board.error);
    return null;
  }
  return buildCourtQueues(courts, queues.data, board.data);
}
