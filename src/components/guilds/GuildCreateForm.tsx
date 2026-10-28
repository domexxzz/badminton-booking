"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { GuildEmblem } from "./GuildEmblem";
import {
  GUILD_COLORS,
  GUILD_EMBLEMS,
  EMBLEM_LABELS,
  JOIN_POLICY_LABELS,
  GUILD_MAX_MEMBERS,
  type GuildColor,
  type GuildEmblem as EmblemType,
  type GuildJoinPolicy,
} from "@/lib/guilds/rules";
import { createGuildAction } from "@/app/guild-actions";

export function GuildCreateForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [emblem, setEmblem] = useState<EmblemType>("shuttle");
  const [color, setColor] = useState<GuildColor>("#0f766e");
  const [joinPolicy, setJoinPolicy] = useState<GuildJoinPolicy>("approval");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanTag = tag.trim().toUpperCase();

    if (cleanName.length < 3 || cleanName.length > 24) {
      setError("ชื่อกิลด์ต้องมีความยาว 3–24 ตัวอักษร");
      return;
    }
    if (!/^[A-Z0-9ก-๙]{2,4}$/.test(cleanTag)) {
      setError("แท็กกิลด์ต้องมี 2–4 ตัวอักษร (A–Z, 0–9 หรือภาษาไทย)");
      return;
    }

    setLoading(true);
    try {
      const res = await createGuildAction({
        name: cleanName,
        tag: cleanTag,
        emblem,
        color,
        description: description.trim(),
        joinPolicy,
      });

      if (!res.ok) {
        setError(res.error);
        setLoading(false);
        return;
      }

      router.push(`/guilds/${res.data.guildId}`);
    } catch {
      setError("เกิดข้อผิดพลาดในการสร้างกิลด์ กรุณาลองใหม่อีกครั้ง");
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="stack" style={{ gap: 20 }}>
      {/* Live Preview Card */}
      <div
        className="card"
        style={{
          padding: 16,
          background: `linear-gradient(135deg, color-mix(in srgb, ${color} 18%, var(--surface)), var(--surface))`,
          border: `1px solid color-mix(in srgb, ${color} 40%, var(--border))`,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
          ตัวอย่างการแสดงผลกิลด์ (Live Preview)
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <GuildEmblem emblem={emblem} color={color} size="lg" level={1} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 18, color: "var(--text)" }}>
                {name.trim() || "ชื่อกิลด์ของคุณ"}
              </strong>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: color,
                  background: `color-mix(in srgb, ${color} 14%, transparent)`,
                  padding: "1px 6px",
                  borderRadius: 4,
                }}
              >
                [{tag.trim().toUpperCase() || "TAG"}]
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 4, fontSize: 12, color: "var(--muted)" }}>
              <span>เลเวล 1</span>
              <span>•</span>
              <span>สมาชิก 1 / {GUILD_MAX_MEMBERS} คน</span>
            </div>
          </div>
        </div>

        {description.trim() && (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.45 }}>
            {description.trim()}
          </p>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--border)", fontSize: 12 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", background: "var(--surface-2)", padding: "2px 8px", borderRadius: 6 }}>
            {JOIN_POLICY_LABELS[joinPolicy].title}
          </span>
          <span style={{ fontWeight: 600, color: "var(--primary-strong)" }}>
            0 XP
          </span>
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "var(--danger-soft)",
            color: "var(--danger)",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {error}
        </div>
      )}

      {/* Inputs */}
      <div className="card stack" style={{ gap: 16, padding: 18 }}>
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="guild-name" style={{ fontSize: 14, fontWeight: 700 }}>
            ชื่อกิลด์ <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            id="guild-name"
            type="text"
            className="input"
            placeholder="เช่น สิงห์สนามสินธานี (3–24 ตัวอักษร)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={24}
            required
          />
          <small className="muted">ความยาว 3–24 ตัวอักษร (ไม่สามารถแก้ไขภายหลังได้)</small>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="guild-tag" style={{ fontSize: 14, fontWeight: 700 }}>
            แท็กกิลด์ (TAG) <span style={{ color: "var(--danger)" }}>*</span>
          </label>
          <input
            id="guild-tag"
            type="text"
            className="input"
            placeholder="เช่น SHIN, BKK (2–4 ตัวอักษร)"
            value={tag}
            onChange={(e) => setTag(e.target.value.toUpperCase())}
            maxLength={4}
            required
            style={{ textTransform: "uppercase", letterSpacing: "1px", fontWeight: 700 }}
          />
          <small className="muted">ตัวอักษร 2–4 ตัว ใช้ภาษาอังกฤษ ตัวเลข หรือภาษาไทย</small>
        </div>

        {/* Emblem Picker */}
        <div className="stack" style={{ gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            เลือกตราสัญลักษณ์กิลด์
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
            }}
          >
            {GUILD_EMBLEMS.map((item) => {
              const isSelected = emblem === item;
              return (
                <button
                  type="button"
                  key={item}
                  onClick={() => setEmblem(item)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    padding: "10px 4px",
                    borderRadius: 12,
                    border: isSelected ? `2px solid ${color}` : "1px solid var(--border)",
                    background: isSelected ? `color-mix(in srgb, ${color} 10%, var(--surface))` : "var(--surface)",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <GuildEmblem emblem={item} color={color} size="sm" />
                  <span style={{ fontSize: 11, fontWeight: isSelected ? 700 : 500, color: "var(--text)" }}>
                    {EMBLEM_LABELS[item]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Color Picker */}
        <div className="stack" style={{ gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            เลือกสีกิลด์
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {GUILD_COLORS.map((c) => {
              const isSelected = color === c;
              return (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: c,
                    border: isSelected ? "3px solid #ffffff" : "2px solid transparent",
                    boxShadow: isSelected ? `0 0 0 2px ${c}, 0 2px 6px rgba(0,0,0,0.25)` : "none",
                    cursor: "pointer",
                    transition: "transform 0.15s ease",
                    transform: isSelected ? "scale(1.15)" : "scale(1)",
                  }}
                  aria-label={c}
                />
              );
            })}
          </div>
        </div>

        {/* Join Policy */}
        <div className="stack" style={{ gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 700 }}>
            รูปแบบการเข้าร่วมกิลด์
          </label>
          <div className="stack" style={{ gap: 8 }}>
            {(["open", "approval", "code"] as GuildJoinPolicy[]).map((pol) => {
              const item = JOIN_POLICY_LABELS[pol];
              const isSelected = joinPolicy === pol;
              return (
                <label
                  key={pol}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: 12,
                    borderRadius: 12,
                    border: isSelected ? "2px solid var(--primary)" : "1px solid var(--border)",
                    background: isSelected ? "var(--primary-soft)" : "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="joinPolicy"
                    value={pol}
                    checked={isSelected}
                    onChange={() => setJoinPolicy(pol)}
                    style={{ marginTop: 3 }}
                  />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{item.desc}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Description */}
        <div className="stack" style={{ gap: 6 }}>
          <label htmlFor="guild-desc" style={{ fontSize: 14, fontWeight: 700 }}>
            คำแนะนำ / แนะนำกิลด์ (ไม่บังคับ)
          </label>
          <textarea
            id="guild-desc"
            className="input"
            rows={3}
            placeholder="เล่าเกี่ยวกับก๊วน วันที่ชอบมาเล่น หรือยินดีต้อนรับผู้เล่นระดับไหน (สูงสุด 200 ตัวอักษร)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            style={{ resize: "vertical" }}
          />
          <small className="muted">{description.length}/200 ตัวอักษร</small>
        </div>
      </div>

      {/* Notice Card */}
      <div
        className="card"
        style={{
          padding: 14,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          fontSize: 13,
          lineHeight: 1.5,
          color: "var(--muted)",
        }}
      >
        <strong style={{ color: "var(--text)", display: "block", marginBottom: 4 }}>
          ℹ️ กติกากิลด์ก๊วนแบดมินตัน
        </strong>
        • หนึ่งกิลด์สามารถจุสมาชิกได้สูงสุด <strong>{GUILD_MAX_MEMBERS} คน</strong>
        <br />
        • ผู้เล่นสามารถสังกัดได้คนละ 1 กิลด์ในเวลาเดียวกัน
        <br />
        • แต้ม XP ได้มาจากการมาตีแบดจริงที่สนาม (เกมแข่งขัน, คอร์ดจองที่ชำระเงิน, และคืนก๊วนสังสรรค์)
        <br />
        • สร้างกิลด์ได้ 1 ครั้งต่อ 7 วัน
      </div>

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={loading}
        style={{ minHeight: 48, fontSize: 16, fontWeight: 700 }}
      >
        {loading ? "กำลังสร้างกิลด์..." : "ยืนยันสร้างกิลด์ 🛡️"}
      </button>
    </form>
  );
}
