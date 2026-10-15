"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markBankNotificationHandled } from "@/app/actions";

export function HandledButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function markHandled() {
    startTransition(async () => {
      const result = await markBankNotificationHandled(id);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={markHandled} disabled={pending}>
        {pending ? "กำลังบันทึก…" : "✓ จัดการแล้ว (คืนเงิน/ติดต่อลูกค้าแล้ว)"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
