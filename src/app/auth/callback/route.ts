import { publicOrigin } from "@/lib/site-url";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext as toSafeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";

// Handles both link styles:
//  - token_hash (recommended, see README): works even when the email is opened
//    in a different browser or a LINE/Gmail in-app browser.
//  - code (PKCE default): only works in the browser that requested the link.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = (searchParams.get("type") ?? "email") as EmailOtpType;
  const safeNext = toSafeNext(searchParams.get("next"));

  const supabase = await createClient();
  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    : code
      ? await supabase.auth.exchangeCodeForSession(code)
      : { error: new Error("missing code") };

  if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  console.error("Auth callback failed:", error);
  return NextResponse.redirect(`${origin}/login?error=link`);
}
