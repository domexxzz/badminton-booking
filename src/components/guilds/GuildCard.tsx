import React from "react";
import Link from "next/link";
import { GuildEmblem } from "./GuildEmblem";
import { GUILD_MAX_MEMBERS, JOIN_POLICY_LABELS, type GuildBoardItem } from "@/lib/guilds/rules";

interface GuildCardProps {
  guild: GuildBoardItem;
  rank?: number;
  isMyGuild?: boolean;
}

export function GuildCard({ guild, rank, isMyGuild }: GuildCardProps) {
  const policy = JOIN_POLICY_LABELS[guild.join_policy] || { title: guild.join_policy };

  const getRankBadge = (r: number) => {
    if (r === 1) return { bg: "linear-gradient(135deg, #fbbf24, #d97706)", icon: "🥇", text: "#78350f", fontSize: 16 };
    if (r === 2) return { bg: "linear-gradient(135deg, #e2e8f0, #94a3b8)", icon: "🥈", text: "#334155", fontSize: 16 };
    if (r === 3) return { bg: "linear-gradient(135deg, #fdba74, #ea580c)", icon: "🥉", text: "#7c2d12", fontSize: 16 };
    return { bg: "var(--surface-2)", icon: `#${r}`, text: "var(--muted)", fontSize: 12 };
  };

  const rankBadge = rank ? getRankBadge(rank) : null;

  return (
    <Link
      href={`/guilds/${guild.guild_id}`}
      className="guild-card card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        textDecoration: "none",
        color: "inherit",
        position: "relative",
        border: isMyGuild ? "2px solid var(--primary)" : "1px solid var(--border)",
        background: isMyGuild
          ? "linear-gradient(155deg, var(--surface), color-mix(in srgb, var(--primary-soft) 40%, var(--surface)))"
          : "var(--surface)",
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
    >
      {isMyGuild && (
        <span
          style={{
            position: "absolute",
            top: 10,
            right: 12,
            fontSize: 10,
            fontWeight: 700,
            color: "var(--primary-strong)",
            background: "var(--primary-soft)",
            padding: "2px 8px",
            borderRadius: 999,
          }}
        >
          กิลด์ของคุณ
        </span>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {rankBadge && (
          <div
            style={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "50%",
              background: rankBadge.bg,
              color: rankBadge.text,
              fontSize: rankBadge.fontSize,
              fontWeight: 800,
              flexShrink: 0,
            }}
          >
            {rankBadge.icon}
          </div>
        )}

        <GuildEmblem
          emblem={guild.emblem}
          color={guild.color}
          size="md"
          level={guild.level}
        />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 16, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {guild.name}
            </strong>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: guild.color,
                background: `color-mix(in srgb, ${guild.color} 14%, transparent)`,
                padding: "1px 6px",
                borderRadius: 4,
                letterSpacing: "0.5px",
              }}
            >
              [{guild.tag}]
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
            <span>เลเวล {guild.level}</span>
            <span>•</span>
            <span>
              สมาชิก {guild.member_count} / {GUILD_MAX_MEMBERS} คน
            </span>
          </div>
        </div>
      </div>

      {guild.description && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--muted)",
            lineHeight: 1.45,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {guild.description}
        </p>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: 8,
          borderTop: "1px solid var(--border)",
          fontSize: 12,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: "var(--muted)",
            background: "var(--surface-2)",
            padding: "2px 8px",
            borderRadius: 6,
          }}
        >
          {policy.title}
        </span>

        <span style={{ fontWeight: 600, color: "var(--text)" }}>
          ซีซั่นนี้: <strong style={{ color: "var(--primary-strong)" }}>{guild.season_xp.toLocaleString()} XP</strong>
        </span>
      </div>
    </Link>
  );
}
