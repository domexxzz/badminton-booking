/**
 * Where people reach the site. Behind a tunnel or proxy the incoming request
 * can look like https://localhost:3000, so redirects after sign-in prefer the
 * configured public URL and fall back to the request's own origin.
 */
export function publicOrigin(requestUrl: string, configured = process.env.NEXT_PUBLIC_SITE_URL): string {
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // Misconfigured value: fall through to the request origin.
    }
  }
  return new URL(requestUrl).origin;
}
