import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { BrandLockup } from "@/components/BrandLockup";
import { RealtimeNotificationBanner } from "@/components/RealtimeNotificationBanner";
import { getSessionUser } from "@/lib/supabase/server";

// Customer-facing shell. Nothing here points at the shop's admin area.
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { user, displayName } = await getSessionUser();

  return (
    <div className="app customer-app">
      <RealtimeNotificationBanner userId={user?.id} isAdmin={false} />
      <header className="app-header">
        <BrandLockup />
        {user ? (
          <div className="greeting">
            <span className="muted">สวัสดี</span>
            <strong>{displayName ?? "ผู้เล่น"}</strong>
          </div>
        ) : (
          <span className="brand-welcome">พร้อมลงสนาม<br /><strong>กันหรือยัง?</strong></span>
        )}
        {user ? (
          <Link href="/me" className="avatar" aria-label="บัญชีของฉัน">
            {(displayName ?? "ผ").trim().charAt(0)}
          </Link>
        ) : (
          <Link href="/login" className="btn btn-sm">
            เข้าสู่ระบบ
          </Link>
        )}
      </header>
      <main className="app-main">{children}</main>
      <BottomNav />
    </div>
  );
}
