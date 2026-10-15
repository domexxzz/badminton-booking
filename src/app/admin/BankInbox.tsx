import type { SupabaseClient } from "@supabase/supabase-js";
import { HandledButton } from "@/components/HandledButton";
import { LiveRefresh } from "@/components/LiveRefresh";
import { STATUS_LABEL, formatBaht, formatSlot, formatTime, formatDate } from "@/lib/format";

// The phone sends a heartbeat every ~30 minutes; warn after two missed beats.
const STALE_AFTER_MINUTES = 75;
const INBOX_LIMIT = 50;

type InboxRow = {
  id: string;
  received_at: string;
  amount: number | null;
  title: string | null;
  body: string;
  note: string | null;
  bookings: { status: string; starts_at: string; ends_at: string; courts: { name: string } | null } | null;
};

function ListenerStatus({ lastSeenAt }: { lastSeenAt: string | null }) {
  if (!lastSeenAt) {
    return <p className="error">มือถือรับแจ้งเตือนยังไม่เคยส่งข้อมูลมา ตรวจการตั้งค่า MacroDroid</p>;
  }
  const minutes = Math.floor((Date.now() - Date.parse(lastSeenAt)) / 60_000);
  const label = minutes < 1 ? "เมื่อสักครู่" : `${minutes} นาทีที่แล้ว`;
  return minutes > STALE_AFTER_MINUTES ? (
    <p className="error">⚠️ มือถือรับแจ้งเตือนเงียบไป {label} เงินที่เข้าช่วงนี้จะไม่ขึ้นในรายการ</p>
  ) : (
    <p className="muted">📱 มือถือรับแจ้งเตือนออนไลน์ (ล่าสุด {label})</p>
  );
}

export async function BankInbox({ supabase }: { supabase: SupabaseClient }) {
  const [status, inbox] = await Promise.all([
    supabase.from("bank_listener_status").select("last_seen_at").maybeSingle(),
    supabase
      .from("bank_notifications")
      .select("id, received_at, amount, title, body, note, bookings(status, starts_at, ends_at, courts(name))")
      .eq("outcome", "unmatched")
      .is("handled_at", null)
      .order("received_at", { ascending: false })
      .limit(INBOX_LIMIT)
      .returns<InboxRow[]>(),
  ]);

  if (status.error || inbox.error) {
    console.error("Bank inbox load failed:", status.error ?? inbox.error);
    return <p className="error">โหลดข้อมูลเงินเข้าไม่สำเร็จ</p>;
  }

  return (
    <section>
      <LiveRefresh table="bank_notifications" />
      <h2>เงินเข้า ({inbox.data.length})</h2>
      <ListenerStatus lastSeenAt={status.data?.last_seen_at ?? null} />
      {inbox.data.length === 0 && <p className="muted">ไม่มีรายการค้าง</p>}
      <div className="list">
        {inbox.data.map((n) => (
          <div key={n.id} className="card stack" style={{ gap: 6 }}>
            <div className="row">
              <strong>{n.amount === null ? "ไม่ทราบยอด" : formatBaht(n.amount)}</strong>
              <span className="muted">
                {formatDate(n.received_at)} {formatTime(n.received_at)}
              </span>
            </div>
            {n.note && <div className="muted">{n.note}</div>}
            {n.bookings && (
              <div className="muted">
                น่าจะเป็นของ: {n.bookings.courts?.name} · {formatSlot(n.bookings.starts_at, n.bookings.ends_at)} ·{" "}
                {STATUS_LABEL[n.bookings.status]}
              </div>
            )}
            <div className="muted" style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
              {[n.title, n.body].filter(Boolean).join("\n")}
            </div>
            <HandledButton id={n.id} />
          </div>
        ))}
      </div>
    </section>
  );
}
