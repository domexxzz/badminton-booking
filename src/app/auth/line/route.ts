import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { LINE_OAUTH_COOKIE, lineLoginConfig } from "@/lib/line/config";
import { buildAuthorizeUrl } from "@/lib/line/login";
import { safeNext } from "@/lib/safe-next";

export const runtime = "nodejs";

const STATE_TTL_SECONDS = 10 * 60;

// Starts LINE Login: remember state/nonce in a short-lived httpOnly cookie, then go to LINE.
export async function GET(request: NextRequest) {
  const { origin, searchParams } = new URL(request.url);
  const config = lineLoginConfig();
  if (!config) return NextResponse.redirect(`${origin}/login?error=line_unavailable`);

  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const cookieStore = await cookies();
  cookieStore.set(LINE_OAUTH_COOKIE, JSON.stringify({ state, nonce, next: safeNext(searchParams.get("next")) }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/line",
    maxAge: STATE_TTL_SECONDS,
  });
  return NextResponse.redirect(buildAuthorizeUrl(config, state, nonce));
}
