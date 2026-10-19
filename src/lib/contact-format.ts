// Pure display helpers for the shop contact (no server imports, so they unit-test cleanly).

/** 0812345678 -> 081-234-5678, 021234567 -> 02-123-4567 */
export function formatPhone(phone: string): string {
  if (phone.length === 10) return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  if (phone.length === 9) return `${phone.slice(0, 2)}-${phone.slice(2, 5)}-${phone.slice(5)}`;
  return phone;
}

/** A LINE ID or official account (@name) becomes an add-friend link; links pass through. */
export function lineUrl(line: string): string {
  if (/^https:\/\//.test(line)) return line;
  if (line.startsWith("@")) return `https://line.me/R/ti/p/${encodeURIComponent(line)}`;
  return `https://line.me/ti/p/~${encodeURIComponent(line)}`;
}
