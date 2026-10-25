export type TelegramConfig = {
  botToken: string;
  chatId: string;
};

export function getTelegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() || "8827549262:AAGt7aDuc0jF8sYPSrZLZIh4ee5gwcvtAyg";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() || "-1004354078243";
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

export async function sendTelegramMessage(
  text: string,
  options?: { parseMode?: "HTML" | "MarkdownV2" | "Markdown" },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config) return false;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: config.chatId,
      text,
      disable_web_page_preview: true,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;

    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`Telegram sendMessage failed [${res.status}]:`, err);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Telegram sendMessage error:", error);
    return false;
  }
}

export async function sendTelegramPhoto(
  photo: Blob | Buffer | Uint8Array,
  caption?: string,
  options?: { parseMode?: "HTML" | "MarkdownV2" | "Markdown" },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config) return false;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendPhoto`;
    const form = new FormData();
    form.append("chat_id", config.chatId);

    const blob = photo instanceof Blob ? photo : new Blob([photo as any]);
    form.append("photo", blob, "slip.jpg");

    if (caption) {
      form.append("caption", caption);
      if (options?.parseMode) form.append("parse_mode", options.parseMode);
    }

    const res = await fetchImpl(url, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`Telegram sendPhoto failed [${res.status}]:`, err);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Telegram sendPhoto error:", error);
    return false;
  }
}
