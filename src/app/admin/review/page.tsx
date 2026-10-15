import { LiveRefresh } from "@/components/LiveRefresh";
import { RecheckButton } from "@/components/RecheckButton";
import { ReviewButtons } from "@/components/ReviewButtons";
import { formatBaht, formatSlot } from "@/lib/format";
import { isBankMatchingEnabled } from "@/lib/bank/settings";
import { isSlipVerificationEnabled } from "@/lib/slip/verify-booking";
import { getSessionUser } from "@/lib/supabase/server";
import { BankInbox } from "../BankInbox";

export const dynamic = "force-dynamic";

const SIGNED_URL_TTL_SECONDS = 60 * 10;

type Payment = {
  slip_path: string | null;
  status: string;
  created_at: string;
  verify_status: string;
  verify_reasons: string[];
};

type Row = {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  courts: { name: string } | null;
  payments: Payment[];
};

const VERIFY_HEADLINE: Record<string, string> = {
  unchecked: "ยังไม่ได้ตรวจอัตโนมัติ ตรวจเองก่อนกดยืนยัน",
  mismatch: "⚠️ ตรวจอัตโนมัติไม่ผ่าน",
  error: "ตรวจอัตโนมัติไม่สำเร็จ ตรวจเองหรือกดตรวจอีกครั้ง",
  duplicate: "🚫 สลิปนี้ถูกใช้กับการจองอื่นแล้ว",
  unreadable: "⚠️ ระบบอ่านสลิปไม่ได้ อาจไม่ใช่สลิปจริงหรือรูปไม่ชัด",
};

const latestPayment = (payments: Payment[]) =>
  [...payments].sort((a, c) => c.created_at.localeCompare(a.created_at))[0];

export default async function ReviewPage() {
  const { supabase } = await getSessionUser();
  const review = await supabase
    .from("bookings")
    .select("id, user_id, starts_at, ends_at, amount, courts(name), payments(slip_path, status, created_at, verify_status, verify_reasons)")
    .eq("status", "awaiting_review")
    .order("updated_at", { ascending: true })
    .returns<Row[]>();

  if (review.error) {
    console.error("Review load failed:", review.error);
    return <p className="error">โหลดข้อมูลไม่สำเร็จ</p>;
  }

  const userIds = [...new Set(review.data.map((b) => b.user_id))];
  const slipPathByBooking = new Map(
    review.data.flatMap((b) => {
      const path = latestPayment(b.payments)?.slip_path;
      return path ? [[b.id, path] as const] : [];
    }),
  );
  const slipPaths = [...new Set(slipPathByBooking.values())];

  // One round trip each, in parallel, instead of one signed-URL call per slip.
  const [{ data: profiles }, { data: signed }] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id, display_name, phone").in("id", userIds)
      : Promise.resolve({ data: [] }),
    slipPaths.length
      ? supabase.storage.from("slips").createSignedUrls(slipPaths, SIGNED_URL_TTL_SECONDS)
      : Promise.resolve({ data: [] }),
  ]);
  const who = new Map((profiles ?? []).map((p) => [p.id, p]));
  const urlByPath = new Map(
    (signed ?? []).flatMap((s) => (s.signedUrl && s.path ? [[s.path, s.signedUrl] as const] : [])),
  );
  const slipUrls = new Map(
    [...slipPathByBooking].flatMap(([id, path]) => {
      const url = urlByPath.get(path);
      return url ? [[id, url] as const] : [];
    }),
  );
  const autoCheck = isSlipVerificationEnabled();

  return (
    <>
      <LiveRefresh table="bookings" />
      <section className="stack" style={{ gap: 10 }}>
        <h2>สลิปรอตรวจ ({review.data.length})</h2>
        {review.data.length === 0 && <div className="card muted">ไม่มีสลิปค้างตรวจ</div>}
        {review.data.map((b) => {
          const payment = latestPayment(b.payments);
          return (
            <div key={b.id} className="card review">
              <div className="list-item">
                <div className="meta">
                  <strong>{who.get(b.user_id)?.display_name ?? "ลูกค้า"}</strong>
                  <span className="muted">
                    {b.courts?.name} · {formatSlot(b.starts_at, b.ends_at)}
                  </span>
                  {who.get(b.user_id)?.phone && (
                    <a className="muted" href={`tel:${who.get(b.user_id)?.phone}`}>
                      📞 {who.get(b.user_id)?.phone}
                    </a>
                  )}
                </div>
                <span className="amount" style={{ fontSize: 22 }}>{formatBaht(b.amount)}</span>
              </div>
              {slipUrls.get(b.id) ? (
                <a href={slipUrls.get(b.id)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="slip" src={slipUrls.get(b.id)} alt="สลิปโอนเงิน" />
                </a>
              ) : (
                <p className="error">โหลดสลิปไม่ได้</p>
              )}
              {payment && (
                <div
                  className={["mismatch", "duplicate", "unreadable"].includes(payment.verify_status) ? "error" : "muted"}
                  style={{ fontSize: 14 }}
                >
                  <strong>{VERIFY_HEADLINE[payment.verify_status] ?? VERIFY_HEADLINE.unchecked}</strong>
                  {payment.verify_reasons.length > 0 && (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {payment.verify_reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {autoCheck && <RecheckButton bookingId={b.id} />}
              <ReviewButtons bookingId={b.id} />
            </div>
          );
        })}
      </section>

      {isBankMatchingEnabled() ? (
        <BankInbox supabase={supabase} />
      ) : (
        <p className="muted">ยังไม่ได้เปิดระบบยืนยันจากแจ้งเตือนเงินเข้า (ดู README)</p>
      )}
    </>
  );
}
