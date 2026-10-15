/** Only same-site relative paths may be used as a post-login redirect. */
export function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/";
  const isRelative = next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\");
  return isRelative ? next : "/";
}
