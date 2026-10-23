"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { joinParty, kickPartyMember, leaveParty, movePartySlot } from "@/app/party-actions";
import { formatSlot, formatTime } from "@/lib/format";
import { buildPartyMatches, PARTY_CAPACITY, PARTY_NAME_MAX, type PartyMember, type PartyMode } from "@/lib/party";

export type PartyRoomView = { party_id: string; host_name: string; title: string; mode: PartyMode; capacity: number; court_id: number; court_name: string; starts_at: string; ends_at: string };

export function PartyRoomCard({ room, members, loggedIn, defaultName, myEntry, isHost }: {
  room: PartyRoomView; members: PartyMember[]; loggedIn: boolean; defaultName: string; myEntry: string | null; isHost: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const matches = buildPartyMatches(room.mode, members, room.starts_at, room.ends_at);
  const occupied = new Map(members.map((m) => [m.slot_no, m]));
  function run(action: () => Promise<{ ok: boolean; error?: string }>) { setError(null); startTransition(async () => { const result = await action(); if (!result.ok) setError(result.error ?? "เกิดข้อผิดพลาด"); else router.refresh(); }); }
  function choose(slot: number) { if (!loggedIn) return; if (myEntry) run(() => movePartySlot(myEntry, room.party_id, slot)); else if (name.trim()) run(() => joinParty(room.party_id, name, slot)); else setError("กรุณาใส่ชื่อก่อนเลือกช่อง"); }
  const slotButton = (slot: number) => {
    const member = occupied.get(slot);
    return <div key={slot} className={`party-slot ${member ? "occupied" : ""} ${member?.entry_id === myEntry ? "is-me" : ""}`}><span className="party-slot-no">{slot}</span>
      {member ? <><strong>{member.name}</strong>{member.entry_id === myEntry && <span className="badge confirmed">คุณ</span>}{isHost && member.entry_id !== myEntry && <button type="button" className="party-kick" disabled={pending} onClick={() => confirm(`นำ ${member.name} ออกจากห้อง?`) && run(() => kickPartyMember(room.party_id, member.entry_id))}>นำออก</button>}</>
        : <button type="button" disabled={pending || !loggedIn} onClick={() => choose(slot)}>เลือกช่องนี้</button>}</div>;
  };
  return <section id={`party-${room.party_id}`} className="card stack party-room">
    <div className="party-room-head"><div><span className="queue-section-label">{room.mode === "singles" ? "เดี่ยว · 1 ต่อ 1" : "คู่ · 2 ต่อ 2"}</span><h2>{room.title}</h2></div><span className="party-count">{members.length}/{room.capacity}</span></div>
    <div className="party-room-meta"><strong>{room.court_name}</strong><span>{formatSlot(room.starts_at, room.ends_at)}</span><span>หัวห้อง: {room.host_name}</span></div>
    <p className="party-note">สมาชิกเข้าร่วมฟรี ค่าใช้จ่ายระหว่างสมาชิกให้ตกลงกับหัวห้องโดยตรง</p>
    {!loggedIn && <Link href={`/login?next=/queue%23party-${room.party_id}`} className="btn btn-block">เข้าสู่ระบบเพื่อเลือกทีม</Link>}
    {loggedIn && !myEntry && <label className="field"><span>ชื่อของคุณในห้อง</span><input value={name} maxLength={PARTY_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="กรอกชื่อแล้วเลือกช่องว่าง" /></label>}
    <div className={`party-slots mode-${room.mode}`}>{room.mode === "doubles" ? Array.from({ length: PARTY_CAPACITY / 2 }, (_, team) => <div key={team} className="party-team"><span>ทีม {team + 1}</span><div>{slotButton(team * 2 + 1)}{slotButton(team * 2 + 2)}</div></div>) : Array.from({ length: PARTY_CAPACITY }, (_, i) => slotButton(i + 1))}</div>
    {myEntry && !isHost && <button type="button" className="btn btn-ghost btn-block" disabled={pending} onClick={() => confirm("ออกจากห้องนี้?") && run(() => leaveParty(myEntry, room.party_id))}>ออกจากห้อง</button>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="party-schedule"><h3>ตารางการแข่งขัน · เกมละ 15 นาที</h3>{matches.length === 0 ? <p className="muted">รอสมาชิกให้ครบอย่างน้อย {room.mode === "singles" ? "2 คน" : "2 ทีม"} แล้วระบบจะจัดคู่แข่งขันให้อัตโนมัติ</p> : <ol>{matches.map((match) => <li key={match.index}><span>{formatTime(match.startsAt)}</span><strong>{match.sideA.join(" + ")} <em>พบ</em> {match.sideB.join(" + ")}</strong></li>)}</ol>}</div>
  </section>;
}
