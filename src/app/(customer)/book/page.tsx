import { BookingForm } from "@/components/BookingForm";
import { BOOKING_RULES } from "@/lib/config";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const toInt = (v: string | undefined) => (v && /^\d{1,2}$/.test(v) ? Number(v) : undefined);

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; court?: string; hour?: string }>;
}) {
  const params = await searchParams;
  const { supabase, user, displayName } = await getSessionUser();
  const { data: courts, error } = await supabase
    .from("courts")
    .select("id, name, price_per_hour")
    .eq("is_active", true)
    .order("id");

  if (error || !courts?.length) {
    console.error("Failed to load courts:", error);
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }

  const hour = toInt(params.hour);
  return (
    <BookingForm
      courts={courts}
      isLoggedIn={Boolean(user)}
      bookerName={displayName}
      initial={{
        date: params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined,
        court: toInt(params.court),
        hour: hour !== undefined && hour >= BOOKING_RULES.openHour && hour < BOOKING_RULES.closeHour ? hour : undefined,
      }}
    />
  );
}
