"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewPayment } from "@/app/actions";

export function ReviewButtons({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(approve: boolean) {
    if (!approve && !window.confirm("ยืนยันปฏิเสธสลิปและยกเลิกคิวสนามนี้ทันที?")) return;
    startTransition(async () => {
      const result = await reviewPayment(bookingId, approve, note.trim());
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <input
        type="text"
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
        placeholder="หมายเหตุถึงลูกค้า (ถ้าปฏิเสธ เช่น ยอดไม่ตรง)"
      />
      <div className="row" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={() => decide(true)} disabled={pending}>ยืนยันการชำระ</button>
        <button className="btn btn-danger" onClick={() => decide(false)} disabled={pending}>ปฏิเสธสลิป</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
