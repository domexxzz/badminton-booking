import React from "react";
import Link from "next/link";
import { getSessionUser } from "@/lib/supabase/server";
import { LiveRefresh } from "@/components/LiveRefresh";
import { GuildListTabs } from "@/components/guilds/GuildListTabs";
import { GuildEmblem } from "@/components/guilds/GuildEmblem";
import { GUILD_MAX_MEMBERS, type GuildBoardItem, type MyGuildInfo } from "@/lib/guilds/rules";

export const dynamic = "force-dynamic";

export default async function GuildsPage() {
  const { supabase, user } = await getSessionUser();

  // Load public guild list and user's guild state in parallel
  const [guildsRes, myGuildRes] = await Promise.all([
    supabase
      .from("guild_board")
      .select("*")
      .order("season_xp", { ascending: false }),
    user ? supabase.rpc("my_guild") : Promise.resolve({ data: null, error: null }),
  ]);

  const guilds = ((guildsRes.data as unknown) as GuildBoardItem[]) || [];
  const myGuild = ((myGuildRes.data as unknown) as MyGuildInfo[] | null)?.[0] || null;

  // Find user's guild from board if enrolled
  const currentGuild = myGuild?.guild_id
    ? guilds.find((g) => g.guild_id === myGuild.guild_id) || null
    : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <LiveRefresh table="guild_board" />
      <LiveRefresh table="guild_member_board" />

      {/* Header */}
      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>กิลด์ก๊วนแบด</h1>
          <p className="muted">
            รวมกลุ่มเพื่อนก๊วนประจำ ตีแบดสะสมเลเวล ชิงอันดับซีซั่น (สูงสุด {GUILD_MAX_MEMBERS} คนต่อกิลด์)
          </p>
        </div>
      </div>

      {/* My Guild Shortcut Banner */}
      {currentGuild && (
        <Link
          href={`/guilds/${currentGuild.guild_id}`}
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: 14,
            textDecoration: "none",
            color: "inherit",
            background: `linear-gradient(135deg, color-mix(in srgb, ${currentGuild.color} 15%, var(--surface)), var(--surface))`,
            border: `1.5px solid color-mix(in srgb, ${currentGuild.color} 50%, var(--border))`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <GuildEmblem
              emblem={currentGuild.emblem}
              color={currentGuild.color}
              size="md"
              level={currentGuild.level}
            />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <strong style={{ fontSize: 16 }}>{currentGuild.name}</strong>
                <span style={{ fontSize: 11, fontWeight: 700, color: currentGuild.color }}>
                  [{currentGuild.tag}]
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                เลเวล {currentGuild.level} • สมาชิก {currentGuild.member_count} / {GUILD_MAX_MEMBERS} คน
              </div>
            </div>
          </div>
          <span className="btn btn-sm btn-ghost" style={{ flexShrink: 0 }}>
            ดูกิลด์ของฉัน ➔
          </span>
        </Link>
      )}

      {/* Pending Join Request Banner */}
      {!currentGuild && myGuild?.requested_guild_id && (
        <div
          className="card"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "var(--held)",
            border: "1px solid color-mix(in srgb, var(--held-ink) 25%, var(--border))",
            color: "var(--held-ink)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>⏳ คุณมีคำขอเข้าร่วมกิลด์ที่กำลังรอการอนุมัติ</span>
          <Link
            href={`/guilds/${myGuild.requested_guild_id}`}
            style={{ color: "var(--held-ink)", textDecoration: "underline", fontSize: 12 }}
          >
            ดูคำขอ
          </Link>
        </div>
      )}

      {/* Cooldown Notice */}
      {!currentGuild && myGuild?.cooldown_until && new Date(myGuild.cooldown_until) > new Date() && (
        <div
          className="card"
          style={{
            padding: "10px 14px",
            background: "var(--surface-2)",
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          ⏳ อยู่ในช่วงคูลดาวน์หลังออกจากกิลด์เดิม สามารถเข้ากิลด์ใหม่ได้ในวันที่{" "}
          <strong>{new Date(myGuild.cooldown_until).toLocaleDateString("th-TH")}</strong>
        </div>
      )}

      {/* Tabs and Guild Cards List */}
      <GuildListTabs
        guilds={guilds}
        myGuild={myGuild}
        currentUserId={user?.id}
      />
    </div>
  );
}
