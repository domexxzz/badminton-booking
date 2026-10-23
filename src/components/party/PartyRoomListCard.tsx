import Link from "next/link";
import { formatSlot } from "@/lib/format";
import type { PartyMode } from "@/lib/party";

export type PartyRoomListView = { party_id: string; host_name: string; title: string; mode: PartyMode; capacity: number; court_name: string; starts_at: string; ends_at: string };

export function PartyRoomListCard({ room, memberCount, isMine }: { room: PartyRoomListView; memberCount: number; isMine: boolean }) {
  return <article className="card party-list-card">
    <div className="party-list-icon" aria-hidden="true">🏸</div>
    <div className="party-list-copy"><div><h3>{room.title}</h3><span className="party-count">♟ {memberCount}/{room.capacity}</span></div><span>โดย {room.host_name}</span><small>{room.court_name} · {formatSlot(room.starts_at, room.ends_at)}</small><em>{room.mode === "singles" ? "เดี่ยว · 1 ต่อ 1" : "คู่ · 2 ต่อ 2"}</em></div>
    <Link className="btn btn-sm" href={`/queue/${room.party_id}`}>{isMine ? "ห้องของฉัน" : "เข้าห้อง"} ›</Link>
  </article>;
}
