import { publicOrigin } from "@/lib/site-url";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { LINE_OAUTH_COOKIE, lineLoginConfig } from "@/lib/line/config";
import { issueLineSession } from "@/lib/line/identity";
import { exchangeCode, verifyIdToken } from "@/lib/line/login";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type SavedLogin = { state: string; nonce: string; next: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b));

function readSaved(raw: string | undefined): SavedLogin | null {
  try {
    const saved = JSON.parse(raw ?? "") as Partial<SavedLogin>;
    return typeof saved.state === "string" && typeof saved.nonce === "string"
      ? { state: saved.state, nonce: saved.nonce, next: safeNext(saved.next) }
      : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request.url);
  const fail = (reason: string) => NextResponse.redirect(`${origin}/login?error=${reason}`);

  const config = lineLoginConfig();
  if (!config) return fail("line_unavailable");

  // One use only: the state cookie is cleared whatever happens next.
  const cookieStore = await cookies();
  const saved = readSaved(cookieStore.get(LINE_OAUTH_COOKIE)?.value);
  cookieStore.delete({ name: LINE_OAUTH_COOKIE, path: "/auth/line" });

  if (!saved || !sameSecret(searchParams.get("state") ?? "", saved.state)) return fail("line_state");
  if (searchParams.get("error")) return fail("line_cancelled");
  const code = searchParams.get("code");
  if (!code) return fail("line_state");

  // Which step broke goes into the URL (no secrets), so a failed sign-in can be
  // diagnosed from the address bar when server logs are out of reach.
  let step = "token";
  try {
    const idToken = await exchangeCode(config, code);
    step = "verify";
    const profile = await verifyIdToken(config, idToken, saved.nonce);
    step = "account";
    const { tokenHash, type } = await issueLineSession(profile);

    step = "session";
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw error;
    return NextResponse.redirect(`${origin}${saved.next}`);
  } catch (error) {
    console.error(`LINE login failed at ${step}:`, error);
    return fail(`line_failed&step=${step}`);
  }
}
