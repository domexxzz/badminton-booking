"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { withdrawRequest } from "@/app/request-actions";
import { formatSlot } from "@/lib/format";
import { CancelRequestForm } from "./CancelRequestForm";
import { RescheduleForm } from "./RescheduleForm";

export type PendingRequest = {
  id: string;
  kind: "reschedule" | "cancel";
  new_starts_at: string | null;
  new_ends_at: string | null;
  newCourtName: string | null;
};

/** On a paid booking: ask to move or cancel it, or follow a request already sent. */
export function BookingChangePanel({
  bookingId,
  userId,
  courtId,
  durationHours,
  amount,
  courts,
  pending,
  canCancel,
  cancelDeadlineText,
}: {
  bookingId: string;
  userId: string;
  courtId: number;
  durationHours: number;
  amount: number;
  courts: { id: number; name: string }[];
  pending: PendingRequest | null;
  canCancel: boolean;
  cancelDeadlineText: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"menu" | "reschedule" | "cancel">("menu");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  if (pending) {
    const withdraw = () =>
      startTransition(async () => {
        const result = await withdrawRequest(pending.id, bookingId);
        if (!result.ok) return setError(result.error);
        router.refresh();
      });
    return (
      <div className="card stack" style={{ gap: 8 }}>
        <h2>⏳ รอแอดมินตอบคำขอ</h2>
        <p className="muted" style={{ margin: 0 }}>
          {pending.kind === "cancel"
            ? "ขอยกเลิกและคืนเงิน แอดมินจะโอนคืนเข้า QR ที่คุณแนบไว้"
            : `ขอเลื่อนเป็น ${pending.newCourtName ?? "สนาม"} · ${formatSlot(pending.new_starts_at!, pending.new_ends_at!)}`}
        </p>
        <p className="muted" style={{ margin: 0 }}>การจองเดิมยังใช้ได้จนกว่าแอดมินจะอนุมัติ</p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={withdraw} disabled={busy}>
          ถอนคำขอ
        </button>
      </div>
    );
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <h2>ต้องการเปลี่ยนแปลง?</h2>
      {mode === "menu" && (
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode("reschedule")}>
            ขอเลื่อนเวลา
          </button>
          {canCancel && (
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setMode("cancel")}>
              ยกเลิกการจอง
            </button>
          )}
        </div>
      )}
      {mode === "menu" && (
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {canCancel
            ? `ยกเลิกเองและรับเงินคืนได้ถึง ${cancelDeadlineText} (12:00 น. ของวันที่เล่น)`
            : `เลยเวลายกเลิกเองแล้ว (ยกเลิกได้ถึง 12:00 น. ของวันที่เล่น) ถ้าจำเป็นต้องยกเลิก กรุณาติดต่อร้าน`}
        </p>
      )}
      {mode === "reschedule" && (
        <RescheduleForm
          bookingId={bookingId}
          currentCourtId={courtId}
          durationHours={durationHours}
          courts={courts}
          onCancel={() => setMode("menu")}
        />
      )}
      {mode === "cancel" && (
        <CancelRequestForm
          bookingId={bookingId}
          userId={userId}
          amount={amount}
          deadlineText={cancelDeadlineText}
          onCancel={() => setMode("menu")}
        />
      )}
    </div>
  );
}
