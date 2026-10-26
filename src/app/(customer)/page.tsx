import { HomeClientView } from "@/components/HomeClientView";
import { ShopContactCard } from "@/components/ShopContactCard";
import { VenueCard } from "@/components/VenueCard";
import { getPublicCourts, getPublicVenueHours } from "@/lib/public-data";
import { bangkokDate, slotStart, type Occupancy } from "@/lib/slots";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [{ supabase }, { openHour, closeHour }] = await Promise.all([
    getSessionUser(),
    getPublicVenueHours(),
  ]);
  const now = new Date();
  const today = bangkokDate(now);

  const [courts, occupancy] = await Promise.all([
    getPublicCourts(),
    supabase
      .from("court_occupancy")
      .select("booking_id, court_id, starts_at, ends_at, state, hold_expires_at")
      .lt("starts_at", slotStart(today, 24))
      .gt("ends_at", now.toISOString())
      .order("starts_at")
      .returns<Occupancy[]>(),
  ]);

  if (!courts) {
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }

  return (
    <>
      <HomeClientView
        courts={courts}
        occupancy={occupancy.data ?? []}
        openHour={openHour}
        closeHour={closeHour}
      />
      <ShopContactCard />
      <VenueCard />
    </>
  );
}

