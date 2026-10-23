import Link from "next/link";
import { LeaderboardVisibility } from "./LeaderboardVisibility";

/** What my_player_card() (migration 0030) says about the signed-in player. */
export type PlayerCard = {
  player_key: string;
  rating: number;
  played: number;
  wins: number;
  losses: number;
  best_streak: number;
  place: number | null;
  listed: boolean;
  total_players: number;
};

/** A player's own numbers, on /me. Shared with /sandbox/leaderboard so the layout can be
 *  checked at phone width without a real account behind it. */
export function PlayerStatsCard({ card }: { card: PlayerCard }) {
  if (card.played === 0) {
    return (
      <div className="card stack">
        <p className="muted" style={{ margin: 0 }}>
          ยังไม่มีสถิติ เข้าห้องก๊วนแล้วเล่นให้จบสักเกม แล้วแต้มจะเริ่มนับ
        </p>
        <Link className="btn btn-block" href="/queue">
          ดูห้องก๊วน
        </Link>
      </div>
    );
  }

  return (
    <div className="card stack player-card">
      <div className="player-card-top">
        <div>
          <span>แต้มสะสม</span>
          <strong>{card.rating}</strong>
        </div>
        {card.place !== null && (
          <div>
            <span>อันดับของร้าน</span>
            <strong>
              #{card.place} <small>/ {card.total_players}</small>
            </strong>
          </div>
        )}
      </div>
      <div className="player-card-stats">
        <div>
          <span>ลงเล่น</span>
          <strong>{card.played}</strong>
        </div>
        <div>
          <span>ชนะ</span>
          <strong>{card.wins}</strong>
        </div>
        <div>
          <span>แพ้</span>
          <strong>{card.losses}</strong>
        </div>
        <div>
          <span>ชนะติดสูงสุด</span>
          <strong>{card.best_streak}</strong>
        </div>
      </div>
      <LeaderboardVisibility listed={card.listed} />
      <Link href="/leaderboard" className="btn btn-block btn-ghost" style={{ textAlign: "center" }}>
        🏆 ดูอันดับผู้เล่นทั้งร้าน
      </Link>
    </div>
  );
}
