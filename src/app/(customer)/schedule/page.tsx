import { ScheduleBoard } from "@/components/ScheduleBoard";
import { getPublicCourts, getPublicVenueHours } from "@/lib/public-data";

export const dynamic = "force-dynamic";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const [{ openHour, closeHour }, courts] = await Promise.all([getPublicVenueHours(), getPublicCourts()]);

  if (!courts) {
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }
  return <ScheduleBoard courts={courts} initialDate={date} openHour={openHour} closeHour={closeHour} />;
}

