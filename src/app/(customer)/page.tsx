import { HomeClientView } from "@/components/HomeClientView";
import { ShopContactCard } from "@/components/ShopContactCard";
import { bangkokDate, slotStart, type Occupancy } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";
import { getVenueHours } from "@/lib/venue-settings";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ supabase }, { openHour, closeHour }] = await Promise.all([
    getSessionUser(),
    getVenueHours(),
  ]);
  const now = new Date();
  const today = bangkokDate(now);

  const [courts, occupancy] = await Promise.all([
    supabase.from("courts").select("id, name, price_per_hour").eq("is_active", true).order("id"),
    supabase
      .from("court_occupancy")
      .select("booking_id, court_id, starts_at, ends_at, state, hold_expires_at")
      .lt("starts_at", slotStart(today, 24))
      .gt("ends_at", now.toISOString())
      .order("starts_at")
      .returns<Occupancy[]>(),
  ]);

  if (courts.error) {
    console.error("Failed to load courts:", courts.error);
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }

  return (
    <>
      <HomeClientView
        courts={courts.data}
        occupancy={occupancy.data ?? []}
        openHour={openHour}
        closeHour={closeHour}
      />
      <ShopContactCard />
    </>
  );
}

