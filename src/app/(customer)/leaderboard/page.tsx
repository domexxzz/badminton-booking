import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { LeaderboardTable, type LadderRow } from "@/components/party/LeaderboardTable";
import type { PlayerCard } from "@/components/party/PlayerStatsCard";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LeaderboardPage() {
  const { supabase, user } = await getSessionUser();
  // The ladder is readable by signed-in players only (RLS, migration 0030), so an
  // anonymous visitor would just see an empty table. Send them to sign in instead.
  if (!user) redirect("/login?next=/leaderboard");

  const [{ data: rows, error }, { data: cardRows }] = await Promise.all([
    supabase
      .from("player_ranking_board")
      .select("player_key, name, avatar_url, rating, played, wins, best_streak")
      .order("rating", { ascending: false })
      .order("played", { ascending: false })
      .limit(100)
      .returns<LadderRow[]>(),
    supabase.rpc("my_player_card"),
  ]);

  if (error) {
    console.error("Failed to load the leaderboard:", error);
    return <p className="error">โหลดตารางอันดับไม่สำเร็จ</p>;
  }

  const board = rows ?? [];
  const card = (cardRows as PlayerCard[] | null)?.[0] ?? null;
  const myKey = card?.player_key ?? null;
  const myIndex = myKey ? board.findIndex((r) => r.player_key === myKey) : -1;

  return (
    <>
      <LiveRefresh table="player_ranking_board" />
      <section className="stack">
        <header className="card leaderboard-intro">
          <div className="party-list-icon">🏆</div>
          <div>
            <h1>อันดับผู้เล่นของร้าน</h1>
            <span>แต้มสะสมจากทุกคืนก๊วน ไม่รีเซ็ต</span>
          </div>
        </header>

        {card && card.played === 0 && (
          <div className="party-open-note">
            <b>!</b>
            <span>
              <strong>คุณยังไม่มีแต้ม</strong>
              <small>เข้าห้องก๊วนแล้วเล่นให้จบสักเกม แล้วชื่อจะขึ้นตารางนี้เอง</small>
            </span>
          </div>
        )}

        {card && card.played > 0 && card.place !== null && (
          <div className="leaderboard-me">
            <span>อันดับของคุณ</span>
            <strong>
              #{card.place} <small>จาก {card.total_players} คน</small>
            </strong>
            <b>{card.rating} แต้ม</b>
          </div>
        )}

        <LeaderboardTable rows={board} myKey={myKey} />

        {card && card.played > 0 && myIndex === -1 && card.listed === false && (
          <p className="muted">
            คุณเลือกไม่แสดงชื่อบนตารางนี้ เปลี่ยนได้ที่หน้า <Link href="/me">ของฉัน</Link>
          </p>
        )}

        <div className="card leaderboard-rules">
          <h2>แต้มคิดยังไง</h2>
          <ul>
            <li>ทุกคนเริ่มที่ <b>1000 แต้ม</b></li>
            <li>ชนะคนที่แต้มสูงกว่าได้เยอะ ชนะคนที่แต้มต่ำกว่าได้น้อย</li>
            <li>แต้มที่ผู้ชนะได้ เท่ากับที่ผู้แพ้เสียพอดี ไม่มีแต้มงอกขึ้นมาเอง</li>
            <li>ห้องคู่คิดให้ทุกคนในทีม ทีมชนะได้แต้มกันทั้งสองคน</li>
          </ul>
          <Link href="/queue" className="btn btn-block">
            ดูห้องก๊วนที่เปิดอยู่
          </Link>
        </div>
      </section>
    </>
  );
}
