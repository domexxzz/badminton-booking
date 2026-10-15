"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cancelBooking } from "@/app/actions";

export function CancelButton({ bookingId, label = "ยกเลิกการจอง" }: { bookingId: string; label?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function cancel() {
    if (!window.confirm("ยืนยันยกเลิกการจองนี้?")) return;
    startTransition(async () => {
      const result = await cancelBooking(bookingId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={cancel} disabled={pending}>
        {pending ? "กำลังยกเลิก…" : label}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
