"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { GuildEmblem } from "./GuildEmblem";
import {
  GUILD_COLORS,
  GUILD_EMBLEMS,
  EMBLEM_LABELS,
  JOIN_POLICY_LABELS,
  ROLE_LABELS,
  GUILD_MAX_MEMBERS,
  type GuildBoardItem,
  type GuildColor,
  type GuildEmblem as EmblemType,
  type GuildJoinPolicy,
  type GuildJoinRequestItem,
  type GuildMemberItem,
  type MyGuildInfo,
} from "@/lib/guilds/rules";
import {
  decideGuildRequestAction,
  disbandGuildAction,
  joinGuildAction,
  kickGuildMemberAction,
  leaveGuildAction,
  reportGuildAction,
  requestJoinGuildAction,
  resetGuildJoinCodeAction,
  setGuildOfficerAction,
  transferGuildLeaderAction,
  updateGuildAction,
  withdrawGuildRequestAction,
} from "@/app/guild-actions";

interface GuildDetailClientProps {
  guild: GuildBoardItem;
  members: GuildMemberItem[];
  myGuild: MyGuildInfo | null;
  requests: GuildJoinRequestItem[];
  currentUserId?: string | null;
}

export function GuildDetailClient({
  guild,
  members,
  myGuild,
  requests,
  currentUserId,
}: GuildDetailClientProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"members" | "manage" | "settings">("members");
  const [codeModal, setCodeModal] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [reportModal, setReportModal] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Settings edit state
  const [editEmblem, setEditEmblem] = useState<EmblemType>(guild.emblem as EmblemType);
  const [editColor, setEditColor] = useState<GuildColor>(guild.color as GuildColor);
  const [editDesc, setEditDesc] = useState(guild.description || "");
  const [editPolicy, setEditPolicy] = useState<GuildJoinPolicy>(guild.join_policy);

  // Membership status
  const isMemberOfThisGuild = myGuild?.guild_id === guild.guild_id;
  const myRole = isMemberOfThisGuild ? myGuild?.role : null;
  const isLeader = myRole === "leader";
  const isOfficer = myRole === "officer";
  const canManage = isLeader || isOfficer;
  const hasPendingRequestHere = myGuild?.requested_guild_id === guild.guild_id;
  const isInOtherGuild = Boolean(myGuild?.guild_id && myGuild.guild_id !== guild.guild_id);

  // Join handler
  const handleJoinOpen = async () => {
    setActionLoading(true);
    setActionError(null);
    const res = await joinGuildAction(guild.guild_id);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess("เข้าร่วมกิลด์สำเร็จ!");
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleJoinWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionError(null);
    const res = await joinGuildAction(guild.guild_id, inviteCode);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess("เข้าร่วมกิลด์สำเร็จ!");
      setCodeModal(false);
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleRequestJoin = async () => {
    setActionLoading(true);
    setActionError(null);
    const res = await requestJoinGuildAction(guild.guild_id);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess("ส่งคำขอเข้าร่วมกิลด์เรียบร้อยแล้ว รอการอนุมัติ");
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleWithdrawRequest = async () => {
    if (!confirm("ต้องการยกเลิกคำขอเข้าร่วมกิลด์นี้ใช่หรือไม่?")) return;
    setActionLoading(true);
    setActionError(null);
    const res = await withdrawGuildRequestAction();
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess("ยกเลิกคำขอเรียบร้อยแล้ว");
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleLeave = async () => {
    const promptMsg = isLeader && members.length > 1
      ? "คุณเป็นหัวหน้ากิลด์ ต้องโอนตำแหน่งให้สมาชิกคนอื่นก่อนออกจากกิลด์"
      : isLeader
      ? "คุณเป็นสมาชิกคนเดียว การออกจากกิลด์จะเป็นการปิด (ยุบ) กิลด์นี้โดยสมบูรณ์ ต้องการดำเนินการต่อหรือไม่?"
      : "ต้องการออกจากกิลด์นี้ใช่หรือไม่? (หลังจากออกจะต้องรอคูลดาวน์ 3 วันก่อนเข้ากิลด์ใหม่)";

    if (isLeader && members.length > 1) {
      alert(promptMsg);
      setActiveTab("manage");
      return;
    }

    if (!confirm(promptMsg)) return;

    setActionLoading(true);
    setActionError(null);
    const res = await leaveGuildAction(guild.guild_id);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      router.push("/guilds");
    }
    setActionLoading(false);
  };

  const handleDecideRequest = async (requestId: string, approve: boolean) => {
    setActionLoading(true);
    setActionError(null);
    const res = await decideGuildRequestAction(guild.guild_id, requestId, approve);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleResetJoinCode = async () => {
    if (!confirm("ต้องการสร้างรหัสเชิญใหม่ใช่หรือไม่? รหัสเดิมจะไม่สามารถใช้งานได้อีก")) return;
    setActionLoading(true);
    setActionError(null);
    const res = await resetGuildJoinCodeAction(guild.guild_id);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess(`สร้างรหัสเชิญใหม่สำเร็จ: ${res.data.joinCode}`);
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleKickMember = async (entryId: string, name: string) => {
    if (!confirm(`ต้องการเชิญ ${name} ออกจากกิลด์ใช่หรือไม่?`)) return;
    setActionLoading(true);
    setActionError(null);
    const res = await kickGuildMemberAction(guild.guild_id, entryId);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleSetOfficer = async (entryId: string, isOfficerNow: boolean) => {
    setActionLoading(true);
    setActionError(null);
    const res = await setGuildOfficerAction(guild.guild_id, entryId, !isOfficerNow);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleTransferLeader = async (entryId: string, name: string) => {
    if (!confirm(`ต้องการโอนตำแหน่งหัวหน้ากิลด์ให้ "${name}" ใช่หรือไม่? คุณจะกลายเป็นรองหัวหน้าแทน`)) return;
    setActionLoading(true);
    setActionError(null);
    const res = await transferGuildLeaderAction(guild.guild_id, entryId);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess(`โอนตำแหน่งหัวหน้าให้ ${name} เรียบร้อยแล้ว`);
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionError(null);
    const res = await updateGuildAction({
      guildId: guild.guild_id,
      emblem: editEmblem,
      color: editColor,
      description: editDesc,
      joinPolicy: editPolicy,
    });
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess("บันทึกการตั้งค่ากิลด์เรียบร้อยแล้ว");
      router.refresh();
    }
    setActionLoading(false);
  };

  const handleDisband = async () => {
    if (!confirm("⚠️ คำเตือน: คุณต้องการยุบกิลด์นี้ใช่หรือไม่? การกระทำนี้ไม่สามารถย้อนกลับได้ และสมาชิกทุกคนจะพ้นสภาพกิลด์")) return;
    setActionLoading(true);
    setActionError(null);
    const res = await disbandGuildAction(guild.guild_id);
    if (!res.ok) {
      setActionError(res.error);
    } else {
      router.push("/guilds");
    }
    setActionLoading(false);
  };

  const handleReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason.trim()) return;
    setActionLoading(true);
    setActionError(null);
    const res = await reportGuildAction(guild.guild_id, reportReason.trim());
    if (!res.ok) {
      setActionError(res.error);
    } else {
      setActionSuccess("ส่งรายงานให้แอดมินตรวจสอบเรียบร้อยแล้ว");
      setReportModal(false);
      setReportReason("");
    }
    setActionLoading(false);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      {/* Notifications */}
      {actionError && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--danger-soft)", color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div style={{ padding: "10px 14px", borderRadius: 10, background: "var(--primary-soft)", color: "var(--primary-strong)", fontSize: 13, fontWeight: 600 }}>
          {actionSuccess}
        </div>
      )}

      {/* Main Action Banner for Non-members / Members */}
      <div className="card" style={{ padding: 14, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          {isMemberOfThisGuild ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span className="badge" style={{ background: "var(--primary-soft)", color: "var(--primary-strong)", fontWeight: 700 }}>
                {ROLE_LABELS[myRole || "member"]}
              </span>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>
                คุณเป็นสมาชิกของกิลด์นี้
              </span>
            </div>
          ) : hasPendingRequestHere ? (
            <span style={{ fontSize: 13, color: "var(--held-ink)", fontWeight: 600 }}>
              ⏳ คำขอเข้าร่วมกิลด์ของคุณกำลังรอการอนุมัติ
            </span>
          ) : isInOtherGuild ? (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              คุณอยู่ในกิลด์อื่นอยู่แล้ว (หนึ่งคนสังกัดได้ 1 กิลด์)
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {guild.join_policy === "open"
                ? "กิลด์นี้เปิดรับสมาชิกทันที"
                : guild.join_policy === "code"
                ? "กิลด์นี้ต้องใช้รหัสเชิญในการเข้าร่วม"
                : "กิลด์นี้ต้องส่งคำขอและรอการอนุมัติ"}
            </span>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!isMemberOfThisGuild && !isInOtherGuild && (
            <>
              {guild.join_policy === "open" && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleJoinOpen}
                  disabled={actionLoading}
                >
                  {actionLoading ? "กำลังเข้า..." : "เข้าร่วมกิลด์นี้ 🛡️"}
                </button>
              )}

              {guild.join_policy === "code" && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => setCodeModal(true)}
                  disabled={actionLoading}
                >
                  🔑 ใส่รหัสเชิญเข้าร่วม
                </button>
              )}

              {guild.join_policy === "approval" && (
                hasPendingRequestHere ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleWithdrawRequest}
                    disabled={actionLoading}
                  >
                    ยกเลิกคำขอ
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleRequestJoin}
                    disabled={actionLoading}
                  >
                    {actionLoading ? "กำลังส่ง..." : "ส่งคำขอเข้าร่วม"}
                  </button>
                )
              )}
            </>
          )}

          {isMemberOfThisGuild && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleLeave}
              disabled={actionLoading}
              style={{ color: "var(--danger)" }}
            >
              ออกจากกิลด์
            </button>
          )}

          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setReportModal(true)}
            style={{ fontSize: 12, color: "var(--muted)" }}
          >
            🚩 รายงาน
          </button>
        </div>
      </div>

      {/* Code Modal */}
      {codeModal && (
        <div className="card" style={{ padding: 16, background: "var(--surface-2)" }}>
          <form onSubmit={handleJoinWithCode} className="stack" style={{ gap: 10 }}>
            <strong style={{ fontSize: 14 }}>กรอกรหัสเชิญของกิลด์ {guild.name}</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                className="input"
                placeholder="รหัสเชิญ"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                style={{ textTransform: "uppercase", letterSpacing: "2px", fontWeight: 700 }}
                required
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={actionLoading}>
                ยืนยัน
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCodeModal(false)}>
                ยกเลิก
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Modal */}
      {reportModal && (
        <div className="card" style={{ padding: 16, background: "var(--surface-2)" }}>
          <form onSubmit={handleReport} className="stack" style={{ gap: 10 }}>
            <strong style={{ fontSize: 14 }}>รายงานกิลด์ {guild.name} ต่อผู้ดูแลระบบ</strong>
            <textarea
              className="input"
              rows={3}
              placeholder="ระบุเหตุผล เช่น ชื่อไม่เหมาะสม, พฤติกรรมก่อกวน..."
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              maxLength={300}
              required
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportModal(false)}>
                ยกเลิก
              </button>
              <button type="submit" className="btn btn-danger btn-sm" disabled={actionLoading}>
                ส่งรายงาน
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Section Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", gap: 12 }}>
        <button
          type="button"
          onClick={() => setActiveTab("members")}
          style={{
            background: "none",
            border: "none",
            borderBottom: activeTab === "members" ? "2px solid var(--primary)" : "2px solid transparent",
            color: activeTab === "members" ? "var(--primary-strong)" : "var(--muted)",
            fontWeight: 700,
            fontSize: 14,
            padding: "8px 4px",
            cursor: "pointer",
          }}
        >
          สมาชิก ({members.length} / {GUILD_MAX_MEMBERS})
        </button>

        {canManage && (
          <button
            type="button"
            onClick={() => setActiveTab("manage")}
            style={{
              background: "none",
              border: "none",
              borderBottom: activeTab === "manage" ? "2px solid var(--primary)" : "2px solid transparent",
              color: activeTab === "manage" ? "var(--primary-strong)" : "var(--muted)",
              fontWeight: 700,
              fontSize: 14,
              padding: "8px 4px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            ⚙️ จัดการสมาชิก
            {requests.length > 0 && (
              <span
                style={{
                  background: "var(--danger)",
                  color: "#fff",
                  borderRadius: 999,
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "1px 6px",
                }}
              >
                {requests.length}
              </span>
            )}
          </button>
        )}

        {canManage && (
          <button
            type="button"
            onClick={() => setActiveTab("settings")}
            style={{
              background: "none",
              border: "none",
              borderBottom: activeTab === "settings" ? "2px solid var(--primary)" : "2px solid transparent",
              color: activeTab === "settings" ? "var(--primary-strong)" : "var(--muted)",
              fontWeight: 700,
              fontSize: 14,
              padding: "8px 4px",
              cursor: "pointer",
            }}
          >
            🎨 ตั้งค่ากิลด์
          </button>
        )}
      </div>

      {/* Tab: Members List */}
      {activeTab === "members" && (
        <div className="stack" style={{ gap: 8 }}>
          {members.map((m) => {
            const roleBadge =
              m.role === "leader"
                ? { bg: "#fef3c7", color: "#92400e", label: "👑 หัวหน้ากิลด์" }
                : m.role === "officer"
                ? { bg: "#e0e7ff", color: "#3730a3", label: "⭐ รองหัวหน้า" }
                : { bg: "var(--surface-2)", color: "var(--muted)", label: "สมาชิก" };

            return (
              <div
                key={m.entry_id}
                className="card"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 14px",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      background: "var(--surface-2)",
                      display: "grid",
                      placeItems: "center",
                      overflow: "hidden",
                      fontSize: 14,
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                  >
                    {m.avatar_url ? (
                      <img src={m.avatar_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      (m.name || "ผ")[0]
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.name || "สมาชิกกิลด์"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      เข้าร่วมเมื่อ {new Date(m.joined_at).toLocaleDateString("th-TH")}
                    </div>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    background: roleBadge.bg,
                    color: roleBadge.color,
                    padding: "2px 8px",
                    borderRadius: 999,
                    flexShrink: 0,
                  }}
                >
                  {roleBadge.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Manage Members & Requests */}
      {activeTab === "manage" && canManage && (
        <div className="stack" style={{ gap: 16 }}>
          {/* Invite Code Card */}
          {myGuild?.join_code && (
            <div className="card stack" style={{ gap: 8, padding: 14, background: "var(--surface-2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>🔑 รหัสเชิญกิลด์ (Invite Code)</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={handleResetJoinCode}
                  disabled={actionLoading}
                  style={{ fontSize: 11 }}
                >
                  รีเซ็ตรหัสใหม่
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <code
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    letterSpacing: "3px",
                    color: "var(--primary-strong)",
                    background: "var(--surface)",
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "1px dashed var(--border)",
                  }}
                >
                  {myGuild.join_code}
                </code>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(myGuild.join_code || "");
                    alert("คัดลอกรหัสเชิญเรียบร้อยแล้ว!");
                  }}
                >
                  📋 คัดลอก
                </button>
              </div>
              <small className="muted">ส่งรหัสนี้ให้เพื่อนเพื่อกดเข้าร่วมกิลด์ได้ทันที</small>
            </div>
          )}

          {/* Pending Requests */}
          <div className="stack" style={{ gap: 8 }}>
            <strong style={{ fontSize: 15 }}>
              คำขอเข้าร่วม ({requests.length})
            </strong>
            {requests.length === 0 ? (
              <div className="card" style={{ padding: 16, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
                ไม่มีคำขอที่รออนุมัติในขณะนี้
              </div>
            ) : (
              requests.map((r) => (
                <div
                  key={r.request_id}
                  className="card"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    gap: 10,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.name}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      ส่งเมื่อ {new Date(r.created_at).toLocaleDateString("th-TH")}
                      {r.rating !== null && ` • อันดับแต้ม ${r.rating}`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleDecideRequest(r.request_id, true)}
                      disabled={actionLoading}
                    >
                      อนุมัติ
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => handleDecideRequest(r.request_id, false)}
                      disabled={actionLoading}
                      style={{ color: "var(--danger)" }}
                    >
                      ปฏิเสธ
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Member Role & Kick Actions */}
          <div className="stack" style={{ gap: 8 }}>
            <strong style={{ fontSize: 15 }}>จัดการบทบาทสมาชิก</strong>
            {members.map((m) => {
              const isMe = m.entry_id === myGuild?.entry_id;
              if (isMe) return null;

              // Officer can only kick regular members
              const canKickThisMember = isLeader || (isOfficer && m.role === "member");
              // Only leader can set officer or transfer leadership
              const canPromoteDemote = isLeader && m.role !== "leader";
              const canTransfer = isLeader && m.role !== "leader";

              return (
                <div
                  key={m.entry_id}
                  className="card"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong style={{ fontSize: 14 }}>{m.name || "สมาชิก"}</strong>
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>{ROLE_LABELS[m.role]}</span>
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {canPromoteDemote && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleSetOfficer(m.entry_id, m.role === "officer")}
                        disabled={actionLoading}
                        style={{ fontSize: 12 }}
                      >
                        {m.role === "officer" ? "ลดขั้นเป็นสมาชิก" : "แต่งตั้งเป็นรองหัวหน้า ⭐"}
                      </button>
                    )}

                    {canTransfer && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleTransferLeader(m.entry_id, m.name || "สมาชิก")}
                        disabled={actionLoading}
                        style={{ fontSize: 12, color: "#d97706" }}
                      >
                        โอนหัวหน้ากิลด์ 👑
                      </button>
                    )}

                    {canKickThisMember && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleKickMember(m.entry_id, m.name || "สมาชิก")}
                        disabled={actionLoading}
                        style={{ fontSize: 12, color: "var(--danger)" }}
                      >
                        เชิญออก
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tab: Settings */}
      {activeTab === "settings" && canManage && (
        <form onSubmit={handleUpdateSettings} className="stack" style={{ gap: 16 }}>
          <div className="card stack" style={{ gap: 14, padding: 16 }}>
            {/* Live Preview */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <GuildEmblem emblem={editEmblem} color={editColor} size="lg" />
              <div>
                <strong style={{ fontSize: 16 }}>{guild.name}</strong>
                <span style={{ fontSize: 12, color: "var(--muted)", marginLeft: 6 }}>[{guild.tag}]</span>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {JOIN_POLICY_LABELS[editPolicy].title}
                </div>
              </div>
            </div>

            {/* Emblem picker */}
            <div className="stack" style={{ gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>เปลี่ยนตราสัญลักษณ์</label>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {GUILD_EMBLEMS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setEditEmblem(item)}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      padding: 8,
                      borderRadius: 10,
                      border: editEmblem === item ? `2px solid ${editColor}` : "1px solid var(--border)",
                      background: editEmblem === item ? "var(--surface-2)" : "var(--surface)",
                      cursor: "pointer",
                    }}
                  >
                    <GuildEmblem emblem={item} color={editColor} size="sm" />
                    <span style={{ fontSize: 10 }}>{EMBLEM_LABELS[item]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Color picker */}
            <div className="stack" style={{ gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>เปลี่ยนสีกิลด์</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {GUILD_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setEditColor(c)}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: c,
                      border: editColor === c ? "2px solid #ffffff" : "none",
                      boxShadow: editColor === c ? `0 0 0 2px ${c}` : "none",
                      cursor: "pointer",
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Join policy */}
            <div className="stack" style={{ gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>รูปแบบการเข้าร่วมกิลด์</label>
              {(["open", "approval", "code"] as GuildJoinPolicy[]).map((pol) => (
                <label
                  key={pol}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: 8,
                    borderRadius: 8,
                    background: editPolicy === pol ? "var(--primary-soft)" : "transparent",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="radio"
                    name="editPolicy"
                    value={pol}
                    checked={editPolicy === pol}
                    onChange={() => setEditPolicy(pol)}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{JOIN_POLICY_LABELS[pol].title}</span>
                </label>
              ))}
            </div>

            {/* Description */}
            <div className="stack" style={{ gap: 6 }}>
              <label style={{ fontSize: 13, fontWeight: 700 }}>คำแนะนำกิลด์</label>
              <textarea
                className="input"
                rows={3}
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                maxLength={200}
              />
              <small className="muted">{editDesc.length}/200 ตัวอักษร</small>
            </div>

            <button type="submit" className="btn btn-primary" disabled={actionLoading}>
              บันทึกการเปลี่ยนแปลง
            </button>
          </div>

          {/* Disband guild (Leader only) */}
          {isLeader && (
            <div className="card stack" style={{ gap: 8, padding: 16, border: "1px solid var(--danger-soft)" }}>
              <strong style={{ fontSize: 14, color: "var(--danger)" }}>ยุบกิลด์ (Disband Guild)</strong>
              <p style={{ margin: 0, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
                การยุบกิลด์จะยกเลิกสถานะสมาชิกทั้งหมดและลบกิลด์ออกจากระบบ ชื่อและแท็กจะถูกปลดล็อคให้คนอื่นใช้ได้
              </p>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDisband}
                disabled={actionLoading}
                style={{ alignSelf: "flex-start" }}
              >
                ยุบกิลด์นี้
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
