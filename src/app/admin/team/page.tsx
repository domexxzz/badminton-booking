import { AdminToggle } from "@/components/admin/AdminToggle";
import { CoachToggle } from "@/components/admin/CoachToggle";
import { formatDate } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const LIST_LIMIT = 50;

type Person = {
  id: string;
  display_name: string | null;
  phone: string | null;
  line_user_id: string | null;
  is_admin: boolean;
  is_coach?: boolean;
  created_at: string;
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const search = (q ?? "").trim().slice(0, 50);
  const { supabase, user } = await getSessionUser();

  let query = supabase
    .from("profiles")
    // "*" so the list still loads before the is_coach column is migrated.
    .select("*")
    .order("is_admin", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (search) {
    // Escape the LIKE wildcards so a search is taken literally.
    query = query.ilike("display_name", `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  const { data, error } = await query.returns<Person[]>();
  if (error) {
    console.error("Team load failed:", error);
    return <p className="error">โหลดรายชื่อไม่สำเร็จ</p>;
  }

  const admins = data.filter((p) => p.is_admin);
  const others = data.filter((p) => !p.is_admin);

  const row = (p: Person) => (
    <div key={p.id} className="card list-item">
      <div className="meta">
        <strong>
          {p.display_name ?? "ไม่มีชื่อ"}
          {p.id === user?.id && <span className="muted"> (คุณ)</span>}
        </strong>
        <span className="muted">
          {p.line_user_id ? "💬 LINE" : "✉️ อีเมล"} · เข้าครั้งแรก {formatDate(p.created_at)}
          {p.phone && ` · ${p.phone}`}
        </span>
      </div>
      <div style={{ display: "grid", justifyItems: "end", gap: 6 }}>
        {p.id === user?.id ? (
          <span className="badge confirmed">แอดมิน</span>
        ) : (
          <AdminToggle userId={p.id} name={p.display_name ?? "ผู้ใช้นี้"} isAdmin={p.is_admin} />
        )}
        {!p.is_admin && <CoachToggle userId={p.id} name={p.display_name ?? "ผู้ใช้นี้"} isCoach={p.is_coach === true} />}
      </div>
    </div>
  );

  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2>จัดการแอดมิน / โค้ช</h2>
      <p className="muted" style={{ margin: 0 }}>
        คนที่จะเป็นแอดมินต้องเข้าเว็บแล้วกด “เข้าสู่ระบบด้วย LINE” 1 ครั้งก่อน ชื่อถึงจะขึ้นในรายการนี้
      </p>
      <form className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
        <input type="text" name="q" defaultValue={search} placeholder="ค้นหาชื่อ LINE" style={{ flex: 1 }} />
        <button className="btn btn-sm" type="submit">ค้นหา</button>
      </form>

      <h3>แอดมิน ({admins.length})</h3>
      {admins.map(row)}

      <h3>{search ? `ผลการค้นหา “${search}”` : "ผู้ใช้ล่าสุด"}</h3>
      {others.length === 0 && <div className="card muted">ไม่พบผู้ใช้</div>}
      {others.map(row)}
    </section>
  );
}
