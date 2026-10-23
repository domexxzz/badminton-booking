export const PARTY_CAPACITY = 12;
export const PARTY_GAME_MINUTES = 15;
export const PARTY_NAME_MAX = 30;
export const PARTY_TITLE_MAX = 60;

export type PartyMode = "singles" | "doubles";
/** Listed for everyone, or unlisted and opened with a six-character code (0031). */
export type PartyVisibility = "public" | "private";
/** A ranked night moves the shop ladder; a casual one never does (0031). */
export type PartyScoring = "ranked" | "casual";
export const PARTY_CODE_LENGTH = 6;
/** What find_party_by_code() shows before the player commits to a slot. */
export type PartyPreview = {
  party_id: string; title: string; host_name: string; mode: PartyMode; scoring: PartyScoring;
  court_id: number; starts_at: string; ends_at: string; capacity: number; members: number;
};
export type PartyTeam = "A" | "B" | "C" | "D" | "E" | "F";
export type PartyMember = { entry_id: string; name: string; slot_no: number; team: PartyTeam; avatar_url?: string | null };
export type PartyMatch = { index: number; startsAt: string; sideA: string[]; sideB: string[] };
export type PartyTeamMatch = { index: number; startsAt: string; teamA: PartyTeam; teamB: PartyTeam };
export const PARTY_TEAMS: PartyTeam[] = ["A", "B", "C", "D", "E", "F"];

/** Matches K in party_elo_delta() (migration 0029). */
export const ELO_K = 24;

/**
 * How many points the winner takes from the loser, so the room can show what a game is
 * worth before it is played. This has to agree with party_elo_delta() in the database,
 * which is the value that actually gets written; scripts/sandbox.mjs compares the two.
 */
export function eloDelta(winnerRating: number, loserRating: number): number {
  const expected = 1 / (1 + 10 ** ((loserRating - winnerRating) / 400));
  return Math.max(1, Math.round(ELO_K * (1 - expected)));
}

const addMinutes = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

/** Standard round-robin pairs, flattened in round order for a single court. */
function roundRobin<T>(items: T[]): [T, T][] {
  const list: (T | null)[] = [...items];
  if (list.length % 2) list.push(null);
  const result: [T, T][] = [];
  for (let round = 0; round < list.length - 1; round += 1) {
    for (let i = 0; i < list.length / 2; i += 1) {
      const a = list[i];
      const b = list[list.length - 1 - i];
      if (a !== null && b !== null) result.push([a, b]);
    }
    list.splice(1, 0, list.pop()!);
  }
  return result;
}

/** Publishes the full timetable immediately, even while team slots are empty. */
export function buildPartyTeamSchedule(startsAt: string, endsAt: string): PartyTeamMatch[] {
  const pairings = roundRobin(PARTY_TEAMS);
  const available = Math.max(0, Math.floor((Date.parse(endsAt) - Date.parse(startsAt)) / (PARTY_GAME_MINUTES * 60_000)));
  return Array.from({ length: available }, (_, index) => {
    const [teamA, teamB] = pairings[index % pairings.length];
    return { index: index + 1, startsAt: addMinutes(startsAt, index * PARTY_GAME_MINUTES), teamA, teamB };
  });
}

export function buildPartyMatches(
  mode: PartyMode,
  members: readonly PartyMember[],
  startsAt: string,
  endsAt: string,
): PartyMatch[] {
  const slots = [...members].sort((a, b) => a.slot_no - b.slot_no);
  const sides: string[][] = mode === "singles"
    ? slots.map((m) => [m.name])
    : Array.from({ length: PARTY_CAPACITY / 2 }, (_, i) =>
        slots.filter((m) => m.slot_no === i * 2 + 1 || m.slot_no === i * 2 + 2).map((m) => m.name),
      ).filter((team) => team.length === 2);
  if (sides.length < 2) return [];
  const pairings = roundRobin(sides);
  const available = Math.max(0, Math.floor((Date.parse(endsAt) - Date.parse(startsAt)) / (PARTY_GAME_MINUTES * 60_000)));
  return Array.from({ length: available }, (_, index) => {
    const [a, b] = pairings[index % pairings.length];
    return { index: index + 1, startsAt: addMinutes(startsAt, index * PARTY_GAME_MINUTES), sideA: a, sideB: b };
  });
}
