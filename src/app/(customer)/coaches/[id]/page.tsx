import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "@/components/icons";
import { BookLessonButton } from "@/components/coach/BookLessonButton";
import { ShopContactCard } from "@/components/ShopContactCard";
import {
  LESSON_HOUR_OPTIONS,
  lessonTotal,
  summariseAvailability,
  toStartTimes,
  type AvailabilitySlot,
} from "@/lib/coach";
import { formatBaht, formatDayParts, formatTime } from "@/lib/format";
import { getPublicCourts } from "@/lib/public-data";
import { bangkokDate, upcomingDates } from "@/lib/slots";
import { createClient, getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CoachRow = {
  user_id: string;
  display_name: string;
  bio: string | null;
  lesson_price_per_hour: number;
  is_listed: boolean;
};

export default async function CoachPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ day?: string; hours?: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { day: dayParam, hours: hoursParam } = await searchParams;

  const days = upcomingDates(new Date(), 14);
  const day = dayParam && days.includes(dayParam) ? dayParam : days[0];
  const askedHours = Number(hoursParam);
  const hours = (LESSON_HOUR_OPTIONS as readonly number[]).includes(askedHours) ? askedHours : 1;

  const supabase = await createClient();
  const [{ user }, courts, { data: coach }, { data: slots }, { data: starts, error: startsError }] = await Promise.all([
    getSessionUser(),
    getPublicCourts(),
    supabase
      .from("coach_profiles")
      .select("user_id, display_name, bio, lesson_price_per_hour, is_listed")
      .eq("user_id", id)
      .maybeSingle<CoachRow>(),
    supabase
      .from("coach_availability")
      .select("weekday, start_minute, end_minute")
      .eq("coach_id", id)
      .returns<AvailabilitySlot[]>(),
    supabase.rpc("coach_open_starts", { p_coach_id: id, p_day: day, p_hours: hours }),
  ]);

  if (!coach) notFound();
  if (startsError) console.error("Failed to load the coach's open times:", startsError);

  const courtPrice = courts?.[0]?.price_per_hour ?? 0;
  const total = lessonTotal(courtPrice, coach.lesson_price_per_hour, hours);
  const openStarts = toStartTimes(starts);
  const hoursLabel = (h: number) => (Number.isInteger(h) ? `${h} ชม.` : `${h} ชม.`);

  return (
    <div className="stack">
      <div className="page-head">
        <Link href="/coaches" className="back" aria-label="กลับไปรายชื่อโค้ช">
          <ChevronLeft size={20} />
        </Link>
        <h1 style={{ flex: 1 }}>{coach.display_name}</h1>
      </div>

      <section className="card stack" style={{ gap: 8 }}>
        {coach.bio && <p style={{ margin: 0 }}>{coach.bio}</p>}
        <div className="row">
          <span className="muted">ค่าเรียน</span>
          <strong>{formatBaht(coach.lesson_price_per_hour)} / ชม.</strong>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {summariseAvailability(slots ?? []) || "ยังไม่ได้ลงตารางสอน"}
        </span>
        {!coach.is_listed && <p className="error" style={{ margin: 0 }}>โค้ชคนนี้ปิดรับสอนชั่วคราว</p>}
      </section>

      {coach.is_listed && (
        <>
          <section className="stack" style={{ gap: 8 }}>
            <span className="queue-section-label">เรียนกี่ชั่วโมง</span>
            <div className="segmented-control">
              {LESSON_HOUR_OPTIONS.map((h) => (
                <Link
                  key={h}
                  href={`/coaches/${id}?day=${day}&hours=${h}`}
                  className={`seg-btn ${h === hours ? "active" : ""}`}
                  aria-current={h === hours ? "page" : undefined}
                  scroll={false}
                >
                  {hoursLabel(h)}
                </Link>
              ))}
            </div>
          </section>

          <section className="stack" style={{ gap: 8 }}>
            <span className="queue-section-label">วันที่</span>
            <div className="date-scroll">
              {days.map((d) => {
                const parts = formatDayParts(d);
                return (
                  <Link
                    key={d}
                    href={`/coaches/${id}?day=${d}&hours=${hours}`}
                    className={`date-pill ${d === day ? "active" : ""}`}
                    aria-current={d === day ? "page" : undefined}
                    scroll={false}
                  >
                    <span>{d === bangkokDate(new Date()) ? "วันนี้" : parts.weekday}</span>
                    <strong>{parts.date}</strong>
                    <span>{parts.month}</span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section className="card stack" style={{ gap: 10 }}>
            <div className="row">
              <span className="queue-section-label">เวลาที่ว่าง</span>
              <span className="muted" style={{ fontSize: 13 }}>
                รวมค่าสนาม {formatBaht(total)}
              </span>
            </div>

            {openStarts.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                วันนี้ไม่มีเวลาว่างตามที่เลือก ลองเปลี่ยนวันหรือลดจำนวนชั่วโมง
              </p>
            ) : !user ? (
              <>
                <div className="chip-grid">
                  {openStarts.map((s) => (
                    <span key={s} className="chip" aria-disabled="true">
                      {formatTime(s)}
                    </span>
                  ))}
                </div>
                <Link className="btn btn-block" href={`/login?next=/coaches/${id}`}>
                  เข้าสู่ระบบเพื่อจองเรียน
                </Link>
              </>
            ) : (
              <div className="chip-grid">
                {openStarts.map((s) => (
                  <BookLessonButton key={s} coachId={id} startsAt={s} hours={hours} label={formatTime(s)} />
                ))}
              </div>
            )}

            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              กดเวลาที่ต้องการแล้วระบบจะกันสนามให้ 5 นาที เพื่อให้ชำระเงิน ค่าเรียนรวมอยู่ในบิลแล้ว
            </p>
          </section>
        </>
      )}
      <ShopContactCard title="อยากสอบถามก่อนจอง?" />
    </div>
  );
}
