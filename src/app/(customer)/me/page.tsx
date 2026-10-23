import { ShopContactCard } from "@/components/ShopContactCard";
import { BrandPromo } from "@/components/BrandPromo";
import { CourtArt } from "@/components/CourtArt";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signOut } from "@/app/actions";
import { STATUS_LABEL, formatBaht, formatSlot, formatTime } from "@/lib/format";
import { PlayerStatsCard, type PlayerCard } from "@/components/party/PlayerStatsCard";
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
  const { supabase, user, isAdmin, isCoach, isPartyHost, displayName, avatarUrl } = await getSessionUser();
  if (!user) redirect("/login?next=/me");

  const isLineAccount = Boolean(user.app_metadata?.line_user_id);
  const isGoogleAccount =
    user.app_metadata?.provider === "google" ||
    (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.includes("google"));

  // The ladder card (migration 0030). It is only ever about the signed-in player.
  // A set-returning RPC hands back an array, the same shape my_party_entries does.
  const { data: cardRows } = await supabase.rpc("my_player_card");
  const card = (cardRows as PlayerCard[] | null)?.[0] ?? null;

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
  const groupedBookings = data
    ? (() => {
        const map = new Map<string, { lead: Row; items: Row[]; courts: string[]; totalAmount: number }>();
        for (const b of data) {
          const gid = b.group_id ?? b.id;
          const existing = map.get(gid);
          const cname = b.courts?.name ?? "สนาม";
          if (!existing) {
            map.set(gid, {
              lead: b,
              items: [b],
              courts: [cname],
              totalAmount: Number(b.amount),
            });
          } else {
            existing.items.push(b);
            if (!existing.courts.includes(cname)) existing.courts.push(cname);
            existing.totalAmount += Number(b.amount);
          }
        }
        return Array.from(map.values());
      })()
    : [];

  return (
    <>
      <section className="card stack" style={{ gap: 12 }}>
        <div className="profile-card">
          <span className="avatar">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" className="avatar-img" />
            ) : (
              (displayName ?? "ผ").trim().charAt(0)
            )}
          </span>
          <div style={{ display: "grid", flex: 1, gap: 2 }}>
            <strong>{displayName ?? "ผู้เล่น"}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {isAdmin ? (
                <span className="badge confirmed">แอดมิน</span>
              ) : isPartyHost ? (
                <span className="badge" style={{ background: "var(--primary-soft)", color: "var(--primary-strong)", fontWeight: 600 }}>
                  🏸 หัวหน้าก๊วน
                </span>
              ) : (
                <span className="muted">สมาชิก</span>
              )}
              {isLineAccount && (
                <span
                  className="badge"
                  style={{
                    background: "#06c755",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 6px",
                  }}
                >
                  LINE
                </span>
              )}
              {isGoogleAccount && (
                <span
                  className="badge"
                  style={{
                    background: "#4285F4",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 6px",
                  }}
                >
                  Google
                </span>
              )}
            </div>
          </div>
          <form action={signOut}>
            <button className="btn btn-sm btn-ghost" type="submit">
              ออกจากระบบ
            </button>
          </form>
        </div>
        <Link href="/community" className="btn btn-block btn-ghost" style={{ textAlign: "center" }}>
          💬 คอมมูนิตี้
        </Link>
        <Link href="/guide" className="btn btn-block btn-ghost" style={{ textAlign: "center" }}>
          📖 วิธีใช้งานระบบ
        </Link>
        <Link href="/coaches" className="btn btn-block btn-ghost" style={{ textAlign: "center" }}>
          🎓 เรียนกับโค้ช
        </Link>
        {isCoach && (
          <Link href="/coach" className="btn btn-block btn-ghost" style={{ textAlign: "center" }}>
            🏅 ตารางสอนและคลาสของฉัน
          </Link>
        )}
        {isPartyHost && (
          <Link href="/queue?view=create" className="btn btn-block btn-ghost" style={{ textAlign: "center" }}>
            🏸 สร้างห้องก๊วนตีแบด
          </Link>
        )}
        {isAdmin && (
          <Link href="/admin" className="btn btn-block" style={{ textAlign: "center" }}>
            ⚙️ เข้าสู่ระบบหลังร้าน (Admin) ↗
          </Link>
        )}
      </section>

      {card && (
        <section className="stack" style={{ gap: 10 }}>
          <h2>สถิติการเล่นของฉัน</h2>
          <PlayerStatsCard card={card} />
        </section>
      )}

      <section className="stack" style={{ gap: 10 }}>
        <h2>การจองของฉัน</h2>
        {groupedBookings.length === 0 && (
          <div className="card stack">
            <p className="muted" style={{ margin: 0 }}>
              ยังไม่มีการจอง
            </p>
            <Link className="btn btn-block" href="/book">
              จองสนาม
            </Link>
          </div>
        )}
        <div className="list">
          {groupedBookings.map(({ lead, items, courts, totalAmount }) => {
            const allSameTime = items.every(
              (it) => it.starts_at === lead.starts_at && it.ends_at === lead.ends_at,
            );
            return (
              <Link key={lead.id} href={`/bookings/${lead.id}`} className="card list-item my-booking-card">
                <div className="booking-court-thumbnail">
                  <CourtArt label={courts.join(", ")} />
                </div>
                <div className="meta">
                  <strong>{courts.join(", ")}</strong>
                  {allSameTime ? (
                    <span className="muted">{formatSlot(lead.starts_at, lead.ends_at)}</span>
                  ) : (
                    <div className="stack" style={{ gap: 1 }}>
                      {items.map((it) => (
                        <span key={it.id} className="muted">
                          {it.courts?.name ?? "สนาม"}: {formatTime(it.starts_at)}–{formatTime(it.ends_at)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ textAlign: "right", display: "grid", gap: 4 }}>
                  <span className={`badge ${lead.status}`}>{STATUS_LABEL[lead.status]}</span>
                  <span className="muted">{formatBaht(totalAmount)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
      <BrandPromo />
      <ShopContactCard />
    </>
  );
}
