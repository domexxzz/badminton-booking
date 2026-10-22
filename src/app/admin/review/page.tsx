import { LiveRefresh } from "@/components/LiveRefresh";
import { RecheckButton } from "@/components/RecheckButton";
import { ReviewButtonsWithAmount } from "@/components/ReviewButtonsWithAmount";
import { CHANNEL_LABEL, formatBaht, formatSlot } from "@/lib/format";
import { isBankMatchingEnabled } from "@/lib/bank/settings";
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
  slip_amount: number | null;
};

type Row = {
  id: string;
  group_id?: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  channel: string;
  customer_name: string | null;
  customer_phone: string | null;
  admin_note: string | null;
  courts: { name: string } | null;
  payments: Payment[];
};

const VERIFY_HEADLINE: Record<string, string> = {
  verified: "✅ ข้อมูลในสลิปถูกต้อง",
  unchecked: "ยังไม่ได้ตรวจอัตโนมัติ ตรวจเองก่อนกดยืนยัน",
  mismatch: "⚠️ ตรวจอัตโนมัติไม่ผ่าน (ยอดเงินหรือข้อมูลไม่ตรง)",
  error: "ตรวจอัตโนมัติไม่สำเร็จ",
  duplicate: "🚫 สลิปนี้ถูกใช้กับการจองอื่นแล้ว",
  unreadable: "🚫 ไม่ใช่สลิปโอนเงิน หรือรูปไม่ชัดเจน",
};

const latestPayment = (payments: Payment[]) =>
  [...payments].sort((a, c) => c.created_at.localeCompare(a.created_at))[0];

export default async function ReviewPage() {
  const { supabase } = await getSessionUser();
  const review = await supabase
    .from("bookings")
    .select(
      "id, group_id, user_id, starts_at, ends_at, amount, channel, customer_name, customer_phone, admin_note, courts(name), payments(slip_path, status, created_at, verify_status, verify_reasons, slip_amount)",
    )
    .eq("status", "awaiting_review")
    .order("updated_at", { ascending: true })
    .returns<Row[]>();

  if (review.error) {
    console.error("Review load failed:", review.error);
    return <p className="error">โหลดข้อมูลไม่สำเร็จ</p>;
  }

  // Group rows by group_id so multi-court / multi-time bills appear as a single review card
  const groupedReviews = (() => {
    const map = new Map<
      string,
      {
        lead: Row;
        items: Row[];
        totalAmount: number;
        payments: Payment[];
      }
    >();
    for (const r of review.data) {
      const gid = r.group_id ?? r.id;
      const existing = map.get(gid);
      if (!existing) {
        map.set(gid, {
          lead: r,
          items: [r],
          totalAmount: Number(r.amount),
          payments: [...r.payments],
        });
      } else {
        existing.items.push(r);
        existing.totalAmount += Number(r.amount);
        if (r.payments.length > 0) {
          existing.lead = r;
          existing.payments.push(...r.payments);
        }
      }
    }
    return Array.from(map.values());
  })();

  const userIds = [...new Set(groupedReviews.map((g) => g.lead.user_id))];
  const slipPathByBooking = new Map(
    groupedReviews.flatMap((g) => {
      const path = latestPayment(g.payments)?.slip_path;
      return path ? [[g.lead.id, path] as const] : [];
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

  return (
    <>
      <LiveRefresh table="bookings" />
      <section className="stack" style={{ gap: 10 }}>
        <h2>สลิปรอตรวจ ({groupedReviews.length})</h2>
        {groupedReviews.length === 0 && <div className="card muted">ไม่มีสลิปค้างตรวจ</div>}
        {groupedReviews.map(({ lead: b, items, totalAmount, payments }) => {
          const payment = latestPayment(payments);
          const isNotSlip = payment?.verify_status === "unreadable";
          const isMismatch = payment?.verify_status === "mismatch" || payment?.verify_status === "duplicate";
          const isVerified = payment?.verify_status === "verified";
          const statusClass = isNotSlip
            ? "review-not-slip"
            : isMismatch
            ? "review-mismatch"
            : isVerified
            ? "review-verified"
            : "";
          return (
            <div key={b.id} className={`card review ${statusClass}`.trim()}>
              <div className="list-item">
                <div className="meta">
                  {b.customer_name ? (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <strong style={{ fontSize: 16 }}>👤 {b.customer_name}</strong>
                        <span
                          className="badge"
                          style={{
                            background: "rgba(16, 185, 129, 0.15)",
                            color: "#059669",
                            fontWeight: 700,
                            fontSize: 12,
                          }}
                        >
                          🛡️ แอดมินจองให้ ({CHANNEL_LABEL[b.channel] ?? b.channel})
                        </span>
                      </div>
                      {items.length === 1 ? (
                        <span className="muted">
                          {b.courts?.name} · {formatSlot(b.starts_at, b.ends_at)}
                        </span>
                      ) : (
                        <div className="stack" style={{ gap: 2, marginTop: 2 }}>
                          {items.map((it) => (
                            <span key={it.id} className="muted" style={{ fontSize: 13 }}>
                              🏸 <strong>{it.courts?.name ?? "สนาม"}</strong> · {formatSlot(it.starts_at, it.ends_at)} (
                              {formatBaht(it.amount)})
                            </span>
                          ))}
                        </div>
                      )}
                      {b.customer_phone && (
                        <a
                          className="muted"
                          href={`tel:${b.customer_phone}`}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                        >
                          📞 {b.customer_phone}
                        </a>
                      )}
                      {b.admin_note && (
                        <span className="muted" style={{ fontSize: 13 }}>
                          📝 หมายเหตุ: {b.admin_note}
                        </span>
                      )}
                      <span className="muted" style={{ fontSize: 11, opacity: 0.8 }}>
                        (ทำรายการโดยแอดมิน: {who.get(b.user_id)?.display_name ?? "แอดมิน"})
                      </span>
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <strong>{who.get(b.user_id)?.display_name ?? "ลูกค้า"}</strong>
                        <span className="badge" style={{ fontSize: 12 }}>
                          🌐 ออนไลน์ {items.length > 1 ? `(${items.length} สนาม)` : ""}
                        </span>
                      </div>
                      {items.length === 1 ? (
                        <span className="muted">
                          {b.courts?.name} · {formatSlot(b.starts_at, b.ends_at)}
                        </span>
                      ) : (
                        <div className="stack" style={{ gap: 2, marginTop: 2 }}>
                          {items.map((it) => (
                            <span key={it.id} className="muted" style={{ fontSize: 13 }}>
                              🏸 <strong>{it.courts?.name ?? "สนาม"}</strong> · {formatSlot(it.starts_at, it.ends_at)} (
                              {formatBaht(it.amount)})
                            </span>
                          ))}
                        </div>
                      )}
                      {who.get(b.user_id)?.phone && (
                        <a className="muted" href={`tel:${who.get(b.user_id)?.phone}`}>
                          📞 {who.get(b.user_id)?.phone}
                        </a>
                      )}
                    </>
                  )}
                </div>
                <span className="amount" style={{ fontSize: 22 }}>
                  {formatBaht(totalAmount)}
                </span>
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
                  className={
                    ["mismatch", "duplicate", "unreadable"].includes(payment.verify_status)
                      ? "error"
                      : isVerified
                      ? "success"
                      : "muted"
                  }
                  style={{ fontSize: 14 }}
                >
                  <strong>{VERIFY_HEADLINE[payment.verify_status] ?? VERIFY_HEADLINE.unchecked}</strong>
                  {(payment.verify_reasons?.length ?? 0) > 0 && (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                      {payment.verify_reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <RecheckButton bookingId={b.id} />
              <ReviewButtonsWithAmount
                bookingId={b.id}
                expectedAmount={totalAmount}
                slipAmount={payment?.slip_amount ?? null}
              />
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
