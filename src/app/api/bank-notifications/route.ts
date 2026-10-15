import { bankWebhookSettings } from "@/lib/bank/settings";
import { createBankWebhookHandler, type BankStore } from "@/lib/bank/webhook";
import { notifyAfterTransfer } from "@/lib/line/notify-shop";
import { getServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serviceStore(): BankStore | null {
  const supabase = getServiceClient();
  if (!supabase) return null;
  return {
    heartbeat: async () => {
      const { error } = await supabase.rpc("record_listener_heartbeat");
      if (error) throw error;
    },
    record: async (n) => {
      const { data, error } = await supabase.rpc("record_bank_notification", {
        p_dedupe_key: n.dedupeKey,
        p_source_app: n.app,
        p_title: n.title,
        p_body: n.text,
        p_direction: n.direction,
        p_amount: n.amount,
        p_posted_at: n.postedAt,
        p_review_reason: n.reviewReason,
      });
      if (error) throw error;
      const result = data as { outcome: string; booking_id?: string; reconciled?: boolean };
      await notifyAfterTransfer(result, n.amount);
      return result;
    },
  };
}

export async function POST(request: Request) {
  const { secret, allowedApps } = bankWebhookSettings();
  return createBankWebhookHandler({ secret, allowedApps, store: serviceStore() })(request);
}
