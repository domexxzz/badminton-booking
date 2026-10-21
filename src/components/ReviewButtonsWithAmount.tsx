"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reviewPayment } from "@/app/actions";

/**
 * Enhanced review controls for admin slip verification.
 *
 * Adds an editable amount field so the admin can correct the payment amount
 * (e.g. when OCR misreads or the customer disputes) before approving/rejecting.
 * The corrected amount is included in the review note for audit purposes.
 */
export function ReviewButtonsWithAmount({
  bookingId,
  expectedAmount,
  slipAmount,
}: {
  bookingId: string;
  /** The booking's required amount (from DB). */
  expectedAmount: number;
  /** The amount OCR detected from the slip (may be null/0 if unchecked). */
  slipAmount: number | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [editedAmount, setEditedAmount] = useState<string>(
    slipAmount != null && slipAmount > 0 ? slipAmount.toString() : expectedAmount.toString()
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedAmount = parseFloat(editedAmount);
  const isAmountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const amountMatches = isAmountValid && Math.round(parsedAmount * 100) === Math.round(expectedAmount * 100);

  function decide(approve: boolean) {
    if (!approve && !window.confirm("ยืนยันปฏิเสธสลิปและยกเลิกคิวสนามนี้ทันที?")) return;

    // Build note with amount info for audit
    const parts: string[] = [];
    if (isAmountValid && !amountMatches) {
      parts.push(`[แก้ยอด: ฿${parsedAmount.toFixed(2)} แทน ฿${expectedAmount.toFixed(2)}]`);
    }
    if (note.trim()) parts.push(note.trim());
    const fullNote = parts.join(" ");

    startTransition(async () => {
      const result = await reviewPayment(bookingId, approve, fullNote, isAmountValid ? parsedAmount : undefined);
      if (result.ok) router.refresh();
      else setError(result.error);
    });
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {/* Editable amount */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <label style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
          💰 ยอดที่ลูกค้าโอนจริง:
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 120 }}>
          <span style={{ fontWeight: 700 }}>฿</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={editedAmount}
            onChange={(e) => setEditedAmount(e.target.value)}
            style={{
              width: "100%",
              maxWidth: 140,
              padding: "6px 10px",
              borderRadius: 8,
              border: amountMatches
                ? "1.5px solid var(--border)"
                : "1.5px solid var(--warning, #f59e0b)",
              fontSize: 16,
              fontWeight: 600,
              background: "var(--surface-2)",
            }}
          />
        </div>
        {!amountMatches && isAmountValid && (
          <span style={{ fontSize: 12, color: "var(--warning, #f59e0b)" }}>
            ⚠️ ไม่ตรงกับยอดที่ต้องชำระ ฿{expectedAmount.toFixed(2)}
          </span>
        )}
      </div>

      {/* Note input */}
      <input
        type="text"
        value={note}
        maxLength={300}
        onChange={(e) => setNote(e.target.value)}
        placeholder="หมายเหตุถึงลูกค้า (ถ้าปฏิเสธ เช่น ยอดไม่ตรง)"
      />

      {/* Action buttons */}
      <div className="row" style={{ justifyContent: "flex-start" }}>
        <button className="btn" onClick={() => decide(true)} disabled={pending || !isAmountValid}>
          ยืนยันการชำระ
        </button>
        <button className="btn btn-danger" onClick={() => decide(false)} disabled={pending}>
          ปฏิเสธสลิป
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
