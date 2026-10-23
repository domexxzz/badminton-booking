/**
 * Which service reads a slip image.
 *
 * EasySlip asks the bank's own system, so what it reports is the real transfer.
 * Typhoon is an LLM reading the picture, so an edited image can fool it; it is only
 * a fallback for when EasySlip is not configured, and must never win over EasySlip
 * when both keys are set. See docs/SYSTEM_STATUS.md: TYPHOON_API_KEY was removed from
 * Render for exactly this reason and must stay unset.
 */
export type SlipProvider = "easyslip" | "typhoon" | null;

// Takes the same shape as receiverFromEnv, so process.env passes straight in.
export function pickSlipProvider(env: Record<string, string | undefined>): SlipProvider {
  if (env.EASYSLIP_API_KEY?.trim()) return "easyslip";
  if (env.TYPHOON_API_KEY?.trim()) return "typhoon";
  return null;
}
