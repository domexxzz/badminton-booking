"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { joinParty, kickPartyMember, leaveParty, movePartySlot } from "@/app/party-actions";
import { formatSlot, formatTime } from "@/lib/format";
import { buildPartyTeamSchedule, PARTY_NAME_MAX, PARTY_TEAMS, type PartyMember, type PartyMode, type PartyTeam } from "@/lib/party";

export type PartyRoomView = { party_id: string; host_name: string; title: string; mode: PartyMode; capacity: number; court_id: number; court_name: string; starts_at: string; ends_at: string };

export function PartyRoomCard({ room, members, loggedIn, defaultName, myEntry, isHost }: { room: PartyRoomView; members: PartyMember[]; loggedIn: boolean; defaultName: string; myEntry: string | null; isHost: boolean }) {
  const router = useRouter();
  const mine = members.find((m) => m.entry_id === myEntry);
  const [name, setName] = useState(defaultName);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(mine?.slot_no ?? null);
  const [team, setTeam] = useState<PartyTeam>(mine?.team ?? "A");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ slot: number; team: PartyTeam } | null>(null);
  const [pending, startTransition] = useTransition();
  const occupied = new Map(members.map((m) => [m.slot_no, m]));
  const matches = buildPartyTeamSchedule(room.starts_at, room.ends_at);
  const now = Date.now();
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
  return <section className="stack party-room-detail">
    <Link href="/queue?view=join" className="party-back">‹ <span>เข้าห้อง</span></Link>
    <header className="card party-room-profile"><div className="party-list-icon">🏸</div><div><h1>{room.title}</h1><span>โดย {room.host_name} {isHost && <b>เจ้าของห้อง</b>}</span></div><div className="party-room-facts"><span>▣ {room.court_name}</span><span>◷ {formatSlot(room.starts_at, room.ends_at)}</span><span>♟ {members.length}/{room.capacity}</span></div></header>
    {!myEntry && <div className="party-open-note"><b>✓</b><span><strong>ห้องนี้ยังมีที่ว่าง {room.capacity - members.length} คน</strong><small>กดเลือกสล็อตเพื่อจองตำแหน่งเข้าร่วม</small></span></div>}
    {myEntry && <div className="party-open-note joined"><b>✓</b><span><strong>คุณอยู่ในห้องนี้แล้ว</strong><small>สล็อต {mine?.slot_no} · ทีม {mine?.team}</small></span></div>}
    {!loggedIn && <Link href={`/login?next=/queue/${room.party_id}`} className="btn btn-block">เข้าสู่ระบบเพื่อเข้าห้อง</Link>}
    {loggedIn && <>
      {!myEntry && <label className="field"><span>ชื่อของคุณในห้อง</span><input value={name} maxLength={PARTY_NAME_MAX} onChange={(e) => setName(e.target.value)} /></label>}
      <div className="party-team-picker"><div className="party-team-picker-head"><span className="party-team-picker-icon">♟</span><div><h2>จัดทีมและเลือกสล็อต</h2><p>เลือกทีมที่ต้องการ แล้วเลือกสล็อตว่าง</p></div></div><div className="party-team-card-grid">{PARTY_TEAMS.map((value, index) => { const slots = [index * 2 + 1, index * 2 + 2]; const count = members.filter((m) => m.team === value).length; const active = team === value; return <button key={value} type="button" className={active ? "selected" : ""} onClick={() => chooseTeam(value)}><div><span>♟ ทีม {value}</span><b>{count}/2</b></div><div className="party-team-members">{slots.map((slot) => { const member = occupied.get(slot); return <span key={slot} className={member ? "filled" : ""}>{member ? "♟" : "+"}<small>{member?.name ?? `สล็อต ${slot}`}</small></span>; })}</div><i>›</i></button>; })}</div></div>
      <div className="party-slot-section"><h2>เลือกสล็อตทีม {team}</h2><div className="party-slot-grid focused">{[PARTY_TEAMS.indexOf(team) * 2 + 1, PARTY_TEAMS.indexOf(team) * 2 + 2].map((slot) => { const member = occupied.get(slot); const selected = selectedSlot === slot; return <button key={slot} type="button" disabled={Boolean(member && member.entry_id !== myEntry) || pending} className={`${member ? "occupied" : "free"} ${selected ? "selected" : ""}`} onClick={() => setSelectedSlot(slot)}><span>♟</span><small>สล็อต {slot}</small><strong>{member?.entry_id === myEntry ? "คุณ" : member?.name ?? "ว่าง"}</strong>{isHost && member && member.entry_id !== myEntry && <i onClick={(e) => { e.stopPropagation(); confirm(`นำ ${member.name} ออกจากห้อง?`) && run(() => kickPartyMember(room.party_id, member.entry_id)); }}>นำออก</i>}</button>; })}</div></div>
      {!myEntry && selectedSlot !== null && <div className="party-join-summary"><strong>สรุปก่อนเข้าห้อง</strong><span>{room.title} · สล็อต {selectedSlot} · ทีม {team}</span><small>{room.court_name} · {formatSlot(room.starts_at, room.ends_at)}</small></div>}
      {error && <p className="error" role="alert">{error}</p>}
      <button type="button" className="btn btn-block party-confirm-join" disabled={pending || selectedSlot === null} onClick={confirmJoin}>{pending ? "กำลังตรวจสอบสล็อต…" : "▣ บันทึกทีมและดูตารางแข่ง →"}</button>
      {myEntry && !isHost && <button type="button" className="btn btn-ghost btn-block" disabled={pending} onClick={() => confirm("ออกจากห้องนี้?") && run(() => leaveParty(myEntry, room.party_id), () => router.push("/queue?view=join"))}>ออกจากห้อง</button>}
    </>}
    <div id="party-schedule" className="party-schedule-table card"><h2>▣ ตารางการแข่งขัน</h2><div className="party-schedule-table-head"><span>รอบ</span><span>คู่แข่งขัน</span><span>เวลา</span><span>สถานะ</span><span>สนาม</span></div>{matches.map((match) => { const start = Date.parse(match.startsAt); const end = start + 15 * 60_000; const ready = members.filter((m) => m.team === match.teamA).length === 2 && members.filter((m) => m.team === match.teamB).length === 2; const status = !ready ? "รอสมาชิก" : now >= end ? "จบแล้ว" : now >= start ? "กำลังแข่งขัน" : "รอแข่งขัน"; return <div className="party-schedule-table-row" key={match.index}><span>รอบ {match.index}</span><strong>ทีม <b>{match.teamA}</b> <em>vs</em> ทีม <b>{match.teamB}</b></strong><span>{formatTime(match.startsAt)}</span><span className={`match-status ${status === "กำลังแข่งขัน" ? "playing" : ""}`}>{status}</span><span>{room.court_name}</span></div>; })}</div>
    {saved && <div className="party-saved-overlay" role="dialog" aria-modal="true" aria-labelledby="party-saved-title"><div className="party-saved-modal"><div className="party-saved-check">✓</div><h2 id="party-saved-title">บันทึกแล้ว</h2><p>สล็อต {saved.slot} · ทีม {saved.team}</p><span>ข้อมูลการเข้าห้องของคุณเรียบร้อยแล้ว</span><button type="button" className="btn btn-block" onClick={() => setSaved(null)}>ตกลง</button></div></div>}
  </section>;
}
