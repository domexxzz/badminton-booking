import { LiveRefresh } from "@/components/LiveRefresh";
import { RequestActions } from "@/components/admin/RequestActions";
import { formatBaht, formatDate, formatSlot, formatTime } from "@/lib/format";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

type Row = {
  id: string;
  booking_id: string;
  user_id: string;
  kind: "reschedule" | "cancel";
  status: "pending" | "refund_pending";
  refund_amount: number | null;
  new_court_id: number | null;
  new_starts_at: string | null;
  new_ends_at: string | null;
  reason: string | null;
  refund_qr_path: string | null;
  created_at: string;
  bookings: { court_id: number; starts_at: string; ends_at: string; amount: number; courts: { name: string } | null } | null;
};

export default async function RequestsPage() {
  const { supabase } = await getSessionUser();
  const requests = await supabase
    .from("booking_requests")
    .select(
      "id, booking_id, user_id, kind, status, refund_amount, new_court_id, new_starts_at, new_ends_at, reason, refund_qr_path, created_at, bookings(court_id, starts_at, ends_at, amount, courts(name))",
    )
    .in("status", ["pending", "refund_pending"])
    .order("created_at", { ascending: true })
    .returns<Row[]>();

  if (requests.error) {
    console.error("Requests load failed:", requests.error);
    return <p className="error">โหลดคำขอไม่สำเร็จ</p>;
  }

  const userIds = [...new Set(requests.data.map((r) => r.user_id))];
  const qrPaths = requests.data.flatMap((r) => (r.refund_qr_path ? [r.refund_qr_path] : []));
  const [{ data: profiles }, { data: signed }, { data: courts }] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id, display_name, phone").in("id", userIds)
      : Promise.resolve({ data: [] }),
    qrPaths.length
      ? supabase.storage.from("refunds").createSignedUrls(qrPaths, SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: [] }),
    supabase.from("courts").select("id, name"),
  ]);
  const who = new Map((profiles ?? []).map((p) => [p.id, p]));
  const qrUrl = new Map((signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [[s.path, s.signedUrl] as const] : [])));
  const courtName = new Map((courts ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      <LiveRefresh table="booking_requests" />
      <section className="stack" style={{ gap: 10 }}>
        <h2>คำขอเลื่อน / ยกเลิก / รอโอนคืน ({requests.data.length})</h2>
        {requests.data.length === 0 && <div className="card muted">ไม่มีคำขอค้าง</div>}
        {requests.data.map((r) => {
          const customer = who.get(r.user_id);
          const b = r.bookings;
          const qr = r.refund_qr_path ? qrUrl.get(r.refund_qr_path) : undefined;
          return (
            <div key={r.id} className="card stack" style={{ gap: 8 }}>
              <div className="row">
                <strong>
                  {r.status === "refund_pending"
                    ? "💸 ลูกค้ายกเลิกแล้ว · รอโอนคืน"
                    : r.kind === "cancel"
                      ? "🧾 ขอยกเลิก + คืนเงิน"
                      : "🔁 ขอเลื่อน"}
                </strong>
                <span className="muted">{formatDate(r.created_at)} {formatTime(r.created_at)}</span>
              </div>
              <div>
                <strong>{customer?.display_name ?? "ลูกค้า"}</strong>
                {customer?.phone && (
                  <> · <a href={`tel:${customer.phone}`}>{customer.phone}</a></>
                )}
              </div>
              {b && (
                <div className="muted">
                  เดิม: {b.courts?.name} · {formatSlot(b.starts_at, b.ends_at)} · {formatBaht(b.amount)}
                </div>
              )}
              {r.kind === "reschedule" && r.new_starts_at && r.new_ends_at && (
                <div>
                  ใหม่: <strong>{courtName.get(r.new_court_id ?? 0) ?? "สนาม"} · {formatSlot(r.new_starts_at, r.new_ends_at)}</strong>
                </div>
              )}
              {r.reason && <div className="muted">เหตุผล: {r.reason}</div>}
              {r.kind === "cancel" && (
                <div className="stack" style={{ gap: 4 }}>
                  <span>
                    QR รับเงินของลูกค้า · โอนคืน{" "}
                    <strong>{formatBaht(Number(r.refund_amount ?? b?.amount ?? 0))}</strong>
                    {r.status === "refund_pending" && <span className="muted"> (สนามถูกปล่อยแล้ว)</span>}
                  </span>
                  {qr ? (
                    <a href={qr} target="_blank" rel="noreferrer" download>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="qr" src={qr} alt="QR รับเงินของลูกค้า" />
                    </a>
                  ) : (
                    <p className="error">โหลดรูป QR ไม่ได้</p>
                  )}
                  <span className="muted">แตะรูปเพื่อเปิดเต็มจอ / บันทึก แล้วสแกนจากแอปธนาคารเพื่อโอนคืน</span>
                </div>
              )}
              <RequestActions
                requestId={r.id}
                bookingId={r.booking_id}
                customerId={r.user_id}
                kind={r.kind}
                refundOnly={r.status === "refund_pending"}
              />
            </div>
          );
        })}
      </section>
    </>
  );
}
