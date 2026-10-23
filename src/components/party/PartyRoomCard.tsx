"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { advancePartyMatch, advanceSinglesMatch, joinParty, kickPartyMember, leaveParty, movePartySlot, setPartyMatchRules } from "@/app/party-actions";
import { formatSlot, formatTime } from "@/lib/format";
import { PARTY_NAME_MAX, PARTY_TEAMS, eloDelta, type PartyMember, type PartyMode, type PartyTeam } from "@/lib/party";

export type PartyRoomView = { party_id: string; host_name: string; title: string; mode: PartyMode; capacity: number; court_id: number; court_name: string; starts_at: string; ends_at: string };

type TeamQueueRow = { team: PartyTeam; ready_at: string; queued_at: string; state: "waiting" | "playing"; played?: number; wins?: number; streak?: number; rating?: number };
type MatchRow = { id: string; round_no: number; team_a: PartyTeam; team_b: PartyTeam; winner: PartyTeam | null; status: "playing" | "finished"; started_at: string; ended_at: string | null };
type SinglesQueueRow = { entry_id: string; name: string; queued_at: string; state: "waiting" | "playing" };
/** One player's night: the ladder rating they carry, and what this room did to it. */
type PlayerStat = {
  entry_id: string; name: string; rating: number; rating_delta: number;
  played: number; wins: number; losses: number; streak: number; best_streak: number;
};
type SinglesMatchRow = { id: string; round_no: number; player_a_entry: string; player_a_name: string; player_b_entry: string; player_b_name: string; winner_entry: string | null; winner_name: string | null; status: "playing" | "finished"; started_at: string; ended_at: string | null };

export function PartyRoomCard({ room, members, teamQueue, matchRows, singlesQueue, singlesMatchRows, stats = [], winStreakCap = 3, loggedIn, defaultName, myEntry, isHost, userAvatar }: { room: PartyRoomView; members: PartyMember[]; teamQueue: TeamQueueRow[]; matchRows: MatchRow[]; singlesQueue: SinglesQueueRow[]; singlesMatchRows: SinglesMatchRow[]; stats?: PlayerStat[]; winStreakCap?: number; loggedIn: boolean; defaultName: string; myEntry: string | null; isHost: boolean; userAvatar?: string | null }) {
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
  const teamRow = (t: PartyTeam) => teamQueue.find((row) => row.team === t);
  // Same order the database calls teams on in (0029): fewest games, then longest waiting.
  const waitingTeams = teamQueue
    .filter((row) => row.state === "waiting")
    .sort((a, b) => (a.played ?? 0) - (b.played ?? 0) || a.queued_at.localeCompare(b.queued_at));
  const nextTeam = waitingTeams[0]?.team ?? null;
  const statOf = (entryId: string) => stats.find((s) => s.entry_id === entryId);
  const currentSinglesMatch = singlesMatchRows.find((match) => match.status === "playing") ?? null;
  const playingPlayer = singlesQueue.find((row) => row.state === "playing" && !currentSinglesMatch) ?? null;
  // Show the line in the order the database will actually call people on (0029): fewest
  // games first, then whoever has waited longest. Sorting by arrival alone used to name
  // the wrong player as next up.
  const waitingPlayers = singlesQueue
    .filter((row) => row.state === "waiting")
    .sort((a, b) =>
      (statOf(a.entry_id)?.played ?? 0) - (statOf(b.entry_id)?.played ?? 0) ||
      a.queued_at.localeCompare(b.queued_at));
  const teamMembers = (t: PartyTeam) => members.filter((m) => m.team === t);
  // Highest rating first; someone who has not played yet sits below those who have.
  const standings = [...stats].sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.played - b.played);
  // Each game is one win and one loss, so the room's game count is half the total.
  const played = Math.round(stats.reduce((sum, s) => sum + s.played, 0) / 2);
  const ratingBadge = (entryId: string) => {
    const st = statOf(entryId);
    if (!st) return null;
    return <span className="party-rating-badge">{st.rating}{st.streak > 1 && <b title={`ชนะติดกัน ${st.streak} เกม`}>🔥{st.streak}</b>}</span>;
  };
  const teamMemberNames = (t: PartyTeam) => {
    const names = members.filter((m) => m.team === t).map((m) => m.name);
    return names.length > 0 ? names.join(", ") : "ยังไม่มีสมาชิก";
  };
  const teamCount = (value: PartyTeam) => members.filter((m) => m.team === value && m.entry_id !== myEntry).length + (team === value && selectedSlot !== null ? 1 : 0);
  const chooseTeam = (value: PartyTeam) => { setTeam(value); if (!mine || mine.team !== value) setSelectedSlot(null); };
  const chooseSinglesSlot = (slot: number) => { setTeam(PARTY_TEAMS[Math.floor((slot - 1) / 2)]); setSelectedSlot(slot); };
  function run(action: () => Promise<{ ok: boolean; error?: string }>, success?: () => void) { setError(null); startTransition(async () => { const result = await action(); if (!result.ok) setError(result.error === "สล็อตนี้มีคนเลือกแล้ว" ? result.error : result.error ?? "เกิดข้อผิดพลาด"); else { success?.(); router.refresh(); } }); }
  function confirmJoin() {
    if (!selectedSlot) return setError("กรุณาเลือกสล็อตที่ว่าง");
    if (!name.trim()) return setError("กรุณาใส่ชื่อของคุณ");
    const success = () => setSaved({ slot: selectedSlot, team });
    if (myEntry) run(() => movePartySlot(myEntry, room.party_id, selectedSlot, team), success);
    else run(() => joinParty(room.party_id, name, selectedSlot, team), success);
  }
  function matchAction(winner: PartyTeam | null) { run(() => advancePartyMatch(room.party_id, winner)); }
  function singlesMatchAction(winnerEntry: string | null) { run(() => advanceSinglesMatch(room.party_id, winnerEntry)); }
  function changeCap(cap: number) { run(() => setPartyMatchRules(room.party_id, cap)); }
  /** "+12 / -8" — what each side stands to gain or lose, shown before the host decides. */
  const stake = (ratingA?: number | null, ratingB?: number | null) => {
    if (!ratingA || !ratingB) return null;
    return { a: eloDelta(ratingA, ratingB), b: eloDelta(ratingB, ratingA) };
  };
  return <section className="stack party-room-detail">
    <Link href="/queue?view=join" className="party-back">‹ <span>เข้าห้อง</span></Link>
    <header className="card party-room-profile"><div className="party-list-icon">🏸</div><div><h1>{room.title}</h1><span>โดย {room.host_name} {isHost && <b>เจ้าของห้อง</b>}</span></div><div className="party-room-facts"><span>▣ {room.court_name}</span><span>◷ {formatSlot(room.starts_at, room.ends_at)}</span><span>♟ {members.length}/{room.capacity}</span></div></header>
    {!myEntry && <div className="party-open-note"><b>✓</b><span><strong>ห้องนี้ยังมีที่ว่าง {room.capacity - members.length} คน</strong><small>กดเลือกสล็อตเพื่อจองตำแหน่งเข้าร่วม</small></span></div>}
    {myEntry && <div className="party-open-note joined"><b>✓</b><span><strong>คุณอยู่ในห้องนี้แล้ว</strong><small>สล็อต {mine?.slot_no} · ทีม {mine?.team}</small></span></div>}
    {!loggedIn && <Link href={`/login?next=/queue/${room.party_id}`} className="btn btn-block">เข้าสู่ระบบเพื่อเข้าห้อง</Link>}
    {loggedIn && <>
      {!myEntry && <label className="field"><span>ชื่อของคุณในห้อง</span><input value={name} maxLength={PARTY_NAME_MAX} onChange={(e) => setName(e.target.value)} /></label>}
      {room.mode === "doubles" ? <><div className="party-team-picker"><div className="party-team-picker-head"><span className="party-team-picker-icon">♟</span><div><h2>จัดทีมและเลือกสล็อต</h2><p>เลือกทีมที่ต้องการ แล้วเลือกสล็อตว่าง</p></div></div><div className="party-team-card-grid">{PARTY_TEAMS.map((value, index) => { const slots = [index * 2 + 1, index * 2 + 2]; const count = members.filter((m) => m.team === value).length; const active = team === value; return <button key={value} type="button" className={active ? "selected" : ""} onClick={() => chooseTeam(value)}><div><span>♟ ทีม {value}</span><b>{count}/2</b></div><div className="party-team-members">{slots.map((slot) => { const member = occupied.get(slot); return <span key={slot} className={`party-team-member-slot ${member ? "filled" : ""}`}>{member ? "♟" : "+"}</span>; })}</div><i>›</i></button>; })}</div></div><div className="party-slot-section"><h2>เลือกสล็อตทีม {team}</h2><div className="party-slot-grid focused">{[PARTY_TEAMS.indexOf(team) * 2 + 1, PARTY_TEAMS.indexOf(team) * 2 + 2].map((slot) => { const member = occupied.get(slot); const selected = selectedSlot === slot; return <button key={slot} type="button" disabled={Boolean(member && member.entry_id !== myEntry) || pending} className={`${member ? "occupied" : "free"} ${selected ? "selected" : ""}`} onClick={() => setSelectedSlot(slot)}><span>♟</span><small>สล็อต {slot}</small><strong>{member?.entry_id === myEntry ? "คุณ" : member?.name ?? "ว่าง"}</strong></button>; })}</div></div></> : <div className="party-slot-section singles"><h2>เลือกสล็อตผู้เล่น</h2><p className="muted">ห้องเดี่ยวไม่มีทีม เลือกตำแหน่งว่างได้เลย</p><div className="party-slot-grid">{Array.from({ length: 12 }, (_, i) => i + 1).map((slot) => { const member = occupied.get(slot); const selected = selectedSlot === slot; return <button key={slot} type="button" disabled={Boolean(member && member.entry_id !== myEntry) || pending} className={`${member ? "occupied" : "free"} ${selected ? "selected" : ""}`} onClick={() => chooseSinglesSlot(slot)}><span>♟</span><small>สล็อต {slot}</small><strong>{member?.entry_id === myEntry ? "คุณ" : member?.name ?? "ว่าง"}</strong></button>; })}</div></div>}
      {!myEntry && selectedSlot !== null && <div className="party-join-summary"><strong>สรุปก่อนเข้าห้อง</strong><span>{room.title} · สล็อต {selectedSlot}{room.mode === "doubles" ? ` · ทีม ${team}` : ""}</span><small>{room.court_name} · {formatSlot(room.starts_at, room.ends_at)}</small></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-block party-confirm-join" disabled={pending || selectedSlot === null} onClick={confirmJoin}>{pending ? "กำลังตรวจสอบสล็อต…" : room.mode === "doubles" ? "▣ บันทึกทีมและดูตารางแข่ง →" : "บันทึกสล็อตผู้เล่น"}</button>
      {myEntry && !isHost && <button type="button" className="btn btn-ghost btn-block" disabled={pending} onClick={() => confirm("ออกจากห้องนี้?") && run(() => leaveParty(myEntry, room.party_id), () => router.push("/queue?view=join"))}>ออกจากห้อง</button>}
    </>}
    {room.mode === "doubles" && <><div id="party-schedule" className="party-live-matching card">
      <div className="party-matching-title">
        <div>
          <h2>▣ Matching ห้องคู่</h2>
          <p>ชนะอยู่ต่อ · ชนะครบ {winStreakCap} เกมติดต้องพัก · เลือกทีมจากทีมที่ลงสนามน้อยที่สุดก่อน แล้วจึงดูฝีมือใกล้เคียง</p>
        </div>
        <span>{teamQueue.length} ทีมพร้อม</span>
      </div>
      <div className="party-current-match">
        <span>กำลังแข่งขัน</span>
        {currentMatch ? (
          <div>
            <strong>ทีม <b>{currentMatch.team_a}</b><em>VS</em>ทีม <b>{currentMatch.team_b}</b></strong>
            {teamRow(currentMatch.team_a)?.rating && <small className="party-match-ratings">{teamRow(currentMatch.team_a)?.rating} · {teamRow(currentMatch.team_b)?.rating} แต้ม (เฉลี่ยของทีม)</small>}
            <div className="party-match-avatars-row">
              <div className="party-match-team-group">
                {teamMembers(currentMatch.team_a).map((m) => {
                  const av = m.avatar_url || (m.entry_id === myEntry ? userAvatar : null);
                  return (
                    <span key={m.entry_id} className="party-player-pill" title={m.name}>
                      {av ? <img src={av} alt="" className="party-player-avatar-xs" /> : <span className="party-player-initial-xs">{(m.name || "ผ").trim().charAt(0)}</span>}
                      <span>{m.name}</span>
                    </span>
                  );
                })}
              </div>
              <span className="party-match-vs-label">พบ</span>
              <div className="party-match-team-group">
                {teamMembers(currentMatch.team_b).map((m) => {
                  const av = m.avatar_url || (m.entry_id === myEntry ? userAvatar : null);
                  return (
                    <span key={m.entry_id} className="party-player-pill" title={m.name}>
                      {av ? <img src={av} alt="" className="party-player-avatar-xs" /> : <span className="party-player-initial-xs">{(m.name || "ผ").trim().charAt(0)}</span>}
                      <span>{m.name}</span>
                    </span>
                  );
                })}
              </div>
            </div>
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
        <span>ลำดับทีมพร้อม ({waitingTeams.length} ทีม) · ทีมที่ลงสนามน้อยที่สุดได้ก่อน</span>
        <div>
          {waitingTeams.map((row, index) => {
            const tMembers = teamMembers(row.team);
            return (
              <span key={row.team} className="party-queue-chip" title={teamMemberNames(row.team)}>
                <b>{index + 1}. ทีม {row.team}</b>
                <span className="party-queue-avatars">
                  {tMembers.map((m) => {
                    const av = m.avatar_url || (m.entry_id === myEntry ? userAvatar : null);
                    return av ? (
                      <img key={m.entry_id} src={av} alt="" className="party-player-avatar-xxs" />
                    ) : (
                      <span key={m.entry_id} className="party-player-initial-xxs">{(m.name || "ผ").trim().charAt(0)}</span>
                    );
                  })}
                </span>
                <small>{teamMemberNames(row.team)}</small>
                {row.rating ? <span className="party-rating-badge">{row.rating}{(row.played ?? 0) > 0 && <i>{row.wins ?? 0}-{(row.played ?? 0) - (row.wins ?? 0)}</i>}{(row.streak ?? 0) > 1 && <b title={`ชนะติดกัน ${row.streak} เกม`}>🔥{row.streak}</b>}</span> : null}
              </span>
            );
          })}
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
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    🏆 ทีม {currentMatch.team_a} ชนะ
                    <span className="party-btn-avatars">
                      {teamMembers(currentMatch.team_a).map((m) => {
                        const av = m.avatar_url || (m.entry_id === myEntry ? userAvatar : null);
                        return av ? <img key={m.entry_id} src={av} alt="" className="party-player-avatar-xxs" /> : null;
                      })}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 11, fontWeight: "normal", opacity: 0.85 }}>
                    ({teamMemberNames(currentMatch.team_a)})
                  </span>
                  {(() => { const bet = stake(teamRow(currentMatch.team_a)?.rating, teamRow(currentMatch.team_b)?.rating); return bet ? <small className="party-stake">+{bet.a} แต้ม</small> : null; })()}
                </button>
                <button type="button" className="btn" disabled={pending} onClick={() => matchAction(currentMatch.team_b)}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    🏆 ทีม {currentMatch.team_b} ชนะ
                    <span className="party-btn-avatars">
                      {teamMembers(currentMatch.team_b).map((m) => {
                        const av = m.avatar_url || (m.entry_id === myEntry ? userAvatar : null);
                        return av ? <img key={m.entry_id} src={av} alt="" className="party-player-avatar-xxs" /> : null;
                      })}
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 11, fontWeight: "normal", opacity: 0.85 }}>
                    ({teamMemberNames(currentMatch.team_b)})
                  </span>
                  {(() => { const bet = stake(teamRow(currentMatch.team_b)?.rating, teamRow(currentMatch.team_a)?.rating); return bet ? <small className="party-stake">+{bet.a} แต้ม</small> : null; })()}
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
              ทีม <b>{match.team_a}</b> <em>พบ</em> ทีม <b>{match.team_b}</b>
            </strong>
            <span>{formatTime(match.started_at)} น.</span>
            <span className={`match-status ${match.status === "playing" ? "playing" : ""}`}>
              {match.status === "playing" ? "กำลังแข่ง" : `ทีม ${match.winner} ชนะ`}
            </span>
            <span>{room.court_name}</span>
          </div>
        ))
      )}
    </div></>}
    {room.mode === "singles" && <><div id="party-schedule" className="party-live-matching card">
      <div className="party-matching-title">
        <div><h2>▣ Matching เดี่ยว</h2><p>ชนะอยู่ต่อ · ชนะครบ {winStreakCap} เกมติดต้องพัก · เลือกคู่จากคนที่ลงสนามน้อยที่สุดก่อน แล้วจึงดูฝีมือใกล้เคียง</p></div>
        <span>{singlesQueue.length} คนพร้อม</span>
      </div>
      <div className="party-current-match">
        <span>กำลังแข่งขัน</span>
        {currentSinglesMatch ? <div><strong>{currentSinglesMatch.player_a_name}<em>VS</em>{currentSinglesMatch.player_b_name}</strong><small className="party-match-ratings">{statOf(currentSinglesMatch.player_a_entry)?.rating ?? "-"} · {statOf(currentSinglesMatch.player_b_entry)?.rating ?? "-"} แต้ม</small></div>
          : playingPlayer ? <strong>{playingPlayer.name} ชนะรอบที่ผ่านมาและครองสนาม</strong>
          : <strong className="muted">รอหัวห้องเริ่มการแข่งขัน</strong>}
        <small>{room.court_name}</small>
      </div>
      <div className="party-next-queue">
        <span>คิวถัดไป</span>
        <strong>{currentSinglesMatch
          ? (waitingPlayers[0] ? `ผู้ชนะ พบ ${waitingPlayers[0].name}` : "รอผู้เล่นคนถัดไป")
          : playingPlayer
            ? (waitingPlayers[0] ? `${playingPlayer.name} พบ ${waitingPlayers[0].name}` : "รอผู้ท้าชิง")
            : waitingPlayers.length >= 2 ? `${waitingPlayers[0].name} พบ ${waitingPlayers[1].name}` : "รออย่างน้อย 2 คน"}</strong>
      </div>
      <div className="party-queue-strip">
        <span>ลำดับผู้เล่นที่รอ ({waitingPlayers.length} คน) · คนที่ลงสนามน้อยที่สุดได้ก่อน</span>
        <div>{waitingPlayers.map((row, index) => <b key={row.entry_id}>{index + 1}. {row.name}{ratingBadge(row.entry_id)}</b>)}{waitingPlayers.length === 0 && <small>ยังไม่มีผู้เล่นรอคิว</small>}</div>
      </div>
      {isHost && <div className="party-host-match-actions">
        {currentSinglesMatch ? (() => {
          const bet = stake(statOf(currentSinglesMatch.player_a_entry)?.rating, statOf(currentSinglesMatch.player_b_entry)?.rating);
          return <><p>หัวห้องเลือกผู้ชนะ (ผู้ชนะอยู่ต่อ · ผู้แพ้ไปต่อท้ายคิว)</p><div>
            <button type="button" className="btn" disabled={pending} onClick={() => singlesMatchAction(currentSinglesMatch.player_a_entry)}>🏆 {currentSinglesMatch.player_a_name} ชนะ{bet && <small>+{bet.a} แต้ม</small>}</button>
            <button type="button" className="btn" disabled={pending} onClick={() => singlesMatchAction(currentSinglesMatch.player_b_entry)}>🏆 {currentSinglesMatch.player_b_name} ชนะ{bet && <small>+{bet.b} แต้ม</small>}</button>
          </div></>;
        })() : <button type="button" className="btn btn-block" disabled={pending || (playingPlayer ? waitingPlayers.length < 1 : waitingPlayers.length < 2)} onClick={() => singlesMatchAction(null)}>
          {playingPlayer ? (waitingPlayers[0] ? `เริ่มคู่ถัดไป (${playingPlayer.name} พบ ${waitingPlayers[0].name})` : "รอผู้ท้าชิง") : waitingPlayers.length >= 2 ? `เริ่มคู่แรก (${waitingPlayers[0].name} พบ ${waitingPlayers[1].name})` : "รออย่างน้อย 2 คน"}
        </button>}
      </div>}
      {error && <p className="error">{error}</p>}
    </div>
    <div className="party-schedule-table card">
      <h2>▣ ประวัติการแข่งขัน</h2>
      <div className="party-schedule-table-head"><span>รอบ</span><span>คู่แข่งขัน</span><span>เวลา</span><span>ผล</span><span>สนาม</span></div>
      {singlesMatchRows.length === 0 ? <p className="muted">เมื่อมีผู้เล่น 2 คน หัวห้องสามารถเริ่มคู่แรกได้ทันที</p> : [...singlesMatchRows].reverse().map((match) => <div className="party-schedule-table-row" key={match.id}>
        <span>รอบ {match.round_no}</span><strong>{match.player_a_name} <em>พบ</em> {match.player_b_name}</strong><span>{formatTime(match.started_at)} น.</span>
        <span className={`match-status ${match.status === "playing" ? "playing" : ""}`}>{match.status === "playing" ? "กำลังแข่ง" : `${match.winner_name} ชนะ`}</span><span>{room.court_name}</span>
      </div>)}
    </div></>}
    {stats.length > 0 && <div className="party-standings card">
      <div className="party-standings-head">
        <h2>▣ อันดับคืนนี้</h2>
        <span>{played > 0 ? `เล่นไปแล้ว ${played} เกม` : "ยังไม่เริ่มเล่น"}</span>
      </div>
      <p className="muted party-standings-note">แต้มเริ่มที่ 1000 ชนะคนแต้มสูงกว่าได้เยอะ ชนะคนแต้มต่ำกว่าได้น้อย และแต้มติดตัวไปก๊วนครั้งหน้าด้วย</p>
      <div className="party-standings-row party-standings-header"><span>#</span><span>ผู้เล่น</span><span>ลง</span><span>ชนะ</span><span>แต้ม</span></div>
      {standings.map((row, index) => (
        <div key={row.entry_id} className={`party-standings-row ${row.entry_id === myEntry ? "me" : ""}`}>
          <span className="party-standings-rank">{index + 1}</span>
          <span className="party-standings-name">
            {row.name}
            {row.entry_id === myEntry && <i>คุณ</i>}
            {row.streak > 1 && <b title={`ชนะติดกัน ${row.streak} เกม`}>🔥{row.streak}</b>}
          </span>
          <span>{row.played}</span>
          <span>{row.wins}-{row.losses}</span>
          <span className="party-standings-rating">
            {row.rating}
            {row.rating_delta !== 0 && <small className={row.rating_delta > 0 ? "up" : "down"}>{row.rating_delta > 0 ? "+" : ""}{row.rating_delta}</small>}
          </span>
        </div>
      ))}
      {isHost && <div className="party-standings-rules">
        <p>ชนะติดกันได้กี่เกมก่อนต้องพัก</p>
        <div>{[2, 3, 5].map((cap) => (
          <button key={cap} type="button" className={`btn btn-sm ${cap === winStreakCap ? "" : "btn-ghost"}`} disabled={pending || cap === winStreakCap} onClick={() => changeCap(cap)}>{cap} เกม</button>
        ))}</div>
      </div>}
    </div>}
    {saved && <div className="party-saved-overlay" role="dialog" aria-modal="true" aria-labelledby="party-saved-title"><div className="party-saved-modal"><div className="party-saved-check">✓</div><h2 id="party-saved-title">บันทึกแล้ว</h2><p>สล็อต {saved.slot}{room.mode === "doubles" ? ` · ทีม ${saved.team}` : ""}</p><span>ข้อมูลการเข้าห้องของคุณเรียบร้อยแล้ว</span><button type="button" className="btn btn-block" onClick={() => setSaved(null)}>ตกลง</button></div></div>}
  </section>;
}
