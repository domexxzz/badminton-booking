/** One row of the shop's ladder (player_ranking_board, migration 0030). */
export type LadderRow = {
  player_key: string;
  name: string;
  avatar_url: string | null;
  rating: number;
  played: number;
  wins: number;
  best_streak: number;
};

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * The table itself, with no idea where the rows came from. /leaderboard reads them from
 * the database; /sandbox/leaderboard makes them up, so the layout can be checked at phone
 * width without a real ก๊วน night behind it.
 */
export function LeaderboardTable({ rows, myKey }: { rows: LadderRow[]; myKey?: string | null }) {
  if (rows.length === 0) {
    return <p className="muted">ยังไม่มีใครเล่นจบสักเกม ตารางจะขึ้นเองหลังคืนก๊วนแรก</p>;
  }

  return (
    <div className="card leaderboard-table">
      <div className="leaderboard-row leaderboard-head">
        <span>#</span>
        <span>ผู้เล่น</span>
        <span>ลง</span>
        <span>ชนะ</span>
        <span>แต้ม</span>
      </div>
      {rows.map((row, index) => (
        <div key={row.player_key} className={`leaderboard-row ${row.player_key === myKey ? "me" : ""}`}>
          <span className="leaderboard-rank">{MEDALS[index] ?? index + 1}</span>
          <span className="leaderboard-player">
            {row.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.avatar_url} alt="" className="leaderboard-avatar" />
            ) : (
              <span className="leaderboard-initial">{(row.name || "ผ").trim().charAt(0)}</span>
            )}
            <span className="leaderboard-name">{row.name}</span>
            {row.player_key === myKey && <i>คุณ</i>}
            {row.best_streak > 2 && <b title={`เคยชนะติดกัน ${row.best_streak} เกม`}>🔥{row.best_streak}</b>}
          </span>
          <span>{row.played}</span>
          <span>{row.wins}</span>
          <span className="leaderboard-rating">{row.rating}</span>
        </div>
      ))}
    </div>
  );
}
