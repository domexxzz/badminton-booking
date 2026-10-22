import Link from "next/link";
import { MarkCoachPaidButton } from "@/components/admin/MarkCoachPaidButton";
import { summariseAvailability, type AvailabilitySlot } from "@/lib/coach";
import { formatBaht, formatSlot } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CoachRow = {
  user_id: string;
  display_name: string;
  lesson_price_per_hour: number;
  is_listed: boolean;
};

type LessonRow = {
  id: string;
  coach_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  lesson_fee: number | null;
  coach_paid_at: string | null;
  customer_name: string | null;
};

type UnpaidRow = { booking_id: string; starts_at: string; ends_at: string; lesson_fee: number | null };

/** Back office: who coaches, and what the shop still owes each of them. */
export default async function AdminCoachesPage() {
  const { supabase } = await getSessionUser();
  const [{ data: coaches, error }, { data: lessons }, { data: slots }] = await Promise.all([
    supabase
      .from("coach_profiles")
      .select("user_id, display_name, lesson_price_per_hour, is_listed")
      .order("display_name")
      .returns<CoachRow[]>(),
    supabase
      .from("bookings")
      .select("id, coach_id, starts_at, ends_at, status, lesson_fee, coach_paid_at, customer_name")
      .not("coach_id", "is", null)
      .eq("status", "confirmed")
      .gt("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(200)
      .returns<LessonRow[]>(),
    supabase
      .from("coach_availability")
      .select("coach_id, weekday, start_minute, end_minute")
      .returns<(AvailabilitySlot & { coach_id: string })[]>(),
  ]);

  if (error) {
    console.error("Failed to load coaches:", error);
    return <p className="error">โหลดข้อมูลโค้ชไม่สำเร็จ</p>;
  }

  const upcoming = lessons ?? [];
  // What is owed is read per coach, not sliced off a capped list, so the button pays for
  // exactly the lessons shown here.
  const unpaidByCoach = new Map<string, UnpaidRow[]>();
  await Promise.all(
    coaches.map(async (coach) => {
      const { data } = await supabase.rpc("coach_unpaid_lessons", { p_coach_id: coach.user_id });
      unpaidByCoach.set(coach.user_id, (data ?? []) as UnpaidRow[]);
    }),
  );

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="stack" style={{ gap: 4 }}>
        <h2>โค้ชและค่าสอน</h2>
        <p className="muted" style={{ margin: 0 }}>
          ลูกค้าจ่ายค่าเรียนพร้อมค่าสนามในบิลเดียว ร้านรับเงินทั้งก้อน แล้วจ่ายค่าสอนต่อให้โค้ช
          กด “จ่ายแล้ว” เมื่อจ่ายให้โค้ชเรียบร้อย เปิดสิทธิ์โค้ชให้บัญชีได้ที่หน้า{" "}
          <Link href="/admin/team">แอดมิน</Link>
        </p>
      </div>

      {coaches.length === 0 && <div className="card muted">ยังไม่มีโค้ชที่บันทึกข้อมูลไว้</div>}

      {coaches.map((coach) => {
        const owedLessons = unpaidByCoach.get(coach.user_id) ?? [];
        const owed = owedLessons.reduce((sum, l) => sum + Number(l.lesson_fee ?? 0), 0);
        const hours = summariseAvailability((slots ?? []).filter((s) => s.coach_id === coach.user_id));
        return (
          <div key={coach.user_id} className="card list-item">
            <div className="meta">
              <strong>
                {coach.display_name}{" "}
                {coach.is_listed ? (
                  <span className="badge confirmed">เปิดรับสอน</span>
                ) : (
                  <span className="badge">ปิดรับสอน</span>
                )}
              </strong>
              <span className="muted">ค่าสอน {formatBaht(coach.lesson_price_per_hour)}/ชม.</span>
              <span className="muted" style={{ fontSize: 13 }}>{hours || "ยังไม่ได้ลงตารางสอน"}</span>
              <span className="muted" style={{ fontSize: 13 }}>
                ค้างจ่ายค่าสอน {formatBaht(owed)} ({owedLessons.length} คลาสที่สอนจบแล้ว)
              </span>
            </div>
            <MarkCoachPaidButton
              coachId={coach.user_id}
              coachName={coach.display_name}
              owed={owed}
              bookingIds={owedLessons.map((l) => l.booking_id)}
            />
          </div>
        );
      })}

      <h3>คลาสที่จะสอน ({upcoming.length})</h3>
      {upcoming.length === 0 && <div className="card muted">ยังไม่มีคลาสที่ยืนยันแล้วในอนาคต</div>}
      {upcoming.map((lesson) => {
        const coach = coaches.find((c) => c.user_id === lesson.coach_id);
        return (
          <Link key={lesson.id} href={`/bookings/${lesson.id}`} className="card list-item">
            <div className="meta">
              <strong>{coach?.display_name ?? "โค้ช"}</strong>
              <span className="muted">{formatSlot(lesson.starts_at, lesson.ends_at)}</span>
            </div>
            <span className="muted">ค่าสอน {formatBaht(Number(lesson.lesson_fee ?? 0))}</span>
          </Link>
        );
      })}
    </section>
  );
}
