import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

let client: SupabaseClient | null | undefined;

/**
 * Service-role client: bypasses RLS. Only for trusted server work (recording
 * slip-check results). Returns null when SUPABASE_SERVICE_ROLE_KEY is unset.
 */
export function getServiceClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = key
    ? createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
  return client;
}
