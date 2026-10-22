import { AdminQueueCourt } from "@/components/admin/AdminQueueCourt";
import { LiveRefresh } from "@/components/LiveRefresh";
import { loadCourtQueues } from "@/lib/queue-data";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminQueuePage() {
  const { supabase } = await getSessionUser();
  const { data: courts, error } = await supabase
    .from("courts")
    .select("id, name")
    .eq("is_active", true)
    .order("id")
    .returns<{ id: number; name: string }[]>();
  const views = courts && !error ? await loadCourtQueues(supabase, courts) : null;
  if (!views) return <p className="error">โหลดคิวก๊วนไม่สำเร็จ กรุณารีเฟรช</p>;

  return (
    <section className="stack" style={{ gap: 12 }}>
      <LiveRefresh table="queue_board" />
      <LiveRefresh table="court_queues" />
      <div className="stack" style={{ gap: 4 }}>
        <h2>คิวก๊วน</h2>
        <p className="muted" style={{ margin: 0 }}>
          เปิดคิวสนามที่เล่นก๊วน ลูกค้าต่อคิวเองได้ที่หน้า “คิวก๊วน” กด “เกมถัดไป” เมื่อเกมจบ
          ระบบจะให้คนบนสนามออก แล้วเรียกคนถัดไปลงตามลำดับ
        </p>
      </div>
      {views.map((view) => (
        <AdminQueueCourt key={view.courtId} view={view} />
      ))}
    </section>
  );
}
