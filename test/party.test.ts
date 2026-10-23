import { describe, expect, it } from "vitest";
import { buildPartyMatches } from "../src/lib/party";

const start = "2026-10-24T10:00:00.000Z";
const end = "2026-10-24T11:00:00.000Z";
const member = (slot: number, name = `P${slot}`) => ({ entry_id: String(slot), name, slot_no: slot });

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
});
