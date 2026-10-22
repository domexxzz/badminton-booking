import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { CourtQueueBoard } from "@/components/queue/CourtQueueBoard";
import { JoinQueueForm } from "@/components/queue/JoinQueueForm";
import { LeaveQueueButton } from "@/components/queue/LeaveQueueButton";
import { getPublicCourts } from "@/lib/public-data";
import { gamesAhead, waitingPosition } from "@/lib/queue";
import { loadCourtQueues } from "@/lib/queue-data";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MyEntry = { id: string; court_id: number; status: "waiting" | "playing" };

export default async function QueuePage() {
  const { supabase, user, displayName } = await getSessionUser();
  const courts = await getPublicCourts();
  const [views, mine] = await Promise.all([
    courts ? loadCourtQueues(supabase, courts) : Promise.resolve(null),
    user
      ? supabase
          .from("queue_entries")
          .select("id, court_id, status")
          .eq("user_id", user.id)
          .in("status", ["waiting", "playing"])
          .maybeSingle<MyEntry>()
      : Promise.resolve({ data: null }),
  ]);

  if (!views) return <p className="error">โหลดคิวก๊วนไม่สำเร็จ กรุณารีเฟรช</p>;

  const open = views.filter((v) => v.isOpen);
  const myEntry = mine.data;
  const myView = myEntry ? views.find((v) => v.courtId === myEntry.court_id) : undefined;
  const myPlace = myEntry && myView ? waitingPosition(myView, myEntry.id) : null;

  return (
    <div className="stack">
      <LiveRefresh table="queue_board" />
      <LiveRefresh table="court_queues" />
      <div className="page-head">
        <h1 style={{ flex: 1 }}>คิวก๊วน</h1>
        <span className="live">
          <span className="live-dot on" aria-hidden="true" /> อัปเดตสด
        </span>
      </div>

      {myEntry && myView && (
        <section className="card queue-me-card" aria-live="polite">
          {myEntry.status === "playing" ? (
            <>
              <span className="queue-section-label">ถึงตาคุณแล้ว</span>
              <strong className="queue-me-title">ลงเล่นที่ {myView.courtName} ได้เลย 🏸</strong>
            </>
          ) : (
            <>
              <span className="queue-section-label">คิวของคุณ · {myView.courtName}</span>
              <div className="queue-me-row">
                <span className="queue-me-pos">{myPlace ?? "-"}</span>
                <span className="muted">
                  {myPlace === null
                    ? "กำลังอัปเดตลำดับ"
                    : gamesAhead(myPlace, myView.playersPerGame) === 0
                      ? "ได้ลงเกมถัดไป เตรียมตัวได้เลย"
                      : `รออีก ${gamesAhead(myPlace, myView.playersPerGame)} เกม`}
                </span>
              </div>
            </>
          )}
          <LeaveQueueButton entryId={myEntry.id} playing={myEntry.status === "playing"} />
        </section>
      )}

      {open.length === 0 ? (
        <section className="card stack">
          <h2>ตอนนี้ยังไม่มีสนามเปิดคิวก๊วน</h2>
          <p className="muted" style={{ margin: 0 }}>
            เมื่อร้านเปิดคิว หน้านี้จะขึ้นเองโดยไม่ต้องรีเฟรช ระหว่างนี้จองสนามแบบเหมาได้ตามปกติ
          </p>
          <Link className="btn btn-block" href="/book">
            จองสนาม
          </Link>
        </section>
      ) : (
        <>
          {!user && (
            <section className="card stack">
              <p style={{ margin: 0 }}>เข้าสู่ระบบเพื่อต่อคิวจากมือถือ ไม่ต้องจดชื่อที่สนาม</p>
              <Link className="btn btn-block" href="/login?next=/queue">
                เข้าสู่ระบบเพื่อต่อคิว
              </Link>
            </section>
          )}
          {user && !myEntry && (
            <JoinQueueForm
              courts={open.map((v) => ({ id: v.courtId, name: v.courtName, waiting: v.waiting.length }))}
              defaultName={displayName ?? ""}
            />
          )}
          {open.map((view) => (
            <CourtQueueBoard key={view.courtId} view={view} myEntryId={myEntry?.id ?? null} />
          ))}
        </>
      )}
    </div>
  );
}
