import Link from "next/link";
import { redirect } from "next/navigation";
import { CoachHoursForm } from "@/components/coach/CoachHoursForm";
import { CoachProfileForm, type CoachProfile } from "@/components/coach/CoachProfileForm";
import { ChevronLeft } from "@/components/icons";
import type { AvailabilitySlot } from "@/lib/coach";
import { formatBaht, formatSlot, STATUS_LABEL } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Lesson = {
  booking_id: string;
  starts_at: string;
  ends_at: string;
  court_name: string;
  status: string;
  lesson_fee: number | null;
  coach_paid_at: string | null;
  student_name: string | null;
  student_phone: string | null;
};

/** The coach's own page: their listing, their weekly hours, and their lessons. */
export default async function MyCoachPage() {
  const { supabase, user, isCoach, displayName } = await getSessionUser();
  if (!user) redirect("/login?next=/coach");

  if (!isCoach) {
    return (
      <div className="stack">
        <div className="page-head">
          <Link href="/me" className="back" aria-label="กลับไปของฉัน">
            <ChevronLeft size={20} />
          </Link>
          <h1 style={{ flex: 1 }}>สำหรับโค้ช</h1>
        </div>
        <section className="card stack">
          <h2>บัญชีนี้ยังไม่ได้เปิดสิทธิ์โค้ช</h2>
          <p className="muted" style={{ margin: 0 }}>
            ถ้าคุณสอนที่สนามนี้ แจ้งร้านให้เปิดสิทธิ์โค้ชให้บัญชีนี้ แล้วหน้านี้จะใช้งานได้
          </p>
          <Link className="btn btn-block" href="/coaches">
            ดูโค้ชที่เปิดสอน
          </Link>
        </section>
      </div>
    );
  }

  const [{ data: profile }, { data: slots }, { data: lessonRows }] = await Promise.all([
    supabase
      .from("coach_profiles")
      .select("display_name, bio, lesson_price_per_hour, is_listed")
      .eq("user_id", user.id)
      .maybeSingle<CoachProfile>(),
    supabase
      .from("coach_availability")
      .select("weekday, start_minute, end_minute")
      .eq("coach_id", user.id)
      .returns<AvailabilitySlot[]>(),
    supabase.rpc("coach_lessons"),
  ]);

  // A set-returning RPC: the generated types do not describe its rows, so name them here.
  const lessons = (lessonRows ?? []) as Lesson[];
  const upcoming = lessons.filter((l) => Date.parse(l.ends_at) > Date.now());
  const unpaidToCoach = lessons.filter(
    (l) => l.status === "confirmed" && !l.coach_paid_at && Date.parse(l.ends_at) <= Date.now(),
  );
  const owed = unpaidToCoach.reduce((sum, l) => sum + Number(l.lesson_fee ?? 0), 0);

  return (
    <div className="stack">
      <div className="page-head">
        <Link href="/me" className="back" aria-label="กลับไปของฉัน">
          <ChevronLeft size={20} />
        </Link>
        <h1 style={{ flex: 1 }}>สำหรับโค้ช</h1>
      </div>

      <CoachProfileForm userId={user.id} profile={profile ?? null} fallbackName={displayName ?? ""} />

      {profile ? (
        <CoachHoursForm userId={user.id} initial={slots ?? []} />
      ) : (
        <p className="muted" style={{ margin: 0 }}>บันทึกข้อมูลโค้ชด้านบนก่อน แล้วจะตั้งตารางสอนได้</p>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <h2>คลาสที่จะสอน ({upcoming.length})</h2>
        {upcoming.length === 0 && <div className="card muted">ยังไม่มีคนจองเรียน</div>}
        {upcoming.map((lesson) => (
          <div key={lesson.booking_id} className="card list-item">
            <div className="meta">
              <strong>{lesson.student_name ?? "ลูกค้า"}</strong>
              <span className="muted">
                {lesson.court_name} · {formatSlot(lesson.starts_at, lesson.ends_at)}
              </span>
              {lesson.student_phone && (
                <a className="muted phone-link" href={`tel:${lesson.student_phone}`}>
                  {lesson.student_phone}
                </a>
              )}
            </div>
            <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
              <span className={`badge ${lesson.status}`}>{STATUS_LABEL[lesson.status]}</span>
              <span className="muted">ค่าสอน {formatBaht(Number(lesson.lesson_fee ?? 0))}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="card stack" style={{ gap: 6 }}>
        <h2>ค่าสอนที่ร้านยังไม่จ่าย</h2>
        <strong style={{ fontSize: 24 }}>{formatBaht(owed)}</strong>
        <span className="muted" style={{ fontSize: 13 }}>
          จาก {unpaidToCoach.length} คลาสที่สอนจบแล้ว ลูกค้าจ่ายค่าเรียนผ่านเว็บพร้อมค่าสนาม
          แล้วร้านจ่ายต่อให้คุณ
        </span>
      </section>
    </div>
  );
}
