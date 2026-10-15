import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import { MIN_SECRET_LENGTH } from "./webhook";

export function bankWebhookSettings() {
  return {
    secret: process.env.BANK_WEBHOOK_SECRET ?? "",
    allowedApps: (process.env.BANK_APP_PACKAGES ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  };
}

/** True when incoming-transfer notifications can confirm bookings. */
export function isBankMatchingEnabled(): boolean {
  const { secret, allowedApps } = bankWebhookSettings();
  return secret.length >= MIN_SECRET_LENGTH && allowedApps.length > 0 && getServiceClient() !== null;
}
