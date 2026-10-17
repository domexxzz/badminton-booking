import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { STATUS_LABEL, formatBaht, formatSlot } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
  courts: { name: string } | null;
};

export default async function MyBookingsPage() {
  const { supabase, user, isAdmin, displayName } = await getSessionUser();
  if (!user) redirect("/login?next=/me");

  const { data, error } = await supabase
    .from("bookings")
    .select("id, starts_at, ends_at, amount, status, courts(name)")
    .eq("user_id", user.id)
    .eq("channel", "online") // phone/LINE bookings an admin entered are not the admin's own
    .order("starts_at", { ascending: false })
    .limit(50)
    .returns<Row[]>();

  if (error) {
    console.error("Failed to load bookings:", error);
    return <p className="error">โหลดการจองไม่สำเร็จ</p>;
  }

  return (
    <>
      <section className="card stack" style={{ gap: 12 }}>
        <div className="profile-card">
          <span className="avatar">{(displayName ?? "ผ").trim().charAt(0)}</span>
          <div style={{ display: "grid", flex: 1, gap: 2 }}>
            <strong>{displayName ?? "ผู้เล่น"}</strong>
            <div>
              {isAdmin ? (
                <span className="badge confirmed">แอดมิน</span>
              ) : (
                <span className="muted">สมาชิก</span>
              )}
            </div>
          </div>
          <form action={signOut}>
            <button className="btn btn-sm btn-ghost" type="submit">ออกจากระบบ</button>
          </form>
        </div>
        {isAdmin && (
          <Link href="/admin" className="btn btn-block" style={{ textAlign: "center" }}>
            ⚙️ เข้าสู่ระบบหลังร้าน (Admin) ↗
          </Link>
        )}
      </section>

      <section className="stack" style={{ gap: 10 }}>
        <h2>การจองของฉัน</h2>
        {data.length === 0 && (
          <div className="card stack">
            <p className="muted" style={{ margin: 0 }}>ยังไม่มีการจอง</p>
            <Link className="btn btn-block" href="/book">จองสนาม</Link>
          </div>
        )}
        <div className="list">
          {data.map((b) => (
            <Link key={b.id} href={`/bookings/${b.id}`} className="card list-item">
              <div className="meta">
                <strong>{b.courts?.name}</strong>
                <span className="muted">{formatSlot(b.starts_at, b.ends_at)}</span>
              </div>
              <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                <span className={`badge ${b.status}`}>{STATUS_LABEL[b.status]}</span>
                <span className="muted">{formatBaht(b.amount)}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
