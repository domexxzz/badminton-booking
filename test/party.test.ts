import { describe, expect, it, test } from "vitest";
import { ELO_K, buildPartyMatches, buildPartyTeamSchedule, eloDelta, type PartyMember } from "../src/lib/party";
import { ELO_GRID } from "../scripts/lib/elo-grid.mjs";

const start = "2026-10-24T10:00:00.000Z";
const end = "2026-10-24T11:00:00.000Z";
const member = (slot: number, name = `P${slot}`): PartyMember => ({ entry_id: String(slot), name, slot_no: slot, team: slot % 2 ? "A" : "B" });

describe("party match rotation", () => {
  it("fills one hour with four 15-minute singles matches", () => {
    const matches = buildPartyMatches("singles", [1, 2, 3, 4].map((n) => member(n)), start, end);
    expect(matches).toHaveLength(4);
    expect(matches.map((m) => m.startsAt)).toEqual([
      "2026-10-24T10:00:00.000Z", "2026-10-24T10:15:00.000Z",
      "2026-10-24T10:30:00.000Z", "2026-10-24T10:45:00.000Z",
    ]);
  });

  it("uses complete adjacent pairs as doubles teams", () => {
    const matches = buildPartyMatches("doubles", [1, 2, 3, 4, 5].map((n) => member(n)), start, end);
    expect(matches).toHaveLength(4);
    expect(matches[0].sideA.sort()).toEqual(["P1", "P2"]);
    expect(matches[0].sideB.sort()).toEqual(["P3", "P4"]);
    expect(matches[3].sideA.sort()).toEqual(["P1", "P2"]);
  });

  it("returns no match until two sides are ready", () => {
    expect(buildPartyMatches("singles", [member(1)], start, end)).toEqual([]);
    expect(buildPartyMatches("doubles", [1, 2, 3].map((n) => member(n)), start, end)).toEqual([]);
  });

  it("shows team fixtures before any member joins", () => {
    const schedule = buildPartyTeamSchedule(start, end);
    expect(schedule).toHaveLength(4);
    expect(schedule[0]).toMatchObject({ teamA: "A", teamB: "F" });
  });
});

describe("eloDelta", () => {
  test("an even game is worth half of K", () => {
    expect(eloDelta(1000, 1000)).toBe(ELO_K / 2);
  });

  test("beating a much stronger player is worth more", () => {
    expect(eloDelta(1000, 1400)).toBeGreaterThan(eloDelta(1000, 1000));
    expect(eloDelta(1000, 1400)).toBe(22);
  });

  test("beating a much weaker player is worth almost nothing, but never nothing", () => {
    expect(eloDelta(1400, 1000)).toBe(2);
    expect(eloDelta(3000, 100)).toBe(1);
  });
});

describe("the points the room promises", () => {
  // scripts/sandbox.mjs checks party_elo_delta() against this same table, so what the
  // page shows before a game cannot drift from what the database writes after it.
  test.each(ELO_GRID)("%i beating %i is worth %i", (winner: number, loser: number, points: number) => {
    expect(eloDelta(winner, loser)).toBe(points);
  });
});
