import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import { buildCheckRecord, receiverFromEnv, type CheckRecord } from "./check-record";
import { verifyWithEasySlip } from "./easyslip";
import { pickSlipProvider } from "./provider";
import { verifyWithTyphoon } from "./typhoon";
import type { ProviderResult } from "./types";

type PendingPayment = {
  id: string;
  amount?: number;
  slip_path: string;
  bookings: { amount: number; created_at: string; status: string } | null;
};

export function isSlipVerificationEnabled(): boolean {
  return pickSlipProvider(process.env) !== null && getServiceClient() !== null;
}

function toRecord(result: ProviderResult, payment: PendingPayment): CheckRecord {
  return buildCheckRecord(result, {
    amountBaht: Number(payment.amount ?? payment.bookings!.amount),
    bookingCreatedAt: payment.bookings!.created_at,
    now: new Date(),
    ...receiverFromEnv(process.env),
  });
}

/**
 * Checks the latest submitted slip of a booking with EasySlip and records the
 * outcome. Only a clean "verified" result acts on its own (confirms the
 * booking); anything else stays with an admin, with the reasons attached.
 * Never throws: any failure leaves the booking for manual review.
 * Returns the recorded status, or null when nothing was checked.
 */
export async function verifyLatestSlip(bookingId: string): Promise<string | null> {
  const provider = pickSlipProvider(process.env);
  const supabase = getServiceClient();
  if (!provider || !supabase) return null;

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
    } else if (provider === "easyslip") {
      result = await verifyWithEasySlip(image, process.env.EASYSLIP_API_KEY!);
    } else {
      result = await verifyWithTyphoon(image, process.env.TYPHOON_API_KEY!);
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
