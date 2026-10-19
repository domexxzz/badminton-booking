import { ShopContactCard } from "@/components/ShopContactCard";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { STATUS_LABEL, formatBaht, formatSlot } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  group_id?: string;
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
    .select("id, group_id, starts_at, ends_at, amount, status, courts(name)")
    .eq("user_id", user.id)
    .eq("channel", "online") // phone/LINE bookings an admin entered are not the admin's own
    .order("starts_at", { ascending: false })
    .limit(50)
    .returns<Row[]>();

  if (error) {
    console.error("Failed to load bookings:", error);
    return <p className="error">โหลดการจองไม่สำเร็จ</p>;
  }

  // Group by group_id so multi-court bookings under 1 bill display together
  const groupedBookings = data ? (() => {
    const map = new Map<string, { lead: Row; courts: string[]; totalAmount: number }>();
    for (const b of data) {
      const gid = b.group_id ?? b.id;
      const existing = map.get(gid);
      if (!existing) {
        map.set(gid, { lead: b, courts: [b.courts?.name ?? "สนาม"], totalAmount: Number(b.amount) });
      } else {
        existing.courts.push(b.courts?.name ?? "สนาม");
        existing.totalAmount += Number(b.amount);
      }
    }
    return Array.from(map.values());
  })() : [];

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
        {groupedBookings.length === 0 && (
          <div className="card stack">
            <p className="muted" style={{ margin: 0 }}>ยังไม่มีการจอง</p>
            <Link className="btn btn-block" href="/book">จองสนาม</Link>
          </div>
        )}
        <div className="list">
          {groupedBookings.map(({ lead, courts, totalAmount }) => (
            <Link key={lead.id} href={`/bookings/${lead.id}`} className="card list-item">
              <div className="meta">
                <strong>{courts.join(", ")}</strong>
                <span className="muted">{formatSlot(lead.starts_at, lead.ends_at)}</span>
              </div>
              <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                <span className={`badge ${lead.status}`}>{STATUS_LABEL[lead.status]}</span>
                <span className="muted">{formatBaht(totalAmount)}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>
      <ShopContactCard />
    </>
  );
}
