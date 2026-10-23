import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { AnalyticsBookingTable, type BookingRowItem } from "@/components/admin/AnalyticsBookingTable";
import { AnalyticsCharts, type ChannelStat, type CourtStat, type TimeDataPoint } from "@/components/admin/AnalyticsCharts";
import { AnalyticsKpiCards } from "@/components/admin/AnalyticsKpiCards";
import { AnalyticsPeriodPicker } from "@/components/admin/AnalyticsPeriodPicker";
import { countBookings } from "@/lib/admin/summary";
import { BOOKING_RULES } from "@/lib/config";
import { formatTime } from "@/lib/format";
import { bangkokDate, formatHour, slotStart } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type BookingRow = {
  id: string;
  court_id: number;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
  channel: string;
  customer_name: string | null;
  customer_phone: string | null;
  admin_note: string | null;
  user_id: string;
  created_at: string;
  courts: { name: string } | null;
};

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

const THAI_MONTHS_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
];

const CHANNEL_CONFIG: Record<string, { label: string; color: string }> = {
  online: { label: "ออนไลน์", color: "#10b981" },
  phone: { label: "โทรศัพท์", color: "#3b82f6" },
  line: { label: "LINE", color: "#06c755" },
  walk_in: { label: "หน้าร้าน", color: "#f59e0b" },
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    date?: string;
    month?: string;
    year?: string;
  }>;
}) {
  const { supabase, user, isAdmin } = await getSessionUser();
  if (!user) redirect("/login?next=/admin/analytics");
  if (!isAdmin) return null; // the admin layout shows the no-access screen

  const params = await searchParams;
  const now = new Date();
  const today = bangkokDate(now);
  const currentMonth = today.slice(0, 7); // YYYY-MM
  const currentYear = today.slice(0, 4);   // YYYY

  const period: "day" | "month" | "year" =
    params.period === "day" || params.period === "year" ? params.period : "month";

  const selectedDate =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : today;
  const selectedMonth =
    params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : currentMonth;
  const selectedYear =
    params.year && /^\d{4}$/.test(params.year) ? params.year : currentYear;

  let startTime: string;
  let endTime: string;
  let periodLabel: string;

  if (period === "day") {
    startTime = slotStart(selectedDate, 0);
    endTime = slotStart(selectedDate, 24);
    const d = new Date(`${selectedDate}T12:00:00+07:00`);
    periodLabel = d.toLocaleDateString("th-TH", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Bangkok",
    });
  } else if (period === "month") {
    const [y, m] = selectedMonth.split("-").map(Number);
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    startTime = slotStart(`${y}-${String(m).padStart(2, "0")}-01`, 0);
    endTime = slotStart(`${nextY}-${String(nextM).padStart(2, "0")}-01`, 0);
    periodLabel = `${THAI_MONTHS_FULL[m - 1]} ${y + 543}`;
  } else {
    const y = Number(selectedYear);
    startTime = slotStart(`${y}-01-01`, 0);
    endTime = slotStart(`${y + 1}-01-01`, 0);
    periodLabel = `ปี พ.ศ. ${y + 543}`;
  }

  // Fetch bookings in the selected time range and active courts
  const [bookingsRes, courtsRes] = await Promise.all([
    supabase
      .from("bookings")
      .select(
        "id, court_id, starts_at, ends_at, amount, status, channel, customer_name, customer_phone, admin_note, user_id, created_at, courts(name)",
      )
      .gte("starts_at", startTime)
      .lt("starts_at", endTime)
      .order("starts_at", { ascending: false })
      .returns<BookingRow[]>(),
    supabase.from("courts").select("id, name").eq("is_active", true).order("id"),
  ]);

  if (bookingsRes.error || courtsRes.error) {
    console.error("Analytics fetch failed:", bookingsRes.error ?? courtsRes.error);
    return <p className="error">โหลดข้อมูลรายงานไม่สำเร็จ</p>;
  }

  const rawBookings = bookingsRes.data ?? [];
  const courts = courtsRes.data ?? [];

  // Fetch profiles for users with missing customer_name
  const missingUserIds = [...new Set(rawBookings.filter((b) => !b.customer_name).map((b) => b.user_id))];
  const { data: profiles } = missingUserIds.length
    ? await supabase.from("profiles").select("id, display_name, phone").in("id", missingUserIds)
    : { data: [] };
  const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

  // Standardize booking row items
  const bookings: BookingRowItem[] = rawBookings.map((b) => {
    const p = profileMap.get(b.user_id);
    return {
      id: b.id,
      courtId: b.court_id,
      courtName: b.courts?.name ?? `สนาม ${b.court_id}`,
      startsAt: b.starts_at,
      endsAt: b.ends_at,
      amount: Math.round(Number(b.amount)),
      status: b.status,
      channel: b.channel,
      customerName: b.customer_name || p?.display_name || "ลูกค้าออนไลน์",
      customerPhone: b.customer_phone || p?.phone || null,
      adminNote: b.admin_note,
      createdAt: b.created_at,
    };
  });

  // Calculate Overall KPIs
  const confirmedBookings = bookings.filter((b) => b.status === "confirmed");
  const totalRevenue = confirmedBookings.reduce((sum, b) => sum + b.amount, 0);
  // Cancelled and expired rows are reported on their own line, not folded into the total.
  const counts = countBookings(bookings);
  const confirmedCount = counts.confirmed;
  const pendingCount = counts.waiting;

  const totalHours = confirmedBookings.reduce((sum, b) => {
    const dur = (Date.parse(b.endsAt) - Date.parse(b.startsAt)) / (3600 * 1000);
    return sum + dur;
  }, 0);

  // Capacity Hours calculation
  const openH = BOOKING_RULES.openHour;
  const closeH = BOOKING_RULES.closeHour;
  const dailyHoursPerCourt = closeH - openH;
  let daysInPeriod = 1;
  if (period === "day") {
    daysInPeriod = 1;
  } else if (period === "month") {
    const [y, m] = selectedMonth.split("-").map(Number);
    daysInPeriod = daysInMonth(y, m);
  } else {
    daysInPeriod = 365;
  }
  const capacityHours = courts.length * dailyHoursPerCourt * daysInPeriod;
  const utilization = capacityHours > 0 ? Math.round((totalHours / capacityHours) * 100) : 0;

  // Build Time Data Points for Charts
  const timeData: TimeDataPoint[] = [];

  if (period === "day") {
    // Breakdown by hour (09:00 - 22:00)
    for (let h = openH; h < closeH; h++) {
      const hStart = Date.parse(slotStart(selectedDate, h));
      const hEnd = Date.parse(slotStart(selectedDate, h + 1));
      const inHour = confirmedBookings.filter((b) => {
        const s = Date.parse(b.startsAt);
        const e = Date.parse(b.endsAt);
        return s < hEnd && e > hStart;
      });

      const rev = inHour.reduce((sum, b) => {
        const s = Date.parse(b.startsAt);
        const e = Date.parse(b.endsAt);
        const overlap = (Math.min(e, hEnd) - Math.max(s, hStart)) / (3600 * 1000);
        const totalDur = (e - s) / (3600 * 1000);
        return sum + Math.round((overlap / (totalDur || 1)) * b.amount);
      }, 0);

      timeData.push({
        label: `${String(h).padStart(2, "0")}:00`,
        fullLabel: `ช่วง ${formatHour(h)} - ${formatHour(h + 1)} น.`,
        revenue: rev,
        bookingsCount: inHour.length,
        hours: inHour.length * 1,
      });
    }
  } else if (period === "month") {
    // Breakdown by day (1 - daysInMonth)
    const [y, m] = selectedMonth.split("-").map(Number);
    const totalDays = daysInMonth(y, m);
    for (let day = 1; day <= totalDays; day++) {
      const dayStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const dayStart = Date.parse(slotStart(dayStr, 0));
      const dayEnd = Date.parse(slotStart(dayStr, 24));
      const dayObj = new Date(`${dayStr}T12:00:00+07:00`);
      const dayOfWeek = dayObj.getDay(); // 0 = Sun, 6 = Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      const dayBookings = confirmedBookings.filter((b) => {
        const s = Date.parse(b.startsAt);
        return s >= dayStart && s < dayEnd;
      });

      const rev = dayBookings.reduce((sum, b) => sum + b.amount, 0);
      const hours = dayBookings.reduce(
        (sum, b) => sum + (Date.parse(b.endsAt) - Date.parse(b.startsAt)) / (3600 * 1000),
        0,
      );

      timeData.push({
        label: String(day),
        fullLabel: `${dayObj.toLocaleDateString("th-TH", {
          weekday: "long",
          day: "numeric",
          month: "short",
          timeZone: "Asia/Bangkok",
        })}`,
        revenue: rev,
        bookingsCount: dayBookings.length,
        hours,
        isWeekend,
      });
    }
  } else {
    // Breakdown by month (1 - 12)
    const y = Number(selectedYear);
    for (let m = 1; m <= 12; m++) {
      const mStr = `${y}-${String(m).padStart(2, "0")}`;
      const nextY = m === 12 ? y + 1 : y;
      const nextM = m === 12 ? 1 : m + 1;
      const mStart = Date.parse(slotStart(`${mStr}-01`, 0));
      const mEnd = Date.parse(slotStart(`${nextY}-${String(nextM).padStart(2, "0")}-01`, 0));

      const mBookings = confirmedBookings.filter((b) => {
        const s = Date.parse(b.startsAt);
        return s >= mStart && s < mEnd;
      });

      const rev = mBookings.reduce((sum, b) => sum + b.amount, 0);
      const hours = mBookings.reduce(
        (sum, b) => sum + (Date.parse(b.endsAt) - Date.parse(b.startsAt)) / (3600 * 1000),
        0,
      );

      timeData.push({
        label: THAI_MONTHS_SHORT[m - 1],
        fullLabel: `${THAI_MONTHS_FULL[m - 1]} ${y + 543}`,
        revenue: rev,
        bookingsCount: mBookings.length,
        hours,
      });
    }
  }

  // Calculate Court Stats
  const courtStats: CourtStat[] = courts.map((c) => {
    const courtBookings = confirmedBookings.filter((b) => b.courtId === c.id);
    const rev = courtBookings.reduce((sum, b) => sum + b.amount, 0);
    const hours = courtBookings.reduce(
      (sum, b) => sum + (Date.parse(b.endsAt) - Date.parse(b.startsAt)) / (3600 * 1000),
      0,
    );
    return {
      courtId: c.id,
      courtName: c.name,
      revenue: rev,
      hours,
      bookingsCount: courtBookings.length,
    };
  });

  // Calculate Channel Stats
  const channelStats: ChannelStat[] = (["online", "phone", "line", "walk_in"] as const).map(
    (ch) => {
      const chBookings = confirmedBookings.filter((b) => b.channel === ch);
      const count = bookings.filter((b) => b.channel === ch).length;
      const rev = chBookings.reduce((sum, b) => sum + b.amount, 0);
      const conf = CHANNEL_CONFIG[ch];
      return {
        channel: ch,
        label: conf.label,
        count,
        revenue: rev,
        color: conf.color,
      };
    },
  );

  return (
    <div className="stack analytics-page" style={{ gap: 16 }}>
      <LiveRefresh table="bookings" />

      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 style={{ margin: "0 0 4px 0", fontSize: "1.45rem" }}>📊 รายงานและสถิติการจอง</h1>
          <span className="muted" style={{ fontSize: "0.9rem" }}>
            วิเคราะห์รายรับ จำนวนคิว และประวัติการจองแบบเรียลไทม์ · แบดมินตัน@สินธานี
          </span>
        </div>
      </div>

      {/* Period Filter (Day / Month / Year) */}
      <AnalyticsPeriodPicker
        period={period}
        currentDate={selectedDate}
        currentMonth={selectedMonth}
        currentYear={selectedYear}
        today={today}
      />

      {/* Overview KPI Cards */}
      <AnalyticsKpiCards
        revenue={totalRevenue}
        confirmedCount={confirmedCount}
        pendingCount={pendingCount}
        activeCount={counts.active}
        droppedCount={counts.dropped}
        totalHours={totalHours}
        capacityHours={capacityHours}
        utilization={utilization}
        courtCount={courts.length}
        periodLabel={periodLabel}
      />

      {/* Interactive Charts & Breakdowns */}
      <AnalyticsCharts
        periodLabel={periodLabel}
        timeData={timeData}
        courtStats={courtStats}
        channelStats={channelStats}
        totalRevenue={totalRevenue}
        totalBookings={confirmedCount}
      />

      {/* Detailed Booking Table */}
      <AnalyticsBookingTable
        bookings={bookings}
        courts={courts}
        periodLabel={periodLabel}
      />
    </div>
  );
}
