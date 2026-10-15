import QRCode from "qrcode";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BookingChangePanel, type PendingRequest } from "@/components/BookingChangePanel";
import { BookingStatusNotice } from "@/components/BookingStatusNotice";
import { CancelButton } from "@/components/CancelButton";
import { ChevronLeft } from "@/components/icons";
import { Countdown } from "@/components/Countdown";
import { LiveRefresh } from "@/components/LiveRefresh";
import { SaveQrButton } from "@/components/SaveQrButton";
import { SlipUploader } from "@/components/SlipUploader";
import { STATUS_LABEL, formatBaht, formatSlot } from "@/lib/format";
import { promptPayPayload } from "@/lib/promptpay";
import { isSlipVerificationEnabled } from "@/lib/slip/verify-booking";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Booking = {
  id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  amount: number;
  status: string;
  hold_expires_at: string | null;
  review_note: string | null;
  court_id: number;
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
  resolved_at: string | null;
};

// What the customer sees while an admin looks at a slip the auto-check could not pass.
const VERIFY_FOR_CUSTOMER: Record<string, string> = {
  mismatch: "ระบบตรวจอัตโนมัติพบว่าข้อมูลในสลิปไม่ตรง",
  duplicate: "สลิปนี้ถูกใช้กับการจองอื่นแล้ว",
  unreadable: "ระบบอ่านสลิปไม่ได้",
};

async function promptPayQr(amount: number): Promise<string | null> {
  const target = process.env.PROMPTPAY_ID;
  if (!target) return null;
  try {
    return await QRCode.toDataURL(promptPayPayload(target, amount), { margin: 2, width: 560 });
  } catch (error) {
    console.error("Failed to build PromptPay QR:", error);
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
      "id, user_id, court_id, channel, starts_at, ends_at, amount, status, hold_expires_at, review_note, courts(name), payments(created_at, verify_status, verify_reasons)",
    )
    .eq("id", id)
    .maybeSingle<Booking>();
  if (!booking) notFound();

  const [{ data: requests }, { data: courts }] = await Promise.all([
    supabase
      .from("booking_requests")
      .select("id, kind, status, new_court_id, new_starts_at, new_ends_at, admin_note, refund_slip_path, resolved_at")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: false })
      .limit(5)
      .returns<BookingRequestRow[]>(),
    supabase.from("courts").select("id, name").eq("is_active", true).order("id"),
  ]);
  const pendingRow = requests?.find((r) => r.status === "pending") ?? null;
  const lastResolved = requests?.find((r) => r.status === "approved" || r.status === "rejected") ?? null;
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

  // Stop showing the QR once the window closes so nobody pays for a lapsed hold.
  const holdLapsed =
    booking.status === "pending_payment" &&
    booking.hold_expires_at !== null &&
    Date.parse(booking.hold_expires_at) <= Date.now();
  const awaitingPayment = booking.status === "pending_payment" && !holdLapsed;
  const amountBaht = Math.round(Number(booking.amount));
  const qr = awaitingPayment ? await promptPayQr(amountBaht) : null;
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
          court: booking.courts?.name ?? "สนาม",
          slot: formatSlot(booking.starts_at, booking.ends_at),
          amount: formatBaht(booking.amount),
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
          <strong>{booking.courts?.name ?? "สนาม"}</strong>
          <span className="muted">{formatSlot(booking.starts_at, booking.ends_at)}</span>
        </div>
        <span className={`badge ${booking.status}`}>{STATUS_LABEL[booking.status]}</span>
      </section>

      {awaitingPayment && (
        <div className="card pay">
          <div>
            {qr ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr" src={qr} alt="PromptPay QR สำหรับชำระเงิน" />
                <SaveQrButton dataUrl={qr} fileName={`promptpay-${amountBaht}-baht.png`} />
              </>
            ) : (
              <p className="error">ยังไม่ได้ตั้งค่า PROMPTPAY_ID กรุณาติดต่อแอดมิน</p>
            )}
          </div>
          <div className="stack">
            <div style={{ textAlign: "center" }}>
              <div className="muted">ยอดที่ต้องโอน</div>
              <div className="amount">{formatBaht(booking.amount)}</div>
              <div className="muted">สแกน QR แล้วยอดจะขึ้นเอง</div>
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

      {booking.status === "confirmed" && (
        <div className="card">
          <h2>จองสำเร็จ 🎉</h2>
          <p className="muted">แสดงหน้านี้ที่เคาน์เตอร์เมื่อมาถึงสนาม</p>
        </div>
      )}

      {lastResolved && (
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
          amount={Number(booking.amount)}
          courts={courts ?? []}
          pending={pending}
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
    </div>
  );
}
