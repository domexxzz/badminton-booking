import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import { verifyWithEasySlip } from "./easyslip";
import { verifyWithTyphoon } from "./typhoon";
import type { ProviderResult, VerifyStatus } from "./types";

type PendingPayment = {
  id: string;
  amount?: number;
  slip_path: string;
  bookings: { amount: number; created_at: string; status: string } | null;
};

type CheckRecord = {
  status: VerifyStatus;
  reasons: string[];
  transRef?: string;
  amount?: number;
  date?: string;
  raw?: unknown;
};

export function isSlipVerificationEnabled(): boolean {
  return Boolean(process.env.EASYSLIP_API_KEY || process.env.TYPHOON_API_KEY) && getServiceClient() !== null;
}

function toRecord(result: ProviderResult, payment: PendingPayment): CheckRecord {
  if (result.kind !== "ok") {
    return { status: result.kind, reasons: [result.message] };
  }
  const expectedAmount = Number(payment.amount ?? payment.bookings!.amount);
  const isAmountMatch = Math.round(result.slip.amount * 100) === Math.round(expectedAmount * 100);
  const senderName = result.slip.sender?.name || "ไม่ระบุ";
  const receiverName = result.slip.receiver.names[0] || "ไม่ระบุ";

  let timeFormatted = result.slip.date;
  try {
    const d = new Date(result.slip.date);
    if (!Number.isNaN(d.getTime())) {
      timeFormatted =
        d.toLocaleString("th-TH", {
          timeZone: "Asia/Bangkok",
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }) + " น.";
    }
  } catch {}

  const displayReasons: string[] = [
    `ชื่อผู้โอน: ${senderName}`,
    `ชื่อผู้รับ: ${receiverName}`,
    isAmountMatch
      ? `ยอดเงิน: ฿${result.slip.amount.toFixed(2)} (ตรงกับยอดที่ต้องชำระ)`
      : `ยอดเงิน: ฿${result.slip.amount.toFixed(2)} (ไม่ตรงกับยอดที่ต้องชำระ ฿${expectedAmount.toFixed(2)})`,
    `เวลา: ${timeFormatted}`,
  ];

  return {
    status: isAmountMatch ? "verified" : "mismatch",
    reasons: displayReasons,
    transRef: result.slip.transRef,
    amount: result.slip.amount,
    date: result.slip.date,
    raw: result.raw,
  };
}

/**
 * Checks the latest submitted slip of a booking with EasySlip and records the
 * outcome. Only a clean "verified" result acts on its own (confirms the
 * booking); anything else stays with an admin, with the reasons attached.
 * Never throws: any failure leaves the booking for manual review.
 * Returns the recorded status, or null when nothing was checked.
 */
export async function verifyLatestSlip(bookingId: string): Promise<string | null> {
  const easySlipKey = process.env.EASYSLIP_API_KEY;
  const typhoonKey = process.env.TYPHOON_API_KEY;
  const supabase = getServiceClient();
  if ((!easySlipKey && !typhoonKey) || !supabase) return null;

  try {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, amount, slip_path, bookings(amount, created_at, status)")
      .eq("booking_id", bookingId)
      .eq("status", "submitted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PendingPayment>();
    if (error) throw error;
    if (!payment?.bookings || payment.bookings.status !== "awaiting_review") return null;

    const { data: image, error: downloadError } = await supabase.storage.from("slips").download(payment.slip_path);
    let result: ProviderResult;
    if (downloadError) {
      console.error("Slip download failed:", downloadError);
      result = { kind: "error", message: "ดาวน์โหลดไฟล์สลิปไม่สำเร็จ" };
    } else if (typhoonKey) {
      result = await verifyWithTyphoon(image, typhoonKey);
    } else {
      result = await verifyWithEasySlip(image, easySlipKey!);
    }

    const check = toRecord(result, payment);

    // Record check outcome directly to the payment record without auto-confirming or auto-rejecting,
    // so the booking always stays in "awaiting_review" and appears on the admin review page
    // for the owner to manually review and approve/reject.
    // Try to update verification fields. If a duplicate trans_ref error occurs, handle it gracefully.
    let updateError: any = null;
    try {
      const { error } = await supabase
        .from("payments")
        .update({
          verify_status: check.status,
          verify_reasons: check.reasons,
          slip_amount: check.amount ?? null,
          slip_date: check.date ?? null,
          trans_ref: check.transRef ?? null,
          verify_raw: check.raw ?? null,
          verified_at: new Date().toISOString(),
        })
        .eq("id", payment.id);
      updateError = error;
    } catch (e) {
      updateError = e;
    }

    if (updateError) {
      // Duplicate trans_ref error (unique constraint violation)
      if (updateError?.code === "23505" || String(updateError?.message ?? "").includes("payments_trans_ref_uniq")) {
        const duplicateReasons = [
          ...(check.reasons ?? []),
          "สลิปนี้ถูกใช้กับการจองอื่นแล้ว",
        ];
        const { error: dupErr } = await supabase
          .from("payments")
          .update({
            verify_status: "duplicate",
            verify_reasons: duplicateReasons,
            slip_amount: check.amount ?? null,
            slip_date: check.date ?? null,
            // keep existing trans_ref unchanged
            verify_raw: check.raw ?? null,
            verified_at: new Date().toISOString(),
          })
          .eq("id", payment.id);
        if (dupErr) {
          console.error("Failed to record duplicate slip status:", dupErr);
          throw dupErr;
        }
        return "duplicate";
      }
      console.error("Failed to update payment verify status:", updateError);
      throw updateError;
    }

    return check.status;
  } catch (error) {
    console.error(`Slip verification failed for booking ${bookingId}:`, error);
    return null;
  }
}
