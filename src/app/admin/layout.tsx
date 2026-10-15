import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// The shop's back office: its own shell, separate from the customer app.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { supabase, user, isAdmin, displayName } = await getSessionUser();
  if (!user) redirect("/login?next=/admin");
  if (!isAdmin) notFound();

  const { count } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_review");

  return (
    <div className="app admin-app">
      <header className="admin-header">
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <div className="greeting">
            <span className="muted">หลังร้าน · {displayName ?? "แอดมิน"}</span>
            <strong>จัดการสนามแบด</strong>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/" className="btn btn-sm btn-ghost" target="_blank">
              หน้าลูกค้า ↗
            </Link>
            <form action={signOut}>
              <button className="btn btn-sm btn-ghost" type="submit">ออก</button>
            </form>
          </div>
        </div>
        <AdminNav reviewCount={count ?? 0} />
      </header>
      <main className="app-main">{children}</main>
    </div>
  );
}
