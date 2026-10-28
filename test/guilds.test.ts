import { describe, expect, test } from "vitest";
import {
  GUILD_LEVEL_GRID,
  GUILD_MAX_MEMBERS as MJS_MAX_MEMBERS,
  GUILD_EMBLEMS as MJS_EMBLEMS,
  GUILD_COLORS as MJS_COLORS,
} from "../scripts/lib/guild-rules.mjs";
import {
  guildLevel,
  guildLevelProgress,
  xpForLevel,
  GUILD_MAX_MEMBERS,
  GUILD_EMBLEMS,
  GUILD_COLORS,
  EMBLEM_LABELS,
  ROLE_LABELS,
  JOIN_POLICY_LABELS,
} from "../src/lib/guilds/rules";

describe("guild constants", () => {
  test("max members is 120 and matches scripts/lib/guild-rules.mjs", () => {
    expect(GUILD_MAX_MEMBERS).toBe(120);
    expect(MJS_MAX_MEMBERS).toBe(120);
  });

  test("emblems and colors match mjs export", () => {
    expect(GUILD_EMBLEMS).toEqual(MJS_EMBLEMS);
    expect(GUILD_COLORS).toEqual(MJS_COLORS);
    expect(Object.keys(EMBLEM_LABELS)).toEqual(MJS_EMBLEMS);
  });

  test("roles and policies have Thai labels", () => {
    expect(ROLE_LABELS.leader).toBe("หัวหน้ากิลด์");
    expect(ROLE_LABELS.officer).toBe("รองหัวหน้า");
    expect(ROLE_LABELS.member).toBe("สมาชิก");
    expect(Object.keys(JOIN_POLICY_LABELS)).toEqual(["open", "approval", "code"]);
  });
});

describe("guildLevel", () => {
  test.each(GUILD_LEVEL_GRID)("%i XP is level %i, the same as the database", (xp, level) => {
    expect(guildLevel(xp)).toBe(level);
  });
});

describe("xpForLevel", () => {
  test("level n needs 100 × n × (n − 1) XP", () => {
    expect([1, 2, 3, 5, 10].map(xpForLevel)).toEqual([0, 200, 600, 2000, 9000]);
  });
});

describe("guildLevelProgress", () => {
  test("shows how far a guild is through its current level", () => {
    expect(guildLevelProgress(400)).toEqual({ level: 2, intoLevel: 200, levelSpan: 400, toNext: 200, ratio: 0.5 });
  });

  test("starts a new level at zero", () => {
    expect(guildLevelProgress(600)).toMatchObject({ level: 3, intoLevel: 0, ratio: 0 });
  });

  test("treats negative XP (after a reversal) as an empty level 1", () => {
    expect(guildLevelProgress(-30)).toMatchObject({ level: 1, intoLevel: 0, toNext: 200, ratio: 0 });
  });
});
