// Push messages from the shop's LINE Official Account (Messaging API).
// LINE Notify was shut down on 2025-03-31; this is its replacement.

const MULTICAST_URL = "https://api.line.me/v2/bot/message/multicast";
const MAX_RECIPIENTS = 500; // per multicast request
const MAX_TEXT = 5000;
const REQUEST_TIMEOUT_MS = 5_000;

/** Sends one text message to many LINE users. Never throws: notifications must not break bookings. */
export async function multicastText(
  channelAccessToken: string,
  userIds: string[],
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const recipients = [...new Set(userIds)].filter(Boolean);
  if (!channelAccessToken || recipients.length === 0) return false;

  let allSent = true;
  for (let i = 0; i < recipients.length; i += MAX_RECIPIENTS) {
    try {
      const response = await fetchImpl(MULTICAST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${channelAccessToken}` },
        body: JSON.stringify({
          to: recipients.slice(i, i + MAX_RECIPIENTS),
          messages: [{ type: "text", text: text.slice(0, MAX_TEXT) }],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        allSent = false;
        console.error(`LINE multicast failed (${response.status}):`, await response.text().catch(() => ""));
      }
    } catch (error) {
      allSent = false;
      console.error("LINE multicast request failed:", error);
    }
  }
  return allSent;
}
