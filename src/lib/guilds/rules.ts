// Guild rules, levels, styling constants, and types.
// The database decides the real level (guild_level, migration 0036);
// test/guilds.test.ts keeps this copy in step with it through scripts/lib/guild-rules.mjs.

export const GUILD_MAX_MEMBERS = 120;

export const GUILD_EMBLEMS = [
  "shuttle",
  "racket",
  "crown",
  "fire",
  "bolt",
  "star",
  "shield",
  "dragon",
  "tiger",
  "eagle",
  "wave",
  "leaf",
] as const;

export type GuildEmblem = (typeof GUILD_EMBLEMS)[number];

export const GUILD_COLORS = [
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#334155",
] as const;

export type GuildColor = (typeof GUILD_COLORS)[number];

export const EMBLEM_LABELS: Record<GuildEmblem, string> = {
  shuttle: "ลูกขนไก่",
  racket: "ไม้แบด",
  crown: "มงกุฎ",
  fire: "เปลวไฟ",
  bolt: "สายฟ้า",
  star: "ดวงดาว",
  shield: "โล่",
  dragon: "มังกร",
  tiger: "เสือ",
  eagle: "อินทรี",
  wave: "คลื่นน้ำ",
  leaf: "ใบไม้",
};

export type GuildRole = "leader" | "officer" | "member";

export const ROLE_LABELS: Record<GuildRole, string> = {
  leader: "หัวหน้ากิลด์",
  officer: "รองหัวหน้า",
  member: "สมาชิก",
};

export type GuildJoinPolicy = "open" | "approval" | "code";

export const JOIN_POLICY_LABELS: Record<GuildJoinPolicy, { title: string; desc: string }> = {
  open: { title: "เปิดรับทันที", desc: "ใครก็กดเข้าร่วมได้ทันที ไม่ต้องรออนุมัติ" },
  approval: { title: "ต้องรออนุมัติ", desc: "ผู้เล่นส่งคำขอ และรอหัวหน้าหรือรองหัวหน้าอนุมัติ" },
  code: { title: "ต้องมีรหัสเชิญ", desc: "เข้าร่วมได้เฉพาะผู้ที่มีรหัสเชิญของกิลด์เท่านั้น" },
};

export interface GuildBoardItem {
  guild_id: string;
  name: string;
  tag: string;
  emblem: string;
  color: string;
  description: string | null;
  join_policy: GuildJoinPolicy;
  member_count: number;
  level: number;
  total_xp: number;
  season_xp: number;
  skill_rating: number | null;
  created_at: string;
}

export interface GuildMemberItem {
  entry_id: string;
  guild_id: string;
  player_key: string | null;
  name: string | null;
  avatar_url: string | null;
  role: GuildRole;
  joined_at: string;
}

export interface MyGuildInfo {
  guild_id: string | null;
  entry_id: string | null;
  role: GuildRole | null;
  joined_at: string | null;
  join_code: string | null;
  pending_requests: number | null;
  cooldown_until: string | null;
  requested_guild_id: string | null;
}

export interface GuildJoinRequestItem {
  request_id: string;
  name: string;
  avatar_url: string | null;
  rating: number | null;
  created_at: string;
}

export interface GuildRecentXpItem {
  created_at: string;
  source: "match" | "win" | "court_hours" | "rally" | "reversal";
  xp: number;
  member_name: string | null;
}

export interface GuildUpcomingPartyItem {
  party_id: string;
  title: string;
  host_name: string;
  mode: "singles" | "doubles";
  court_id: number;
  starts_at: string;
  ends_at: string;
}

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
