// Guild levels as the pages show them. The database decides the real level
// (guild_level, migration 0033); test/guilds.test.ts keeps this copy in step with it
// through scripts/lib/guild-rules.mjs.

/** Total XP a guild needs to reach `level`: 100 × n × (n − 1). */
export const xpForLevel = (level: number): number => 100 * level * (level - 1);

/** The level for a guild's total XP. Never below 1, even after a reversal. */
export function guildLevel(totalXp: number): number {
  const xp = Math.max(0, totalXp);
  let level = Math.floor((1 + Math.sqrt(1 + xp / 25)) / 2);
  // Floating point can land one off at an exact boundary.
  if (xpForLevel(level + 1) <= xp) level += 1;
  if (xpForLevel(level) > xp) level -= 1;
  return Math.max(1, level);
}

/** How far through its current level a guild is, for the XP bar. */
export function guildLevelProgress(totalXp: number) {
  const xp = Math.max(0, totalXp);
  const level = guildLevel(xp);
  const levelStart = xpForLevel(level);
  const levelSpan = xpForLevel(level + 1) - levelStart;
  const intoLevel = xp - levelStart;
  return { level, intoLevel, levelSpan, toNext: levelSpan - intoLevel, ratio: intoLevel / levelSpan };
}
