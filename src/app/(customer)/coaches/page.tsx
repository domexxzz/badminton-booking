import Link from "next/link";
import { ChevronRight } from "@/components/icons";
import { ShopContactCard } from "@/components/ShopContactCard";
import { summariseAvailability, type AvailabilitySlot } from "@/lib/coach";
import { formatBaht } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CoachRow = { user_id: string; display_name: string; bio: string | null; lesson_price_per_hour: number };

export default async function CoachesPage() {
  const supabase = await createClient();
  const [{ data: coaches, error }, { data: hours }] = await Promise.all([
    supabase
      .from("coach_profiles")
      .select("user_id, display_name, bio, lesson_price_per_hour")
      .eq("is_listed", true)
      .order("display_name")
      .returns<CoachRow[]>(),
    supabase
      .from("coach_availability")
      .select("coach_id, weekday, start_minute, end_minute")
      .returns<(AvailabilitySlot & { coach_id: string })[]>(),
  ]);

  if (error) {
    console.error("Failed to load coaches:", error);
    return <p className="error">โหลดรายชื่อโค้ชไม่สำเร็จ กรุณารีเฟรช</p>;
  }

  return (
    <div className="stack">
      <div className="page-head">
        <h1 style={{ flex: 1 }}>เรียนกับโค้ช</h1>
      </div>

      {coaches.length === 0 ? (
        <section className="card stack">
          <h2>ยังไม่มีโค้ชเปิดรับสอน</h2>
          <p className="muted" style={{ margin: 0 }}>
            ตอนนี้ยังไม่มีโค้ชเปิดตารางสอนในระบบ สอบถามร้านได้เลยว่ามีคลาสช่วงไหน
          </p>
        </section>
      ) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            ค่าเรียนรวมกับค่าสนามในบิลเดียว จ่ายผ่านเว็บเหมือนจองสนามปกติ
          </p>
          <div className="list">
            {coaches.map((coach) => {
              const slots = (hours ?? []).filter((h) => h.coach_id === coach.user_id);
              const summary = summariseAvailability(slots);
              return (
                <Link key={coach.user_id} href={`/coaches/${coach.user_id}`} className="card coach-card">
                  <div className="coach-card-main">
                    <strong className="coach-card-name">{coach.display_name}</strong>
                    {coach.bio && <span className="muted coach-card-bio">{coach.bio}</span>}
                    <span className="muted coach-card-hours">
                      {summary === "" ? "ยังไม่ได้ลงตารางสอน" : `สอน: ${summary}`}
                    </span>
                  </div>
                  <div className="coach-card-price">
                    <strong>{formatBaht(coach.lesson_price_per_hour)}</strong>
                    <span className="muted">/ชม.</span>
                    <ChevronRight size={18} />
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
      <ShopContactCard title="อยากสอบถามเรื่องคลาสเรียน?" />
    </div>
  );
}
