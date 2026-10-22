"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { markCoachPaid } from "@/app/coach-actions";
import { formatBaht } from "@/lib/format";

/** Records that the shop handed the lesson fees for finished lessons to the coach. */
export function MarkCoachPaidButton({
  coachId,
  coachName,
  owed,
  /** The lessons shown on this page; only these are marked paid. */
  bookingIds,
}: {
  coachId: string;
  coachName: string;
  owed: number;
  bookingIds: string[];
}) {
  const lessons = bookingIds.length;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function mark() {
    if (!confirm(`บันทึกว่าจ่ายค่าสอน ${formatBaht(owed)} ให้ ${coachName} แล้ว? (${lessons} คลาส)`)) return;
    setError(null);
    startTransition(async () => {
      const result = await markCoachPaid(coachId, bookingIds);
      if (!result.ok) return setError(result.error);
      if (result.data.count < lessons) {
        setError(`บันทึกได้ ${result.data.count} จาก ${lessons} คลาส (บางคลาสถูกบันทึกไปแล้วหรือถูกยกเลิก)`);
      }
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <button type="button" className="btn btn-sm" onClick={mark} disabled={pending || lessons === 0}>
        {pending ? "…" : "จ่ายแล้ว"}
      </button>
      {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
