export const PARTY_CAPACITY = 12;
export const PARTY_GAME_MINUTES = 15;
export const PARTY_NAME_MAX = 30;
export const PARTY_TITLE_MAX = 60;

export type PartyMode = "singles" | "doubles";
export type PartyTeam = "A" | "B" | "C" | "D" | "E" | "F";
export type PartyMember = { entry_id: string; name: string; slot_no: number; team: PartyTeam; avatar_url?: string | null };
export type PartyMatch = { index: number; startsAt: string; sideA: string[]; sideB: string[] };
export type PartyTeamMatch = { index: number; startsAt: string; teamA: PartyTeam; teamB: PartyTeam };
export const PARTY_TEAMS: PartyTeam[] = ["A", "B", "C", "D", "E", "F"];

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
