"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markBookingPaid } from "@/app/admin-actions";

/** Records that the shop collected a pay-later bill (every court on it). */
export function MarkPaidButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function markPaid() {
    if (!confirm("ยืนยันว่าได้รับเงินบิลนี้แล้ว?")) return;
    setError(null);
    startTransition(async () => {
      const result = await markBookingPaid(bookingId);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="btn btn-sm" onClick={markPaid} disabled={pending}>
        {pending ? "…" : "รับเงินแล้ว"}
      </button>
      {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
    </>
  );
}
