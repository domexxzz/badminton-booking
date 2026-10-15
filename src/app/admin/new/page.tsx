import { AdminBookingForm } from "@/components/AdminBookingForm";
import { BOOKING_RULES } from "@/lib/config";
import { upcomingDates } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  const { supabase } = await getSessionUser();
  const { data: courts, error } = await supabase
    .from("courts")
    .select("id, name, price_per_hour")
    .eq("is_active", true)
    .order("id");

  if (error) {
    console.error("Failed to load courts:", error);
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ</p>;
  }
  return <AdminBookingForm courts={courts ?? []} dates={upcomingDates(new Date(), BOOKING_RULES.maxDaysAhead)} />;
}
