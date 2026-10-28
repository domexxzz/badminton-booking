import React from "react";
import { guildLevelProgress } from "@/lib/guilds/rules";

interface GuildXpBarProps {
  totalXp: number;
  seasonXp?: number;
  showDetails?: boolean;
}

export function GuildXpBar({ totalXp, seasonXp, showDetails = true }: GuildXpBarProps) {
  const { level, intoLevel, levelSpan, toNext, ratio } = guildLevelProgress(totalXp);
  const percentage = Math.min(100, Math.max(0, Math.round(ratio * 100)));

  return (
    <div className="guild-xp-card" style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: "linear-gradient(135deg, #f59e0b, #d97706)",
              color: "#ffffff",
              padding: "2px 8px",
              borderRadius: 6,
              fontWeight: 800,
              fontSize: 13,
              letterSpacing: "0.5px",
            }}
          >
            LV.{level}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            ความก้าวหน้าเลเวล
          </span>
        </div>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 500 }}>
          {intoLevel.toLocaleString()} / {levelSpan.toLocaleString()} XP ({percentage}%)
        </span>
      </div>

      <div
        style={{
          width: "100%",
          height: 10,
          background: "var(--surface-2)",
          borderRadius: 999,
          overflow: "hidden",
          border: "1px solid var(--border)",
          position: "relative",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${percentage}%`,
            background: "linear-gradient(90deg, var(--primary) 0%, #38bdf8 100%)",
            borderRadius: 999,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      {showDetails && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
          <span>เหลืออีก {toNext.toLocaleString()} XP ถึงเลเวล {level + 1}</span>
          {seasonXp !== undefined && (
            <span>XP ซีซั่นนี้: <strong style={{ color: "var(--primary-strong)" }}>{seasonXp.toLocaleString()} XP</strong></span>
          )}
        </div>
      )}
    </div>
  );
}
