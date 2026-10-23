import QRCode from "qrcode";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingChangePanel, type PendingRequest } from "@/components/BookingChangePanel";
import { BookingStatusNotice } from "@/components/BookingStatusNotice";
import { CancelButton } from "@/components/CancelButton";
import { ChevronLeft } from "@/components/icons";
import { Countdown } from "@/components/Countdown";
import { LiveRefresh } from "@/components/LiveRefresh";
import { PaymentSlipReminder } from "@/components/PaymentSlipReminder";
import { SaveQrButton } from "@/components/SaveQrButton";
import { ShopContactCard } from "@/components/ShopContactCard";
import { SlipUploader } from "@/components/SlipUploader";
import { canSelfCancel, selfCancelDeadline } from "@/lib/cancel-policy";
import { STATUS_LABEL, formatBaht, formatDate, formatSlot, formatTime } from "@/lib/format";
import { isSlipVerificationEnabled } from "@/lib/slip/verify-booking";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type GroupBooking = {
  id: string;
  court_id: number;
  starts_at: string;
  ends_at: string;
  amount: number;
  courts: { name: string } | null;
};

type Booking = {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  pay_later?: boolean;
  paid_at?: string | null;
  list_amount?: number | null;
  status: string;
  hold_expires_at: string | null;
  review_note: string | null;
  court_id: number;
  group_id?: string;
  channel: string;
  courts: { name: string } | null;
  payments: { created_at: string; verify_status: string; verify_reasons: string[] }[];
};

type BookingRequestRow = {
  id: string;
  kind: "reschedule" | "cancel";
  status: string;
  new_court_id: number | null;
  new_starts_at: string | null;
  new_ends_at: string | null;
  admin_note: string | null;
  refund_slip_path: string | null;
  refund_amount: number | null;
  resolved_at: string | null;
};

// What the customer sees while an admin looks at a slip the auto-check could not pass.
const VERIFY_FOR_CUSTOMER: Record<string, string> = {
  mismatch: "ระบบตรวจอัตโนมัติพบว่าข้อมูลในสลิปไม่ตรง",
  duplicate: "สลิปนี้ถูกใช้กับการจองอื่นแล้ว",
  unreadable: "ระบบอ่านสลิปไม่ได้",
};

import { BBL_MERCHANT_INFO, BBL_MERCHANT_PRO_QR, promptPayPayload } from "@/lib/promptpay";

async function promptPayQr(amount: number): Promise<string | null> {
  const target =
    process.env.BBL_MERCHANT_PRO_QR ||
    (process.env.PROMPTPAY_ID?.startsWith("000201") ? process.env.PROMPTPAY_ID : null) ||
    BBL_MERCHANT_PRO_QR;

  try {
    return await QRCode.toDataURL(promptPayPayload(target, amount), { margin: 2, width: 560 });
  } catch (error) {
    console.error("Failed to build Payment QR:", error);
    return null;
  }
}


export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await getSessionUser();
  if (!user) redirect(`/login?next=/bookings/${id}`);

  const { data: booking } = await supabase
    .from("bookings")
    .select(
      // "*" keeps the page working before newer columns (pay_later, ...) are migrated.
      "*, courts(name), payments(created_at, verify_status, verify_reasons)",
    )
    .eq("id", id)
    .maybeSingle<Booking>();
  if (!booking) notFound();

  // Load all bookings in this bill group if multi-court
  const { data: groupBookings } = await supabase
    .from("bookings")
    .select("id, court_id, starts_at, ends_at, amount, courts(name)")
    .eq("group_id", booking.group_id ?? booking.id)
    .order("court_id")
    .returns<GroupBooking[]>();

  const allBookings = groupBookings && groupBookings.length > 0 ? groupBookings : [booking];
  const isMultiCourt = allBookings.length > 1;
  const courtNames = Array.from(new Set(allBookings.map((b) => b.courts?.name ?? "สนาม"))).join(", ");
  const sameSlot = allBookings.every(
    (b) => b.starts_at === booking.starts_at && b.ends_at === booking.ends_at,
  );
  const slotSummary = sameSlot
    ? formatSlot(booking.starts_at, booking.ends_at)
    : `${formatDate(booking.starts_at)} · หลายช่วงเวลา (${allBookings.length} รายการ)`;
  const totalAmount = allBookings.reduce((sum, b) => sum + Number(b.amount), 0);

  const [{ data: requests }, { data: courts }] = await Promise.all([
    supabase
      .from("booking_requests")
      .select("id, kind, status, new_court_id, new_starts_at, new_ends_at, admin_note, refund_slip_path, refund_amount, resolved_at")
      // A whole-bill cancel is recorded on whichever court the customer opened.
      .in("booking_id", allBookings.map((b) => b.id))
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<BookingRequestRow[]>(),
    supabase.from("courts").select("id, name").eq("is_active", true).order("id"),
  ]);
  const pendingRow = requests?.find((r) => r.status === "pending") ?? null;
  const lastResolved = requests?.find((r) => r.status === "approved" || r.status === "rejected") ?? null;
  const refundPending = requests?.find((r) => r.status === "refund_pending") ?? null;
  const pending: PendingRequest | null = pendingRow && {
    id: pendingRow.id,
    kind: pendingRow.kind,
    new_starts_at: pendingRow.new_starts_at,
    new_ends_at: pendingRow.new_ends_at,
    newCourtName: courts?.find((c) => c.id === pendingRow.new_court_id)?.name ?? null,
  };
  const refundSlipUrl = lastResolved?.refund_slip_path
    ? (await supabase.storage.from("refunds").createSignedUrl(lastResolved.refund_slip_path, 600)).data?.signedUrl ?? null
    : null;
  const changeable =
    booking.status === "confirmed" && booking.channel === "online" && Date.parse(booking.starts_at) > Date.now();
  const cancelDeadline = selfCancelDeadline(booking.starts_at);
  const cancelDeadlineText = `${formatDate(cancelDeadline.toISOString())} ${formatTime(cancelDeadline.toISOString())} น.`;

  // Stop showing the QR once the window closes so nobody pays for a lapsed hold.
  const holdLapsed =
    booking.status === "pending_payment" &&
    booking.hold_expires_at !== null &&
    Date.parse(booking.hold_expires_at) <= Date.now();
  const awaitingPayment = booking.status === "pending_payment" && !holdLapsed;
  const amountBaht = Math.round(totalAmount);
  const unpaidPayLater = booking.status === "confirmed" && booking.pay_later === true && !booking.paid_at;
  const qr = awaitingPayment || unpaidPayLater ? await promptPayQr(amountBaht) : null;
  const latestPayment = [...booking.payments].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const autoCheckProblem = latestPayment && VERIFY_FOR_CUSTOMER[latestPayment.verify_status];

  return (
    <div className="stack">
      <LiveRefresh table="bookings" filter={`id=eq.${booking.id}`} />
      <LiveRefresh table="booking_requests" filter={`booking_id=eq.${booking.id}`} />
      <BookingStatusNotice
        bookingId={booking.id}
        status={booking.status}
        reviewNote={booking.review_note}
        summary={{
          court: isMultiCourt ? `${allBookings.length} รายการ (${courtNames})` : (booking.courts?.name ?? "สนาม"),
          slot: slotSummary,
          amount: formatBaht(totalAmount),
        }}
      />
      <div className="page-head">
        <Link href="/me" className="back" aria-label="กลับไปการจองของฉัน">
          <ChevronLeft size={20} />
        </Link>
        <h1 style={{ flex: 1 }}>รายละเอียดการจอง</h1>
      </div>
      <section className="card list-item">
        <div className="meta">
          <strong>
            {isMultiCourt
              ? `จอง ${allBookings.length} รายการ (${courtNames})`
              : (booking.courts?.name ?? "สนาม")}
          </strong>
          <span className="muted">{slotSummary}</span>
        </div>
        <span className={`badge ${booking.status}`}>{STATUS_LABEL[booking.status]}</span>
      </section>

      {isMultiCourt && (
        <section className="card stack" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: 13, fontWeight: 600 }}>รายการสนามในบิลนี้:</span>
          {allBookings.map((b) => (
            <div key={b.id} className="row" style={{ fontSize: 14, borderBottom: "1px dashed var(--border)", paddingBottom: 6 }}>
              <span>🏸 {b.courts?.name} ({formatSlot(b.starts_at, b.ends_at)})</span>
              <strong>{formatBaht(b.amount)}</strong>
            </div>
          ))}
          <div className="summary-total" style={{ paddingTop: 4 }}>
            <span>ยอดรวมทั้งสิ้น</span>
            <span>{formatBaht(totalAmount)}</span>
          </div>
        </section>
      )}

      {awaitingPayment && (
        <>
          <PaymentSlipReminder />
          <div className="card pay">
            <div>
            {qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr" src={qr} alt="Bangkok Bank Thai QR Payment สำหรับชำระเงิน" />
                <SaveQrButton dataUrl={qr} fileName={`bbl-qr-${amountBaht}-baht.png`} />
              </>
            ) : (
              <p className="error">ไม่สามารถสร้าง QR ชำระเงินได้ กรุณาติดต่อแอดมิน</p>
            )}
          </div>
          <div className="stack" style={{ gap: 12 }}>
            <div className="bbl-payment-info card" style={{ background: "var(--surface-2)", border: "1px solid var(--border)", padding: "12px 14px", borderRadius: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 700, color: "var(--foreground)", fontSize: 15 }}>
                  🏦 ธนาคารกรุงเทพ (Bangkok Bank)
                </span>
                <span className="badge" style={{ fontSize: 12, background: "var(--primary)", color: "#fff" }}>
                  Merchant Pro
                </span>
              </div>
              <div style={{ fontSize: 14, display: "flex", flexDirection: "column", gap: 3 }}>
                <div>
                  <span className="muted">ชื่อบัญชี: </span>
                  <strong>{BBL_MERCHANT_INFO.accountName}</strong>
                </div>
                <div>
                  <span className="muted">รหัสร้านค้า: </span>
                  <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{BBL_MERCHANT_INFO.merchantId}</span>
                </div>
              </div>
            </div>

            <div style={{ textAlign: "center" }}>
              <div className="muted">ยอดที่ต้องโอน {isMultiCourt ? `(รวม ${allBookings.length} สนาม)` : ""}</div>
              <div className="amount">{formatBaht(totalAmount)}</div>
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                สแกน QR ด้วยแอปธนาคารแล้วยอดจะขึ้นให้อัตโนมัติ
              </div>
            </div>

            {booking.hold_expires_at && (
              <p>
                กรุณาโอนภายใน <Countdown until={booking.hold_expires_at} /> ไม่เช่นนั้นระบบจะปล่อยคิวให้คนอื่น
              </p>
            )}
            {booking.review_note && <p className="error">สลิปก่อนหน้าไม่ผ่าน: {booking.review_note}</p>}
            <ol className="steps">
              <li>สแกน QR ด้วยแอปธนาคาร ยอดเงินจะขึ้นอัตโนมัติ (จ่ายจากมือถือเครื่องนี้: กด “บันทึกรูป QR” แล้วในแอปธนาคารเลือกสแกนจากรูปภาพ)</li>
              <li>บันทึกสลิป แล้วอัปโหลดด้านล่าง</li>
              <li>
                {isSlipVerificationEnabled()
                  ? "ระบบตรวจสลิปอัตโนมัติ ถ้าถูกต้องจะยืนยันการจองทันที"
                  : "แอดมินตรวจสลิป แล้วสถานะจะเปลี่ยนเป็น “ยืนยันแล้ว”"}
              </li>
            </ol>
            <SlipUploader bookingId={booking.id} userId={user.id} />
            <CancelButton bookingId={booking.id} />
            </div>
          </div>
        </>
      )}

      {booking.status === "awaiting_review" && (
        <div className="card">
          <h2>ได้รับสลิปแล้ว</h2>
          {autoCheckProblem && (
            <p className="error">
              {autoCheckProblem}
              {latestPayment.verify_reasons.length > 0 && `: ${latestPayment.verify_reasons.join(" · ")}`}
            </p>
          )}
          <p className="muted">แอดมินกำลังตรวจสอบสลิป หน้านี้จะอัปเดตเองเมื่อยืนยันเสร็จ</p>
        </div>
      )}

      {booking.status === "confirmed" && booking.pay_later && (
        <div className="card stack" style={{ gap: 8 }}>
          {unpaidPayLater ? (
            <>
              <h2>🕒 ชำระภายหลัง · ค้างชำระ {formatBaht(totalAmount)}</h2>
              <p className="muted" style={{ margin: 0 }}>
                สนามยืนยันแล้ว ชำระเมื่อสะดวกด้วย QR นี้ หรือที่เคาน์เตอร์ ร้านจะกดยืนยันเมื่อได้รับเงิน
              </p>
              {qr && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="qr" src={qr} alt="QR ชำระเงินภายหลัง" />
                  <SaveQrButton dataUrl={qr} fileName={`bbl-qr-${amountBaht}-baht.png`} />
                </>
              )}
            </>
          ) : (
            <h2>✅ ชำระเงินแล้ว {formatBaht(totalAmount)}</h2>
          )}
        </div>
      )}

      {booking.list_amount != null && Number(booking.list_amount) !== Number(booking.amount) && (
        <p className="muted" style={{ margin: 0, textAlign: "center" }}>
          ราคาตกลงพิเศษ {formatBaht(totalAmount)}
        </p>
      )}

      {booking.status === "confirmed" && (
        <div className="card">
          <h2>จองสำเร็จ 🎉</h2>
          <p className="muted">แสดงหน้านี้ที่เคาน์เตอร์เมื่อมาถึงสนาม</p>
        </div>
      )}

      {refundPending && (
        <div className="card stack" style={{ gap: 8 }}>
          <h2>ยกเลิกแล้ว · รอร้านโอนคืน</h2>
          <p className="muted" style={{ margin: 0 }}>
            ร้านจะโอนคืน {formatBaht(Number(refundPending.refund_amount ?? totalAmount))} ตาม QR หรือบัญชีที่คุณแจ้งไว้
            เมื่อโอนแล้วสลิปคืนเงินจะขึ้นที่หน้านี้
          </p>
        </div>
      )}

      {!refundPending && lastResolved && (
        <div className="card stack" style={{ gap: 8 }}>
          <h2>
            {lastResolved.kind === "cancel" ? "คำขอยกเลิก" : "คำขอเลื่อน"}
            {lastResolved.status === "approved" ? " · อนุมัติแล้ว ✅" : " · ไม่อนุมัติ"}
          </h2>
          {lastResolved.admin_note && <p className="muted" style={{ margin: 0 }}>แอดมิน: {lastResolved.admin_note}</p>}
          {refundSlipUrl && (
            <a href={refundSlipUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="slip" src={refundSlipUrl} alt="สลิปโอนเงินคืน" />
            </a>
          )}
        </div>
      )}

      {changeable && (
        <BookingChangePanel
          bookingId={booking.id}
          userId={user.id}
          courtId={booking.court_id}
          durationHours={(Date.parse(booking.ends_at) - Date.parse(booking.starts_at)) / 3_600_000}
          amount={totalAmount}
          courts={courts ?? []}
          pending={pending}
          canCancel={canSelfCancel(booking.starts_at)}
          unpaidPayLater={unpaidPayLater}
          cancelDeadlineText={cancelDeadlineText}
        />
      )}

      {holdLapsed && (
        <div className="card stack">
          <p>หมดเวลาชำระเงินแล้ว กรุณาอย่าโอนเงินสำหรับการจองนี้</p>
          <p className="muted">ถ้าโอนไปก่อนหมดเวลาแล้ว ยังอัปโหลดสลิปได้ทันทีด้านล่าง หรือติดต่อแอดมิน</p>
          <SlipUploader bookingId={booking.id} userId={user.id} />
        </div>
      )}

      {(booking.status === "expired" || booking.status === "cancelled") && (
        <div className="card">
          <p>การจองนี้{STATUS_LABEL[booking.status]}</p>
          {booking.status === "expired" && (
            <p className="muted">ถ้าโอนเงินไปแล้ว กรุณาติดต่อแอดมินพร้อมสลิปเพื่อขอคืนเงินหรือจองใหม่</p>
          )}
          <Link className="btn btn-block" href="/book">จองใหม่</Link>
        </div>
      )}

      <ShopContactCard title="มีคำถามเรื่องการจองนี้?" />
    </div>
  );
}
