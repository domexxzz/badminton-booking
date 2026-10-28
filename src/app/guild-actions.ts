"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import {
  GUILD_COLORS,
  GUILD_EMBLEMS,
  type GuildColor,
  type GuildEmblem,
  type GuildJoinPolicy,
} from "@/lib/guilds/rules";
import type { ActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAG_RE = /^[A-Z0-9ก-๙]{2,4}$/;

function refreshGuildPaths(guildId?: string) {
  revalidatePath("/guilds");
  revalidatePath("/me");
  revalidatePath("/queue");
  if (guildId) {
    revalidatePath(`/guilds/${guildId}`);
  }
}

export async function createGuildAction(input: {
  name: string;
  tag: string;
  emblem: GuildEmblem;
  color: GuildColor;
  description?: string;
  joinPolicy: GuildJoinPolicy;
}): Promise<ActionResult<{ guildId: string }>> {
  const name = (input.name ?? "").trim();
  const tag = (input.tag ?? "").trim().toUpperCase();
  const description = (input.description ?? "").trim();
  const emblem = input.emblem;
  const color = input.color;
  const joinPolicy = input.joinPolicy;

  if (name.length < 3 || name.length > 24) {
    return { ok: false, error: "ชื่อกิลด์ต้องมีความยาว 3–24 ตัวอักษร" };
  }
  if (!TAG_RE.test(tag)) {
    return { ok: false, error: "แท็กกิลด์ต้องเป็นตัวอักษร 2–4 ตัว (A–Z, 0–9 หรือภาษาไทย)" };
  }
  if (!GUILD_EMBLEMS.includes(emblem)) {
    return { ok: false, error: "กรุณาเลือกตรากิลด์ที่ถูกต้อง" };
  }
  if (!GUILD_COLORS.includes(color)) {
    return { ok: false, error: "กรุณาเลือกสีกิลด์ที่ถูกต้อง" };
  }
  if (!["open", "approval", "code"].includes(joinPolicy)) {
    return { ok: false, error: "กรุณาเลือกรูปแบบการเข้าร่วมกิลด์ที่ถูกต้อง" };
  }
  if (description.length > 200) {
    return { ok: false, error: "คำอธิบายกิลด์ต้องไม่เกิน 200 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_guild", {
    p_name: name,
    p_tag: tag,
    p_emblem: emblem,
    p_color: color,
    p_description: description || null,
    p_join_policy: joinPolicy,
  });

  if (error || !data) {
    return { ok: false, error: friendlyError(error) };
  }

  const guildId = String(data);
  refreshGuildPaths(guildId);
  return { ok: true, data: { guildId } };
}

export async function updateGuildAction(input: {
  guildId: string;
  emblem: GuildEmblem;
  color: GuildColor;
  description?: string;
  joinPolicy: GuildJoinPolicy;
}): Promise<ActionResult> {
  if (!UUID_RE.test(input.guildId)) {
    return { ok: false, error: "ข้อมูลกิลด์ไม่ถูกต้อง" };
  }
  if (!GUILD_EMBLEMS.includes(input.emblem)) {
    return { ok: false, error: "กรุณาเลือกตรากิลด์ที่ถูกต้อง" };
  }
  if (!GUILD_COLORS.includes(input.color)) {
    return { ok: false, error: "กรุณาเลือกสีกิลด์ที่ถูกต้อง" };
  }
  if (!["open", "approval", "code"].includes(input.joinPolicy)) {
    return { ok: false, error: "รูปแบบการเข้าร่วมไม่ถูกต้อง" };
  }
  const description = (input.description ?? "").trim();
  if (description.length > 200) {
    return { ok: false, error: "คำอธิบายกิลด์ต้องไม่เกิน 200 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_guild", {
    p_guild_id: input.guildId,
    p_emblem: input.emblem,
    p_color: input.color,
    p_description: description || null,
    p_join_policy: input.joinPolicy,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(input.guildId);
  return { ok: true, data: null };
}

export async function resetGuildJoinCodeAction(guildId: string): Promise<ActionResult<{ joinCode: string }>> {
  if (!UUID_RE.test(guildId)) {
    return { ok: false, error: "ข้อมูลกิลด์ไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reset_guild_join_code", {
    p_guild_id: guildId,
  });

  if (error || !data) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: { joinCode: String(data) } };
}

export async function joinGuildAction(guildId: string, code?: string): Promise<ActionResult> {
  if (!UUID_RE.test(guildId)) {
    return { ok: false, error: "ข้อมูลกิลด์ไม่ถูกต้อง" };
  }

  const cleanCode = code ? code.trim().toUpperCase() : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("join_guild", {
    p_guild_id: guildId,
    p_code: cleanCode,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function joinGuildByCodeAction(code: string): Promise<ActionResult<{ guildId: string }>> {
  const cleanCode = (code ?? "").trim().toUpperCase();
  if (!cleanCode) {
    return { ok: false, error: "กรุณาระบุรหัสเชิญเข้ากิลด์" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("join_guild_by_code", {
    p_code: cleanCode,
  });

  if (error || !data) {
    return { ok: false, error: friendlyError(error) };
  }

  const guildId = String(data);
  refreshGuildPaths(guildId);
  return { ok: true, data: { guildId } };
}

export async function requestJoinGuildAction(guildId: string): Promise<ActionResult<{ requestId: string }>> {
  if (!UUID_RE.test(guildId)) {
    return { ok: false, error: "ข้อมูลกิลด์ไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_join_guild", {
    p_guild_id: guildId,
  });

  if (error || !data) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: { requestId: String(data) } };
}

export async function withdrawGuildRequestAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_guild_request");

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths();
  return { ok: true, data: null };
}

export async function decideGuildRequestAction(
  guildId: string,
  requestId: string,
  approve: boolean,
): Promise<ActionResult> {
  if (!UUID_RE.test(guildId) || !UUID_RE.test(requestId)) {
    return { ok: false, error: "ข้อมูลคำขอไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_guild_request", {
    p_request_id: requestId,
    p_approve: approve,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function leaveGuildAction(guildId?: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("leave_guild");

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function kickGuildMemberAction(guildId: string, entryId: string): Promise<ActionResult> {
  if (!UUID_RE.test(guildId) || !UUID_RE.test(entryId)) {
    return { ok: false, error: "ข้อมูลสมาชิกไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("kick_guild_member", {
    p_entry_id: entryId,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function setGuildOfficerAction(
  guildId: string,
  entryId: string,
  isOfficer: boolean,
): Promise<ActionResult> {
  if (!UUID_RE.test(guildId) || !UUID_RE.test(entryId)) {
    return { ok: false, error: "ข้อมูลสมาชิกไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_guild_officer", {
    p_entry_id: entryId,
    p_is_officer: isOfficer,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function transferGuildLeaderAction(guildId: string, entryId: string): Promise<ActionResult> {
  if (!UUID_RE.test(guildId) || !UUID_RE.test(entryId)) {
    return { ok: false, error: "ข้อมูลสมาชิกไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("transfer_guild_leader", {
    p_entry_id: entryId,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function disbandGuildAction(guildId: string): Promise<ActionResult> {
  if (!UUID_RE.test(guildId)) {
    return { ok: false, error: "ข้อมูลกิลด์ไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("disband_guild", {
    p_guild_id: guildId,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  refreshGuildPaths(guildId);
  return { ok: true, data: null };
}

export async function reportGuildAction(guildId: string, reason: string): Promise<ActionResult> {
  if (!UUID_RE.test(guildId)) {
    return { ok: false, error: "ข้อมูลกิลด์ไม่ถูกต้อง" };
  }
  const cleanReason = (reason ?? "").trim();
  if (cleanReason.length < 1 || cleanReason.length > 300) {
    return { ok: false, error: "กรุณาระบุเหตุผลการรายงานความยาวไม่เกิน 300 ตัวอักษร" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("report_guild", {
    p_guild_id: guildId,
    p_reason: cleanReason,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  return { ok: true, data: null };
}

export async function tagPartyWithGuildAction(partyId: string, on: boolean): Promise<ActionResult> {
  if (!UUID_RE.test(partyId)) {
    return { ok: false, error: "ข้อมูลห้องไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("tag_party_with_guild", {
    p_party_id: partyId,
    p_on: on,
  });

  if (error) {
    return { ok: false, error: friendlyError(error) };
  }

  revalidatePath("/queue");
  revalidatePath(`/queue/${partyId}`);
  return { ok: true, data: null };
}
