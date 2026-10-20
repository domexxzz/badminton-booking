import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import type { LineLoginConfig } from "./login";

export const LINE_OAUTH_COOKIE = "line_oauth";

/** LINE Login settings, or null when LINE Login is not set up. */
export function lineLoginConfig(): LineLoginConfig | null {
  // Trimmed: a pasted secret with a stray space or line break fails LINE's check.
  const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim();
  const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!channelId || !channelSecret || !siteUrl || !getServiceClient()) return null;
  return {
    channelId,
    channelSecret,
    // Must match the callback URL registered in the LINE Developers Console exactly.
    redirectUri: `${siteUrl.replace(/\/$/, "")}/auth/line/callback`,
    botPrompt: process.env.LINE_LOGIN_BOT_PROMPT,
  };
}

export const isLineLoginEnabled = () => lineLoginConfig() !== null;
