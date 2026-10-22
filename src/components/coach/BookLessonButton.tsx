"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createLessonBooking } from "@/app/coach-actions";

/** One open start time. Holds the court and the coach, then goes to the payment page. */
export function BookLessonButton({
  coachId,
  startsAt,
  hours,
  label,
  expectedTotal,
}: {
  coachId: string;
  startsAt: string;
  hours: number;
  label: string;
  /** The bill shown on this page; the database refuses the booking if it has changed. */
  expectedTotal: number;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function book() {
    setError(null);
    startTransition(async () => {
      const result = await createLessonBooking(coachId, startsAt, hours, expectedTotal);
      if (!result.ok) return setError(result.error);
      router.push(`/bookings/${result.data.id}`);
    });
  }

  return (
    <>
      <button type="button" className="chip free" onClick={book} disabled={pending}>
        {pending ? "…" : label}
      </button>
      {error && (
        <p className="error" role="alert" style={{ gridColumn: "1 / -1" }}>
          {error}
        </p>
      )}
    </>
  );
}
