"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { advancePartyMatch, joinParty, kickPartyMember, leaveParty, movePartySlot } from "@/app/party-actions";
import { formatSlot, formatTime } from "@/lib/format";
import { PARTY_NAME_MAX, PARTY_TEAMS, type PartyMember, type PartyMode, type PartyTeam } from "@/lib/party";

export type PartyRoomView = { party_id: string; host_name: string; title: string; mode: PartyMode; capacity: number; court_id: number; court_name: string; starts_at: string; ends_at: string };

type TeamQueueRow = { team: PartyTeam; ready_at: string; queued_at: string; state: "waiting" | "playing" };
type MatchRow = { id: string; round_no: number; team_a: PartyTeam; team_b: PartyTeam; winner: PartyTeam | null; status: "playing" | "finished"; started_at: string; ended_at: string | null };

export function PartyRoomCard({ room, members, teamQueue, matchRows, loggedIn, defaultName, myEntry, isHost, userAvatar }: { room: PartyRoomView; members: PartyMember[]; teamQueue: TeamQueueRow[]; matchRows: MatchRow[]; loggedIn: boolean; defaultName: string; myEntry: string | null; isHost: boolean; userAvatar?: string | null }) {
  const router = useRouter();
  const mine = members.find((m) => m.entry_id === myEntry);
  const [name, setName] = useState(defaultName);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(mine?.slot_no ?? null);
  const [team, setTeam] = useState<PartyTeam>(mine?.team ?? "A");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ slot: number; team: PartyTeam } | null>(null);
  const [pending, startTransition] = useTransition();
  const occupied = new Map(members.map((m) => [m.slot_no, m]));
  const currentMatch = matchRows.find((match) => match.status === "playing") ?? null;
  const playingTeam = teamQueue.find((row) => row.state === "playing")?.team ?? null;
  const waitingTeams = teamQueue.filter((row) => row.state === "waiting").sort((a, b) => a.queued_at.localeCompare(b.queued_at));
  const nextTeam = waitingTeams[0]?.team ?? null;
  const teamMemberNames = (t: PartyTeam) => {
    const names = members.filter((m) => m.team === t).map((m) => m.name);
    return names.length > 0 ? names.join(", ") : "ยังไม่มีสมาชิก";
  };
  const teamCount = (value: PartyTeam) => members.filter((m) => m.team === value && m.entry_id !== myEntry).length + (team === value && selectedSlot !== null ? 1 : 0);
  const chooseTeam = (value: PartyTeam) => { setTeam(value); if (!mine || mine.team !== value) setSelectedSlot(null); };
  function run(action: () => Promise<{ ok: boolean; error?: string }>, success?: () => void) { setError(null); startTransition(async () => { const result = await action(); if (!result.ok) setError(result.error === "สล็อตนี้มีคนเลือกแล้ว" ? result.error : result.error ?? "เกิดข้อผิดพลาด"); else { success?.(); router.refresh(); } }); }
  function confirmJoin() {
    if (!selectedSlot) return setError("กรุณาเลือกสล็อตที่ว่าง");
    if (!name.trim()) return setError("กรุณาใส่ชื่อของคุณ");
    const success = () => setSaved({ slot: selectedSlot, team });
    if (myEntry) run(() => movePartySlot(myEntry, room.party_id, selectedSlot, team), success);
    else run(() => joinParty(room.party_id, name, selectedSlot, team), success);
  }
  function matchAction(winner: PartyTeam | null) { run(() => advancePartyMatch(room.party_id, winner)); }
  return <section className="stack party-room-detail">
    <Link href="/queue?view=join" className="party-back">‹ <span>เข้าห้อง</span></Link>
    <header className="card party-room-profile"><div className="party-list-icon">🏸</div><div><h1>{room.title}</h1><span>โดย {room.host_name} {isHost && <b>เจ้าของห้อง</b>}</span></div><div className="party-room-facts"><span>▣ {room.court_name}</span><span>◷ {formatSlot(room.starts_at, room.ends_at)}</span><span>♟ {members.length}/{room.capacity}</span></div></header>
    {!myEntry && <div className="party-open-note"><b>✓</b><span><strong>ห้องนี้ยังมีที่ว่าง {room.capacity - members.length} คน</strong><small>กดเลือกสล็อตเพื่อจองตำแหน่งเข้าร่วม</small></span></div>}
    {myEntry && <div className="party-open-note joined"><b>✓</b><span><strong>คุณอยู่ในห้องนี้แล้ว</strong><small>สล็อต {mine?.slot_no} · ทีม {mine?.team}</small></span></div>}
    {!loggedIn && <Link href={`/login?next=/queue/${room.party_id}`} className="btn btn-block">เข้าสู่ระบบเพื่อเข้าห้อง</Link>}
    {loggedIn && <>
      {!myEntry && <label className="field"><span>ชื่อของคุณในห้อง</span><input value={name} maxLength={PARTY_NAME_MAX} onChange={(e) => setName(e.target.value)} /></label>}
      <div className="party-team-picker"><div className="party-team-picker-head"><span className="party-team-picker-icon">♟</span><div><h2>จัดทีมและเลือกสล็อต</h2><p>เลือกทีมที่ต้องการ แล้วเลือกสล็อตว่าง</p></div></div><div className="party-team-card-grid">{PARTY_TEAMS.map((value, index) => { const slots = [index * 2 + 1, index * 2 + 2]; const count = members.filter((m) => m.team === value).length; const active = team === value; return <button key={value} type="button" className={active ? "selected" : ""} onClick={() => chooseTeam(value)}><div><span>♟ ทีม {value}</span><b>{count}/2</b></div><div className="party-team-members">{slots.map((slot) => { const member = occupied.get(slot); const avatar = member?.avatar_url || (member?.entry_id === myEntry ? userAvatar : null); return <span key={slot} className={`party-team-member-slot ${member ? "filled" : ""}`}>{member ? (avatar ? <img src={avatar} alt={member.name} className="party-member-avatar" /> : <span className="party-member-initial">{(member.name || "ผ").trim().charAt(0)}</span>) : "+"}<small>{member?.name ?? `สล็อต ${slot}`}</small></span>; })}</div><i>›</i></button>; })}</div></div>
      <div className="party-slot-section"><h2>เลือกสล็อตทีม {team}</h2><div className="party-slot-grid focused">{[PARTY_TEAMS.indexOf(team) * 2 + 1, PARTY_TEAMS.indexOf(team) * 2 + 2].map((slot) => { const member = occupied.get(slot); const selected = selectedSlot === slot; const avatar = member?.avatar_url || (member?.entry_id === myEntry ? userAvatar : selected ? userAvatar : null); return <button key={slot} type="button" disabled={Boolean(member && member.entry_id !== myEntry) || pending} className={`${member ? "occupied" : "free"} ${selected ? "selected" : ""}`} onClick={() => setSelectedSlot(slot)}><span className="party-slot-icon">{avatar ? <img src={avatar} alt="" className="party-slot-avatar" /> : member ? <span className="party-slot-initial">{(member.name || "ผ").trim().charAt(0)}</span> : "♟"}</span><small>สล็อต {slot}</small><strong>{member?.entry_id === myEntry ? "คุณ" : member?.name ?? "ว่าง"}</strong>{isHost && member && member.entry_id !== myEntry && <i onClick={(e) => { e.stopPropagation(); confirm(`นำ ${member.name} ออกจากห้อง?`) && run(() => kickPartyMember(room.party_id, member.entry_id)); }}>นำออก</i>}</button>; })}</div></div>
      {!myEntry && selectedSlot !== null && <div className="party-join-summary"><strong>สรุปก่อนเข้าห้อง</strong><span>{room.title} · สล็อต {selectedSlot} · ทีม {team}</span><small>{room.court_name} · {formatSlot(room.starts_at, room.ends_at)}</small></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-block party-confirm-join" disabled={pending || selectedSlot === null} onClick={confirmJoin}>{pending ? "กำลังตรวจสอบสล็อต…" : "▣ บันทึกทีมและดูตารางแข่ง →"}</button>
      {myEntry && !isHost && <button type="button" className="btn btn-ghost btn-block" disabled={pending} onClick={() => confirm("ออกจากห้องนี้?") && run(() => leaveParty(myEntry, room.party_id), () => router.push("/queue?view=join"))}>ออกจากห้อง</button>}
    </>}
    <div id="party-schedule" className="party-live-matching card">
      <div className="party-matching-title">
        <div>
          <h2>▣ Matching ก๊วน</h2>
          <p>ชนะอยู่ต่อ · แพ้ไปต่อท้ายคิว (ทีมเต็มก่อน ได้คิวก่อน)</p>
        </div>
        <span>{teamQueue.length} ทีมพร้อม</span>
      </div>
      <div className="party-current-match">
        <span>กำลังแข่งขัน</span>
        {currentMatch ? (
          <div>
            <strong>ทีม <b>{currentMatch.team_a}</b><em>VS</em>ทีม <b>{currentMatch.team_b}</b></strong>
            <small className="muted" style={{ display: "block", marginTop: 2, fontSize: 12 }}>
              {teamMemberNames(currentMatch.team_a)} พบ {teamMemberNames(currentMatch.team_b)}
            </small>
          </div>
        ) : playingTeam ? (
          <div>
            <strong>ทีม <b>{playingTeam}</b> ชนะในรอบที่ผ่านมา (ครองสนาม)</strong>
            <small className="muted" style={{ display: "block", marginTop: 2, fontSize: 12 }}>
              รอผู้ท้าชิงขึ้นมาแข่งขัน
            </small>
          </div>
        ) : (
          <strong className="muted">รอหัวห้องเริ่มการแข่งขัน</strong>
        )}
        <small>{room.court_name}</small>
      </div>
      <div className="party-next-queue">
        <span>คิวถัดไป</span>
        <strong>
          {currentMatch
            ? (nextTeam ? `ผู้ชนะ พบ ทีม ${nextTeam} (${teamMemberNames(nextTeam)})` : "รอทีมที่สมาชิกครบ")
            : playingTeam
              ? (nextTeam ? `ทีม ${playingTeam} (${teamMemberNames(playingTeam)}) พบ ทีม ${nextTeam} (${teamMemberNames(nextTeam)})` : "รอผู้ท้าชิงที่สมาชิกครบ")
              : waitingTeams.length >= 2
                ? `ทีม ${waitingTeams[0].team} (${teamMemberNames(waitingTeams[0].team)}) พบ ทีม ${waitingTeams[1].team} (${teamMemberNames(waitingTeams[1].team)})`
                : "รออย่างน้อย 2 ทีมที่สมาชิกครบ"}
        </strong>
      </div>
      <div className="party-queue-strip">
        <span>ลำดับทีมพร้อม ({waitingTeams.length} ทีม)</span>
        <div>
          {waitingTeams.map((row, index) => (
            <b key={row.team} title={teamMemberNames(row.team)}>
              {index + 1}. ทีม {row.team} ({teamMemberNames(row.team)})
            </b>
          ))}
          {waitingTeams.length === 0 && <small>ยังไม่มีทีมรอคิว</small>}
        </div>
      </div>
      {isHost && (
        <div className="party-host-match-actions">
          {currentMatch ? (
            <>
              <p>หัวห้องเลือกทีมที่ชนะ (ทีมชนะอยู่ต่อ · ทีมแพ้ไปต่อท้ายคิว)</p>
              <div>
                <button type="button" className="btn" disabled={pending} onClick={() => matchAction(currentMatch.team_a)}>
                  🏆 ทีม {currentMatch.team_a} ชนะ
                  <span style={{ display: "block", fontSize: 11, fontWeight: "normal", opacity: 0.85 }}>
                    ({teamMemberNames(currentMatch.team_a)})
                  </span>
                </button>
                <button type="button" className="btn" disabled={pending} onClick={() => matchAction(currentMatch.team_b)}>
                  🏆 ทีม {currentMatch.team_b} ชนะ
                  <span style={{ display: "block", fontSize: 11, fontWeight: "normal", opacity: 0.85 }}>
                    ({teamMemberNames(currentMatch.team_b)})
                  </span>
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-block"
              disabled={pending || (playingTeam ? waitingTeams.length < 1 : waitingTeams.length < 2)}
              onClick={() => matchAction(null)}
            >
              {playingTeam
                ? (waitingTeams.length >= 1
                    ? `เริ่มคู่ถัดไป (ทีม ${playingTeam} พบ ทีม ${waitingTeams[0].team})`
                    : "รอทีมผู้ท้าชิงที่สมาชิกครบ")
                : (waitingTeams.length >= 2
                    ? `เริ่มคู่แรก (ทีม ${waitingTeams[0].team} พบ ทีม ${waitingTeams[1].team})`
                    : "รออย่างน้อย 2 ทีมที่สมาชิกครบ")}
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
    <div className="party-schedule-table card">
      <h2>▣ ประวัติการแข่งขัน</h2>
      <div className="party-schedule-table-head">
        <span>รอบ</span>
        <span>คู่แข่งขัน</span>
        <span>เวลา</span>
        <span>ผล</span>
        <span>สนาม</span>
      </div>
      {matchRows.length === 0 ? (
        <p className="muted">เมื่อมีทีมเต็ม 2 ทีม หัวห้องสามารถเริ่มคู่แรกได้ทันที</p>
      ) : (
        [...matchRows].reverse().map((match) => (
          <div className="party-schedule-table-row" key={match.id}>
            <span>รอบ {match.round_no}</span>
            <strong>
              ทีม <b>{match.team_a}</b> <small style={{ fontWeight: 400, opacity: 0.85 }}>({teamMemberNames(match.team_a)})</small>{" "}
              <em>พบ</em>{" "}
              ทีม <b>{match.team_b}</b> <small style={{ fontWeight: 400, opacity: 0.85 }}>({teamMemberNames(match.team_b)})</small>
            </strong>
            <span>{formatTime(match.started_at)} น.</span>
            <span className={`match-status ${match.status === "playing" ? "playing" : ""}`}>
              {match.status === "playing" ? "กำลังแข่ง" : `ทีม ${match.winner} ชนะ`}
            </span>
            <span>{room.court_name}</span>
          </div>
        ))
      )}
    </div>
    {saved && <div className="party-saved-overlay" role="dialog" aria-modal="true" aria-labelledby="party-saved-title"><div className="party-saved-modal"><div className="party-saved-check">✓</div><h2 id="party-saved-title">บันทึกแล้ว</h2><p>สล็อต {saved.slot} · ทีม {saved.team}</p><span>ข้อมูลการเข้าห้องของคุณเรียบร้อยแล้ว</span><button type="button" className="btn btn-block" onClick={() => setSaved(null)}>ตกลง</button></div></div>}
  </section>;
}
