"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recheckSlip } from "@/app/actions";

export function RecheckButton({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function recheck() {
    setError(null);
    startTransition(async () => {
      const result = await recheckSlip(bookingId);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={recheck} disabled={pending}>
        {pending ? "กำลังตรวจ…" : "🔄 ตรวจสลิปอัตโนมัติอีกครั้ง"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
