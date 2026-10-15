import "server-only";
import { randomUUID } from "node:crypto";
import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase/service";
import type { LineProfile } from "./login";

// Supabase Auth has no LINE provider, so each LINE user gets a Supabase user
// with a placeholder email that can never receive mail. The email is RANDOM:
// a predictable one (derived from the LINE id) could be registered by someone
// else first and then handed to the real LINE user — an account takeover.
// The link to LINE lives in app_metadata, which only the service role can
// write, and in profiles.line_user_id. A trigger (0006) refuses any other
// account on this domain.
export const LINE_EMAIL_DOMAIN = "line-login.invalid";

async function findLinkedUserEmail(admin: SupabaseClient, lineUserId: string): Promise<string | null> {
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) return null;

  const { data, error: getError } = await admin.auth.admin.getUserById(profile.id);
  if (getError) throw getError;
  // Only accounts we created for this LINE user, never one linked any other way.
  if (data.user.app_metadata?.line_user_id !== lineUserId || !data.user.email) {
    throw new Error("Profile linked to this LINE id is not a LINE account");
  }
  return data.user.email;
}

async function createLineUser(admin: SupabaseClient, profile: LineProfile): Promise<string> {
  const email = `line-${randomUUID()}@${LINE_EMAIL_DOMAIN}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { line_user_id: profile.userId },
    user_metadata: { display_name: profile.name ?? "ผู้ใช้ LINE", line_picture: profile.picture },
  });
  if (error) throw error;

  const { error: linkError } = await admin
    .from("profiles")
    .update({ line_user_id: profile.userId })
    .eq("id", data.user.id);
  // A unique violation here means a parallel login linked this LINE id first;
  // the orphan account we just made is harmless (unreachable random email).
  if (linkError) throw linkError;
  return email;
}

/**
 * Finds or creates the Supabase user for a LINE profile that LINE has already
 * verified, and returns a one-time token hash the caller exchanges for a session.
 */
export async function issueLineSession(profile: LineProfile): Promise<{ tokenHash: string; type: EmailOtpType }> {
  const admin = getServiceClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");

  const email = (await findLinkedUserEmail(admin, profile.userId)) ?? (await createLineUser(admin, profile));
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return { tokenHash: data.properties.hashed_token, type: data.properties.verification_type };
}
