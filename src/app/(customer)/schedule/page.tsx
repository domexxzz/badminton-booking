import { ScheduleBoard } from "@/components/ScheduleBoard";
import { getSessionUser } from "@/lib/supabase/server";
import { getVenueHours } from "@/lib/venue-settings";

export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const [{ supabase }, { openHour, closeHour }] = await Promise.all([
    getSessionUser(),
    getVenueHours(),
  ]);
  const { data: courts, error } = await supabase
    .from("courts")
    .select("id, name, price_per_hour")
    .eq("is_active", true)
    .order("id");

  if (error) {
    console.error("Failed to load courts:", error);
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }
  return <ScheduleBoard courts={courts ?? []} initialDate={date} openHour={openHour} closeHour={closeHour} />;
}

