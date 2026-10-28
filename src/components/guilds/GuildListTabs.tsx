"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { GuildCard } from "./GuildCard";
import { GuildJoinCodeForm } from "./GuildJoinCodeForm";
import type { GuildBoardItem, MyGuildInfo } from "@/lib/guilds/rules";

interface GuildListTabsProps {
  guilds: GuildBoardItem[];
  myGuild: MyGuildInfo | null;
  currentUserId?: string | null;
}

export function GuildListTabs({ guilds, myGuild, currentUserId }: GuildListTabsProps) {
  const [tab, setTab] = useState<"leaderboard" | "all">("leaderboard");
  const [search, setSearch] = useState("");
  const [showCodeInput, setShowCodeInput] = useState(false);

  // Leaderboard sorted by season_xp desc
  const leaderboardGuilds = useMemo(() => {
    return [...guilds].sort((a, b) => b.season_xp - a.season_xp || b.total_xp - a.total_xp);
  }, [guilds]);

  // Filtered guilds based on search query
  const filteredGuilds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const source = tab === "leaderboard" ? leaderboardGuilds : guilds;
    if (!q) return source;
    return source.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.tag.toLowerCase().includes(q) ||
        (g.description && g.description.toLowerCase().includes(q)),
    );
  }, [guilds, leaderboardGuilds, tab, search]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* Action buttons row */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            className={`btn btn-sm ${!showCodeInput ? "btn-ghost" : "btn-primary"}`}
            onClick={() => setShowCodeInput(!showCodeInput)}
          >
            🔑 มีรหัสเชิญ
          </button>
        </div>

        <Link
          href="/guilds/new"
          className="btn btn-sm btn-primary"
          style={{ textDecoration: "none" }}
        >
          ＋ สร้างกิลด์ใหม่
        </Link>
      </div>

      {showCodeInput && (
        <div className="card" style={{ padding: 14, background: "var(--surface-2)" }}>
          <GuildJoinCodeForm onClose={() => setShowCodeInput(false)} />
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid var(--border)",
          gap: 16,
        }}
      >
        <button
          type="button"
          onClick={() => setTab("leaderboard")}
          style={{
            background: "none",
            border: "none",
            borderBottom: tab === "leaderboard" ? "2px solid var(--primary)" : "2px solid transparent",
            color: tab === "leaderboard" ? "var(--primary-strong)" : "var(--muted)",
            fontWeight: 700,
            fontSize: 15,
            padding: "8px 4px",
            cursor: "pointer",
          }}
        >
          🏆 อันดับซีซั่น (Leaderboard)
        </button>
        <button
          type="button"
          onClick={() => setTab("all")}
          style={{
            background: "none",
            border: "none",
            borderBottom: tab === "all" ? "2px solid var(--primary)" : "2px solid transparent",
            color: tab === "all" ? "var(--primary-strong)" : "var(--muted)",
            fontWeight: 700,
            fontSize: 15,
            padding: "8px 4px",
            cursor: "pointer",
          }}
        >
          🛡️ กิลด์ทั้งหมด ({guilds.length})
        </button>
      </div>

      {/* Search Bar */}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          className="input"
          placeholder="ค้นหาชื่อกิลด์ หรือแท็ก [TAG]..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
        <span
          style={{
            position: "absolute",
            left: 12,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--muted)",
            fontSize: 14,
          }}
        >
          🔍
        </span>
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              background: "none",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Guild Cards List */}
      <div className="stack" style={{ gap: 10 }}>
        {filteredGuilds.length === 0 ? (
          <div className="card" style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🏸</div>
            <strong style={{ fontSize: 16, color: "var(--text)", display: "block" }}>
              {search ? "ไม่พบกิลด์ที่ตรงกับคำค้นหา" : "ยังไม่มีกิลด์ในระบบ"}
            </strong>
            <p className="muted" style={{ margin: "4px 0 16px", fontSize: 13 }}>
              {search ? "ลองเปลี่ยนคำค้นหา หรือค้นหาด้วยแท็กย่อ" : "เริ่มสร้างกิลด์ของคุณเป็นกิลด์แรกได้เลย!"}
            </p>
            {!search && (
              <Link href="/guilds/new" className="btn btn-primary btn-sm">
                ＋ สร้างกิลด์ตอนนี้
              </Link>
            )}
          </div>
        ) : (
          filteredGuilds.map((g, index) => (
            <GuildCard
              key={g.guild_id}
              guild={g}
              rank={tab === "leaderboard" ? index + 1 : undefined}
              isMyGuild={myGuild?.guild_id === g.guild_id}
            />
          ))
        )}
      </div>
    </div>
  );
}
