"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { joinGuildByCodeAction } from "@/app/guild-actions";

export function GuildJoinCodeForm({ onClose }: { onClose?: () => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) return;

    setLoading(true);
    setError(null);

    const res = await joinGuildByCodeAction(cleanCode);
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }

    if (onClose) onClose();
    router.push(`/guilds/${res.data.guildId}`);
  };

  return (
    <form onSubmit={handleSubmit} className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 6 }}>
        <label htmlFor="join-code" style={{ fontSize: 13, fontWeight: 700 }}>
          รหัสเชิญเข้าร่วมกิลด์ (Invite Code)
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="join-code"
            type="text"
            className="input"
            placeholder="เช่น AB12CD"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            style={{ textTransform: "uppercase", letterSpacing: "2px", fontWeight: 700 }}
            required
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !code.trim()}
            style={{ flexShrink: 0 }}
          >
            {loading ? "กำลังเข้า..." : "เข้าร่วม"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}
    </form>
  );
}
