import { notFound } from "next/navigation";
import { LeaderboardTable, type LadderRow } from "@/components/party/LeaderboardTable";
import { PlayerStatsCard, type PlayerCard } from "@/components/party/PlayerStatsCard";

// A sandbox for the shop's ladder and a player's own numbers, at phone width.
//
// Both real pages need a signed-in account with a played game behind it, and local dev
// points at the live database, so this one makes the rows up instead: it reads nothing,
// and it is a 404 in a production build. Same components as /leaderboard and /me, so what
// is on screen here is what those pages draw.
//
// The "ขอไม่แสดงชื่อ" button is live and would write to the real profiles row, so do not
// press it here. Look only.

export const dynamic = "force-static";

const player = (
  rank: number,
  name: string,
  rating: number,
  played: number,
  wins: number,
  best_streak: number,
): LadderRow => ({
  player_key: `00000000-0000-4000-8000-00000000${String(rank).padStart(4, "0")}`,
  name,
  avatar_url: null,
  rating,
  played,
  wins,
  best_streak,
});

const ladder: LadderRow[] = [
  player(1, "เอ", 1186, 64, 44, 7),
  player(2, "ดี", 1122, 58, 36, 5),
  player(3, "ซี", 1094, 41, 24, 4),
  player(4, "โดม", 1047, 37, 21, 3),
  player(5, "บี", 1011, 52, 26, 3),
  player(6, "ส้มโอชื่อยาวมากจนต้องตัด", 998, 29, 13, 2),
  player(7, "อี", 962, 33, 12, 2),
  player(8, "เอฟ", 940, 18, 6, 1),
];

const me: PlayerCard = {
  player_key: ladder[3].player_key,
  rating: 1047,
  played: 37,
  wins: 21,
  losses: 16,
  best_streak: 3,
  place: 4,
  listed: true,
  total_players: 8,
};

export default function LeaderboardSandboxPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="app">
      <main className="app-main stack">
        <div className="party-open-note">
          <b>!</b>
          <span>
            <strong>หน้าทดลอง (sandbox)</strong>
            <small>ข้อมูลสมมติทั้งหมด ไม่ได้อ่านฐานข้อมูล และเปิดได้เฉพาะตอน npm run dev</small>
          </span>
        </div>

        <h2 style={{ margin: "4px 0 0" }}>สถิติของฉัน (หน้า /me)</h2>
        <PlayerStatsCard card={me} />

        <h2 style={{ margin: "18px 0 0" }}>ยังไม่เคยเล่น</h2>
        <PlayerStatsCard card={{ ...me, played: 0, wins: 0, losses: 0, best_streak: 0, place: null }} />

        <h2 style={{ margin: "18px 0 0" }}>ไม่ขึ้นตารางอันดับ</h2>
        <PlayerStatsCard card={{ ...me, listed: false, place: null }} />

        <h2 style={{ margin: "18px 0 0" }}>ตารางอันดับของร้าน (หน้า /leaderboard)</h2>
        <div className="leaderboard-me">
          <span>อันดับของคุณ</span>
          <strong>
            #{me.place} <small>จาก {me.total_players} คน</small>
          </strong>
          <b>{me.rating} แต้ม</b>
        </div>
        <LeaderboardTable rows={ladder} myKey={me.player_key} />

        <h2 style={{ margin: "18px 0 0" }}>ยังไม่มีใครเล่น</h2>
        <LeaderboardTable rows={[]} />
      </main>
    </div>
  );
}
