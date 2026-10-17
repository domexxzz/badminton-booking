import { BookingForm } from "@/components/BookingForm";
import { getSessionUser } from "@/lib/supabase/server";
import { getVenueHours } from "@/lib/venue-settings";

export const dynamic = "force-dynamic";

const toInt = (v: string | undefined) => (v && /^\d{1,2}(\.\d)?$/.test(v) ? Number(v) : undefined);

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; court?: string; hour?: string }>;
}) {
  const params = await searchParams;
  const [{ supabase, user, displayName }, { openHour, closeHour }] = await Promise.all([
    getSessionUser(),
    getVenueHours(),
  ]);
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
      openHour={openHour}
      closeHour={closeHour}
      initial={{
        date: params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : undefined,
        court: toInt(params.court),
        hour: hour !== undefined && hour >= openHour && hour < closeHour ? hour : undefined,
      }}
    />
  );
}
