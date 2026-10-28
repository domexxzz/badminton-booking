import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { GuildEmblem } from "@/components/guilds/GuildEmblem";
import { GuildXpBar } from "@/components/guilds/GuildXpBar";
import { GuildDetailClient } from "@/components/guilds/GuildDetailClient";
import {
  GUILD_MAX_MEMBERS,
  JOIN_POLICY_LABELS,
  type GuildBoardItem,
  type GuildJoinRequestItem,
  type GuildMemberItem,
  type GuildRecentXpItem,
  type GuildUpcomingPartyItem,
  type MyGuildInfo,
} from "@/lib/guilds/rules";

export const dynamic = "force-dynamic";

export default async function GuildDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, user } = await getSessionUser();

  // Load guild board item
  const { data: rawGuild, error: guildError } = await supabase
    .from("guild_board")
    .select("*")
    .eq("guild_id", id)
    .single();

  const guild = (rawGuild as unknown) as GuildBoardItem | null;

  if (guildError || !guild) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <div className="card stack" style={{ padding: 24, textAlign: "center" }}>
          <div style={{ fontSize: 36 }}>🛡️</div>
          <h2>ไม่พบกิลด์นี้</h2>
          <p className="muted">กิลด์นี้อาจถูกปิด ซ่อน หรือไม่มีอยู่ในระบบ</p>
          <Link href="/guilds" className="btn btn-primary" style={{ alignSelf: "center", marginTop: 8 }}>
            กลับหน้ารายการกิลด์
          </Link>
        </div>
      </div>
    );
  }

  // Load members, recent XP, upcoming parties, and user's guild state
  const [membersRes, myGuildRes, recentXpRes, upcomingRes] = await Promise.all([
    supabase
      .from("guild_member_board")
      .select("*")
      .eq("guild_id", id)
      .order("joined_at"),
    user ? supabase.rpc("my_guild") : Promise.resolve({ data: null, error: null }),
    supabase.rpc("guild_recent_xp", { p_guild_id: id, p_limit: 15 }),
    supabase.rpc("guild_upcoming_parties", { p_guild_id: id }),
  ]);

  const members = ((membersRes.data as unknown) as GuildMemberItem[]) || [];
  const myGuild = ((myGuildRes.data as unknown) as MyGuildInfo[] | null)?.[0] || null;
  const recentXp = ((recentXpRes.data as unknown) as GuildRecentXpItem[]) || [];
  const upcomingParties = ((upcomingRes.data as unknown) as GuildUpcomingPartyItem[]) || [];

  // If user is leader or officer of this guild, load join requests
  const canManage =
    myGuild?.guild_id === id && (myGuild.role === "leader" || myGuild.role === "officer");

  const requestsRes = canManage
    ? await supabase.rpc("guild_requests", { p_guild_id: id })
    : { data: null };

  const requests = ((requestsRes.data as unknown) as GuildJoinRequestItem[]) || [];

  const policy = JOIN_POLICY_LABELS[guild.join_policy] || { title: guild.join_policy };

  const formatXpSource = (src: string) => {
    switch (src) {
      case "match":
        return "แข่งขันแมตช์ก๊วน";
      case "win":
        return "ชนะการแข่งขัน";
      case "court_hours":
        return "ชั่วโมงสนามที่เล่น";
      case "rally":
        return "โบนัสคืนก๊วนสังสรรค์ (4+ คน)";
      case "reversal":
        return "ปรับลดแต้มจากการยกเลิก";
      default:
        return src;
    }
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <LiveRefresh table="guild_board" />
      <LiveRefresh table="guild_member_board" />

      {/* Back link */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <Link href="/guilds" className="muted" style={{ textDecoration: "none" }}>
          ← กิลด์ทั้งหมด
        </Link>
      </div>

      {/* Guild Header Banner */}
      <div
        className="card stack"
        style={{
          padding: 20,
          background: `linear-gradient(145deg, color-mix(in srgb, ${guild.color} 18%, var(--surface)), var(--surface))`,
          border: `1.5px solid color-mix(in srgb, ${guild.color} 40%, var(--border))`,
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
          <GuildEmblem
            emblem={guild.emblem}
            color={guild.color}
            size="xl"
            level={guild.level}
          />

          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: 22, wordBreak: "break-word" }}>
                {guild.name}
              </h1>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: guild.color,
                  background: `color-mix(in srgb, ${guild.color} 14%, transparent)`,
                  padding: "2px 8px",
                  borderRadius: 6,
                  letterSpacing: "0.5px",
                }}
              >
                [{guild.tag}]
              </span>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginTop: 6,
                fontSize: 13,
                color: "var(--muted)",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  background: "var(--surface)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  border: "1px solid var(--border)",
                  fontWeight: 600,
                  color: "var(--text)",
                }}
              >
                {policy.title}
              </span>
              <span>•</span>
              <span>
                สมาชิก <strong>{guild.member_count}</strong> / {GUILD_MAX_MEMBERS} คน
              </span>
            </div>
          </div>
        </div>

        {/* Guild Description */}
        {guild.description && (
          <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>
            {guild.description}
          </p>
        )}

        {/* XP Progress Bar */}
        <GuildXpBar
          totalXp={guild.total_xp}
          seasonXp={guild.season_xp}
          showDetails={true}
        />
      </div>

      {/* Upcoming Parties (ก๊วนของกิลด์) */}
      {upcomingParties.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>🏸 ห้องก๊วนที่นัดหมาย</h2>
            <Link href="/queue" className="muted" style={{ fontSize: 12 }}>
              ดูคิวก๊วนทั้งหมด
            </Link>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {upcomingParties.map((p) => (
              <Link
                key={p.party_id}
                href={`/queue/${p.party_id}`}
                className="card"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div>
                  <strong style={{ fontSize: 14 }}>{p.title}</strong>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                    หัวห้อง: {p.host_name} • สนาม {p.court_id} •{" "}
                    {new Date(p.starts_at).toLocaleTimeString("th-TH", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                <span className="btn btn-sm btn-ghost">เข้าดูห้อง ➔</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Detail Client: Members, Requests, Manage, and Join/Leave actions */}
      <GuildDetailClient
        guild={guild}
        members={members}
        myGuild={myGuild}
        requests={requests}
        currentUserId={user?.id}
      />

      {/* Recent XP History */}
      {recentXp.length > 0 && (
        <section className="card stack" style={{ gap: 10, padding: 16 }}>
          <h2 style={{ fontSize: 16, margin: 0 }}>📈 ประวัติ XP ล่าสุด</h2>
          <div className="stack" style={{ gap: 8 }}>
            {recentXp.map((x, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 13,
                  paddingBottom: 6,
                  borderBottom: i < recentXp.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <div>
                  <div>{formatXpSource(x.source)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {x.member_name ? `โดย ${x.member_name}` : "กิลด์รวม"} •{" "}
                    {new Date(x.created_at).toLocaleDateString("th-TH")}
                  </div>
                </div>
                <strong
                  style={{
                    color: x.xp >= 0 ? "var(--primary-strong)" : "var(--danger)",
                    fontSize: 14,
                  }}
                >
                  {x.xp >= 0 ? `+${x.xp}` : x.xp} XP
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
