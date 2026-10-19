import { AdminHoursSettings } from "@/components/admin/AdminHoursSettings";
import { ShopContactSettings } from "@/components/admin/ShopContactSettings";
import { getShopContact } from "@/lib/shop-contact";
import { getVenueHours } from "@/lib/venue-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [{ openHour, closeHour }, contact] = await Promise.all([getVenueHours(), getShopContact()]);

  return (
    <section className="stack" style={{ gap: 16 }}>
      <div>
        <h2>ตั้งค่าเวลาทำการสนาม</h2>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          จัดการเวลาเปิด-ปิดสนาม และรอบเวลาที่เปิดให้ลูกค้าจองออนไลน์
        </p>
      </div>

      <AdminHoursSettings currentOpenHour={openHour} currentCloseHour={closeHour} />
      <ShopContactSettings current={contact} />
    </section>
  );
}
