// The guild numbers, checked on both sides.
//
// The page shows a guild's level and XP bar (src/lib/guilds/rules.ts), and the database
// decides them (guild_level and the XP awards in migration 0033). Two copies of one rule
// drift, and the one a player sees would be the one that lies. test/guilds.test.ts checks
// the TypeScript against these tables and scripts/test-db.mjs checks the SQL, so neither
// can move alone.

/** XP for each thing that happens at the shop (design: docs/design/2026-10-25-guilds.md). */
export const GUILD_XP = { match: 10, win: 5, courtHour: 20, rally: 50, dailyGameCap: 150, rallyPlayers: 4 };

export const GUILD_MAX_MEMBERS = 120;

/** [total XP, level]: level n needs 100 × n × (n − 1) XP in total. */
export const GUILD_LEVEL_GRID = [
  [0, 1],
  [199, 1],
  [200, 2],
  [599, 2],
  [600, 3],
  [1200, 4],
  [2000, 5],
  [8999, 9],
  [9000, 10],
  [38000, 20],
  [-50, 1],
];

/** Emblems a guild can pick; the pages draw each one. */
export const GUILD_EMBLEMS = ["shuttle", "racket", "crown", "fire", "bolt", "star", "shield", "dragon", "tiger", "eagle", "wave", "leaf"];

/** Emblem colours a guild can pick. */
export const GUILD_COLORS = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04", "#334155"];
