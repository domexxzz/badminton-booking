import { BookingForm } from "@/components/BookingForm";
import { getPublicCourts, getPublicVenueHours } from "@/lib/public-data";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const toInt = (v: string | undefined) => (v && /^\d{1,2}(\.\d)?$/.test(v) ? Number(v) : undefined);

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; court?: string; hour?: string }>;
}) {
  const params = await searchParams;
  const [{ user, displayName, isCoach }, { openHour, closeHour }, courts] = await Promise.all([
    getSessionUser(),
    getPublicVenueHours(),
    getPublicCourts(),
  ]);

  if (!courts?.length) {
    return <p className="error">โหลดข้อมูลสนามไม่สำเร็จ กรุณารีเฟรช</p>;
  }

  const hour = toInt(params.hour);
  return (
    <BookingForm
      courts={courts}
      isLoggedIn={Boolean(user)}
      bookerName={displayName}
      isCoach={isCoach}
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
