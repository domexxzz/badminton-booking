import { describe, expect, it } from "vitest";
import { buildCourtQueues, chunkIntoGames, cleanQueueName, gamesAhead, waitingPosition, type QueueBoardRow } from "../src/lib/queue";

const row = (id: string, court: number, status: "waiting" | "playing", queued: string, called: string | null = null): QueueBoardRow => ({
  entry_id: id,
  court_id: court,
  name: `ผู้เล่น ${id}`,
  status,
  queued_at: `2026-10-22T${queued}:00+07:00`,
  called_at: called && `2026-10-22T${called}:00+07:00`,
});

const courts = [
  { id: 1, name: "สนาม 1" },
  { id: 2, name: "สนาม 2" },
];

describe("buildCourtQueues", () => {
  it("splits each court into playing and waiting, in line order", () => {
    const board = [
      row("c", 1, "waiting", "19:10"),
      row("a", 1, "playing", "19:00", "19:20"),
      row("b", 1, "waiting", "19:05"),
      row("x", 2, "waiting", "19:00"),
    ];
    const [one, two] = buildCourtQueues(courts, [{ court_id: 1, is_open: true, players_per_game: 2 }], board);

    expect(one).toMatchObject({ courtName: "สนาม 1", isOpen: true, playersPerGame: 2 });
    expect(one.playing.map((r) => r.entry_id)).toEqual(["a"]);
    expect(one.waiting.map((r) => r.entry_id)).toEqual(["b", "c"]);
    expect(two.waiting.map((r) => r.entry_id)).toEqual(["x"]);
  });

  it("treats a court without a queue row as closed doubles", () => {
    const [one] = buildCourtQueues(courts, [], []);
    expect(one).toMatchObject({ isOpen: false, playersPerGame: 4, playing: [], waiting: [] });
  });
});

describe("waitingPosition and gamesAhead", () => {
  const [view] = buildCourtQueues(courts, [{ court_id: 1, is_open: true, players_per_game: 4 }], [
    row("a", 1, "waiting", "19:00"),
    row("b", 1, "waiting", "19:01"),
    row("p", 1, "playing", "18:00", "19:00"),
  ]);

  it("counts places from 1 among waiting players only", () => {
    expect(waitingPosition(view, "b")).toBe(2);
    expect(waitingPosition(view, "p")).toBeNull();
    expect(waitingPosition(view, "missing")).toBeNull();
  });

  it("tells how many games come first", () => {
    expect(gamesAhead(1, 4)).toBe(0);
    expect(gamesAhead(4, 4)).toBe(0);
    expect(gamesAhead(5, 4)).toBe(1);
    expect(gamesAhead(3, 2)).toBe(1);
  });
});

describe("chunkIntoGames", () => {
  it("groups the line by players per game, last game may be short", () => {
    const rows = ["a", "b", "c", "d", "e"].map((id, i) => row(id, 1, "waiting", `19:0${i}`));
    expect(chunkIntoGames(rows, 2).map((g) => g.map((r) => r.entry_id))).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(chunkIntoGames([], 4)).toEqual([]);
  });
});

describe("cleanQueueName", () => {
  it("trims, squeezes spaces and caps the length like the database", () => {
    expect(cleanQueueName("  เอ   ตัวจริง ")).toBe("เอ ตัวจริง");
    expect(cleanQueueName("x".repeat(40))).toHaveLength(30);
    expect(cleanQueueName("   ")).toBeNull();
  });
});
