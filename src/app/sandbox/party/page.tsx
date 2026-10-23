import { notFound } from "next/navigation";
import { PartyRoomCard, type PartyRoomView } from "@/components/party/PartyRoomCard";
import type { PartyMember } from "@/lib/party";

// A sandbox for looking at the ก๊วน room on a phone-sized screen.
//
// Nothing here reads the database: every row below is made up in this file, so the page
// can be opened while customers are booking. It only exists in `npm run dev` — in a
// production build it is a 404, so nobody can reach it on the live site.
//
// Why it exists: AGENTS.md asks for every UI change to be checked at about 390px in
// light and dark, and a ก๊วน room needs a paid room with players in it before it shows
// anything. Local dev points at the live database, so the only other way to see this
// screen was to open a real room on the shop's project.
//
// The buttons are live. Pressing one calls the real server action with the made-up room
// id below, which the database does not have, so it is refused (FORBIDDEN) and writes
// nothing. Look, do not click.

export const dynamic = "force-static";

const ONE_HOUR = 60 * 60 * 1000;
// Fixed instants, so the screenshots of two runs can be compared.
const START = "2026-11-07T11:00:00.000Z"; // 18:00 Bangkok
const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60_000).toISOString();

const singlesRoom: PartyRoomView = {
  party_id: "00000000-0000-4000-8000-000000000001",
  host_name: "โดม",
  title: "ก๊วนเดี่ยว คืนวันเสาร์",
  mode: "singles",
  capacity: 12,
  court_id: 4,
  court_name: "สนาม 4",
  starts_at: START,
  ends_at: new Date(Date.parse(START) + 2 * ONE_HOUR).toISOString(),
};

const doublesRoom: PartyRoomView = {
  ...singlesRoom,
  party_id: "00000000-0000-4000-8000-000000000002",
  title: "ก๊วนคู่ ศุกร์เย็น",
  mode: "doubles",
  court_id: 2,
  court_name: "สนาม 2",
};

const member = (n: number, name: string, team: PartyMember["team"]): PartyMember => ({
  entry_id: `00000000-0000-4000-8000-0000000100${String(n).padStart(2, "0")}`,
  name,
  slot_no: n,
  team,
});

const singlesMembers: PartyMember[] = [
  member(1, "โดม", "A"),
  member(2, "ส้ม", "A"),
  member(3, "เบนซ์", "B"),
  member(4, "ปอนด์", "B"),
  member(5, "มิกซ์", "C"),
];
const [host, som, benz, pond, mix] = singlesMembers;

// Mid-rotation: โดม has held the court for three rounds and is playing ส้ม again.
const singlesQueue = [
  { entry_id: host.entry_id, name: host.name, queued_at: at(0), state: "playing" as const },
  { entry_id: som.entry_id, name: som.name, queued_at: at(1), state: "playing" as const },
  { entry_id: benz.entry_id, name: benz.name, queued_at: at(32), state: "waiting" as const },
  { entry_id: pond.entry_id, name: pond.name, queued_at: at(48), state: "waiting" as const },
  { entry_id: mix.entry_id, name: mix.name, queued_at: at(50), state: "waiting" as const },
];

const singlesMatch = (round: number, a: PartyMember, b: PartyMember, winner: PartyMember | null) => ({
  id: `00000000-0000-4000-8000-0000000200${round}`,
  round_no: round,
  player_a_entry: a.entry_id,
  player_a_name: a.name,
  player_b_entry: b.entry_id,
  player_b_name: b.name,
  winner_entry: winner?.entry_id ?? null,
  winner_name: winner?.name ?? null,
  status: (winner ? "finished" : "playing") as "finished" | "playing",
  started_at: at((round - 1) * 16),
  ended_at: winner ? at((round - 1) * 16 + 15) : null,
});

const singlesMatchRows = [
  singlesMatch(4, host, som, null),
  singlesMatch(3, host, pond, host),
  singlesMatch(2, host, benz, host),
  singlesMatch(1, host, som, host),
];

const doublesMembers: PartyMember[] = [
  member(1, "โดม", "A"),
  member(2, "ส้ม", "A"),
  member(3, "เบนซ์", "B"),
  member(4, "ปอนด์", "B"),
  member(5, "มิกซ์", "C"),
  member(6, "ตาล", "C"),
];

const teamQueue = [
  { team: "A" as const, ready_at: at(0), queued_at: at(0), state: "playing" as const },
  { team: "B" as const, ready_at: at(1), queued_at: at(1), state: "playing" as const },
  { team: "C" as const, ready_at: at(2), queued_at: at(2), state: "waiting" as const },
];

const matchRows = [
  {
    id: "00000000-0000-4000-8000-000000003002",
    round_no: 2,
    team_a: "A" as const,
    team_b: "B" as const,
    winner: null,
    status: "playing" as const,
    started_at: at(16),
    ended_at: null,
  },
  {
    id: "00000000-0000-4000-8000-000000003001",
    round_no: 1,
    team_a: "A" as const,
    team_b: "C" as const,
    winner: "A" as const,
    status: "finished" as const,
    started_at: at(0),
    ended_at: at(15),
  },
];

export default function PartySandboxPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="app">
      <main className="app-main stack">
        <div className="party-open-note">
          <b>!</b>
          <span>
            <strong>หน้าทดลอง (sandbox)</strong>
            <small>ข้อมูลทั้งหมดในหน้านี้สมมติขึ้น ไม่ได้อ่านฐานข้อมูล และเปิดได้เฉพาะตอน npm run dev</small>
          </span>
        </div>

        <h2 style={{ margin: "4px 0 0" }}>ห้องเดี่ยว · หัวห้อง</h2>
        <PartyRoomCard
          room={singlesRoom}
          members={singlesMembers}
          teamQueue={[]}
          matchRows={[]}
          singlesQueue={singlesQueue}
          singlesMatchRows={singlesMatchRows}
          loggedIn
          defaultName="โดม"
          myEntry={host.entry_id}
          isHost
        />

        <h2 style={{ margin: "18px 0 0" }}>ห้องเดี่ยว · ยังไม่เข้าห้อง</h2>
        <PartyRoomCard
          room={singlesRoom}
          members={singlesMembers}
          teamQueue={[]}
          matchRows={[]}
          singlesQueue={singlesQueue}
          singlesMatchRows={singlesMatchRows}
          loggedIn
          defaultName="ผู้เล่นใหม่"
          myEntry={null}
          isHost={false}
        />

        <h2 style={{ margin: "18px 0 0" }}>ห้องเดี่ยว · ยังไม่มีใครเล่น</h2>
        <PartyRoomCard
          room={singlesRoom}
          members={[host]}
          teamQueue={[]}
          matchRows={[]}
          singlesQueue={[{ entry_id: host.entry_id, name: host.name, queued_at: at(0), state: "waiting" }]}
          singlesMatchRows={[]}
          loggedIn
          defaultName="โดม"
          myEntry={host.entry_id}
          isHost
        />

        <h2 style={{ margin: "18px 0 0" }}>ห้องคู่ · หัวห้อง (ของเดิม ไว้เทียบ)</h2>
        <PartyRoomCard
          room={doublesRoom}
          members={doublesMembers}
          teamQueue={teamQueue}
          matchRows={matchRows}
          singlesQueue={[]}
          singlesMatchRows={[]}
          loggedIn
          defaultName="โดม"
          myEntry={doublesMembers[0].entry_id}
          isHost
        />
      </main>
    </div>
  );
}
