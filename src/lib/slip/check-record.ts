import { evaluateSlip, type Expectation } from "./evaluate";
import type { ProviderResult, VerifyStatus } from "./types";

export type CheckRecord = {
  status: VerifyStatus;
  reasons: string[];
  transRef?: string;
  amount?: number;
  date?: string;
  raw?: unknown;
};

type ReceiverConfig = Pick<Expectation, "promptPayId" | "bankAccount" | "receiverNames">;

/** Who the shop's money goes to, from PROMPTPAY_ID, SLIP_RECEIVER_BANK_ACCOUNT and SLIP_RECEIVER_NAME. */
export function receiverFromEnv(env: Record<string, string | undefined>): ReceiverConfig {
  return {
    promptPayId: env.PROMPTPAY_ID || null,
    bankAccount: env.SLIP_RECEIVER_BANK_ACCOUNT || null,
    receiverNames: (env.SLIP_RECEIVER_NAME ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  };
}

function formatSlipTime(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  return (
    d.toLocaleString("th-TH", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }) + " น."
  );
}

/**
 * Turns a provider answer into what we store on the payment. "verified" needs the
 * amount, the receiver account and name, and the transfer time to all check out;
 * the slip facts are listed first so the admin can see them either way.
 */
export function buildCheckRecord(result: ProviderResult, exp: Expectation): CheckRecord {
  if (result.kind !== "ok") {
    return { status: result.kind, reasons: [result.message] };
  }
  const { slip } = result;
  const evaluation = evaluateSlip(slip, exp);

  const facts = [
    `ชื่อผู้โอน: ${slip.sender?.name || "ไม่ระบุ"}`,
    `ชื่อผู้รับ: ${slip.receiver.names[0] || "ไม่ระบุ"}`,
    `ยอดเงิน: ฿${slip.amount.toFixed(2)}`,
    `เวลา: ${formatSlipTime(slip.date)}`,
  ];

  return {
    status: evaluation.status,
    reasons: [...facts, ...evaluation.reasons],
    transRef: slip.transRef,
    amount: slip.amount,
    date: slip.date,
    raw: result.raw,
  };
}
