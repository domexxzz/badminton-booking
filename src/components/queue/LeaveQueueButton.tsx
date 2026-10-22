"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { leaveQueue } from "@/app/queue-actions";

export function LeaveQueueButton({ entryId, playing }: { entryId: string; playing: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function leave() {
    if (!confirm(playing ? "จบเกมและออกจากคิว?" : "ออกจากคิว? ถ้าต่อใหม่จะไปอยู่ท้ายคิว")) return;
    setError(null);
    startTransition(async () => {
      const result = await leaveQueue(entryId);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" onClick={leave} disabled={pending}>
        {pending ? "…" : playing ? "จบเกม / ออกจากคิว" : "ออกจากคิว"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
