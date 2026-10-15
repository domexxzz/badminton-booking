import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { getSessionUser } from "@/lib/supabase/server";

// Customer-facing shell. Nothing here points at the shop's admin area.
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { user, displayName } = await getSessionUser();

  return (
    <div className="app">
      <header className="app-header">
        {user ? (
          <div className="greeting">
            <span className="muted">สวัสดี</span>
            <strong>{displayName ?? "ผู้เล่น"}</strong>
          </div>
        ) : (
          <Link href="/" className="brand">
            แบดมินตัน@สินธานี
          </Link>
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
