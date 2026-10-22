// Shapes the public queue board (0018) into one view per court.

export type QueueStatus = "waiting" | "playing";

export type QueueBoardRow = {
  entry_id: string;
  court_id: number;
  name: string;
  status: QueueStatus;
  queued_at: string;
  called_at: string | null;
};

export type CourtQueueRow = { court_id: number; is_open: boolean; players_per_game: number };

export type CourtQueueView = {
  courtId: number;
  courtName: string;
  isOpen: boolean;
  playersPerGame: number;
  playing: QueueBoardRow[];
  waiting: QueueBoardRow[];
};

export const QUEUE_NAME_MAX = 30;
export const DEFAULT_PLAYERS_PER_GAME = 4;

const byTime = (key: "queued_at" | "called_at") => (a: QueueBoardRow, b: QueueBoardRow) =>
  (a[key] ?? "").localeCompare(b[key] ?? "") || a.entry_id.localeCompare(b.entry_id);

export function buildCourtQueues(
  courts: readonly { id: number; name: string }[],
  queues: readonly CourtQueueRow[],
  board: readonly QueueBoardRow[],
): CourtQueueView[] {
  return courts.map((court) => {
    const queue = queues.find((q) => q.court_id === court.id);
    const rows = board.filter((r) => r.court_id === court.id);
    return {
      courtId: court.id,
      courtName: court.name,
      isOpen: queue?.is_open === true,
      playersPerGame: queue?.players_per_game ?? DEFAULT_PLAYERS_PER_GAME,
      playing: rows.filter((r) => r.status === "playing").sort(byTime("called_at")),
      waiting: rows.filter((r) => r.status === "waiting").sort(byTime("queued_at")),
    };
  });
}

/** 1-based place among the waiting players, or null when not waiting on this court. */
export function waitingPosition(view: CourtQueueView, entryId: string): number | null {
  const index = view.waiting.findIndex((r) => r.entry_id === entryId);
  return index === -1 ? null : index + 1;
}

/** How many games start before this place goes on: 0 means the next game. */
export function gamesAhead(position: number, playersPerGame: number): number {
  return Math.floor((position - 1) / Math.max(1, playersPerGame));
}

/** Splits the waiting line into the games it will play, so each player sees their game. */
export function chunkIntoGames(rows: readonly QueueBoardRow[], playersPerGame: number): QueueBoardRow[][] {
  const size = Math.max(1, playersPerGame);
  const games: QueueBoardRow[][] = [];
  for (let i = 0; i < rows.length; i += size) games.push(rows.slice(i, i + size));
  return games;
}

/** Tidies a nickname the same way the database does; null when nothing is left. */
export function cleanQueueName(name: string): string | null {
  const cleaned = name.trim().replace(/\s+/g, " ").slice(0, QUEUE_NAME_MAX);
  return cleaned === "" ? null : cleaned;
}
