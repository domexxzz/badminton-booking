export type TelegramConfig = {
  botToken: string;
  chatId: string;
  partyChatId?: string;
  partyThreadId?: number;
};

export function getTelegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim() || "8827549262:AAGt7aDuc0jF8sYPSrZLZIh4ee5gwcvtAyg";
  const chatId = env.TELEGRAM_CHAT_ID?.trim() || "-1004354078243";
  if (!botToken || !chatId) return null;

  const partyChatId = env.TELEGRAM_PARTY_CHAT_ID?.trim() || chatId;
  const rawPartyThread = env.TELEGRAM_PARTY_THREAD_ID?.trim() || "7";
  const partyThreadId = rawPartyThread ? parseInt(rawPartyThread, 10) : undefined;

  return {
    botToken,
    chatId,
    partyChatId,
    partyThreadId: Number.isInteger(partyThreadId) ? partyThreadId : undefined,
  };
}

export type TelegramSendOptions = {
  parseMode?: "HTML" | "MarkdownV2" | "Markdown";
  chatId?: string;
  messageThreadId?: number;
};

export async function sendTelegramMessage(
  text: string,
  options?: TelegramSendOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config) return false;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
    const targetChatId = options?.chatId || config.chatId;
    const body: Record<string, unknown> = {
      chat_id: targetChatId,
      text,
      disable_web_page_preview: true,
    };
    if (options?.parseMode) body.parse_mode = options.parseMode;
    if (options?.messageThreadId != null) body.message_thread_id = options.messageThreadId;

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
  options?: TelegramSendOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config) return false;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendPhoto`;
    const targetChatId = options?.chatId || config.chatId;
    const form = new FormData();
    form.append("chat_id", targetChatId);
    if (options?.messageThreadId != null) {
      form.append("message_thread_id", String(options.messageThreadId));
    }

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

export type TelegramAlbumPhoto = { photo: Blob | Buffer | Uint8Array; caption?: string };

/** Sends up to 10 photos as one album (sendMediaGroup). Returns false, sending nothing, for more. */
export async function sendTelegramMediaGroup(
  photos: TelegramAlbumPhoto[],
  options?: TelegramSendOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config || photos.length === 0 || photos.length > 10) return false;

  try {
    const url = `https://api.telegram.org/bot${config.botToken}/sendMediaGroup`;
    const form = new FormData();
    form.append("chat_id", options?.chatId || config.chatId);
    if (options?.messageThreadId != null) {
      form.append("message_thread_id", String(options.messageThreadId));
    }
    const media = photos.map((p, i) => ({
      type: "photo",
      media: `attach://photo${i}`,
      ...(p.caption ? { caption: p.caption } : {}),
    }));
    form.append("media", JSON.stringify(media));
    photos.forEach((p, i) => {
      const blob = p.photo instanceof Blob ? p.photo : new Blob([p.photo as any]);
      form.append(`photo${i}`, blob, `slip${i}.jpg`);
    });

    const res = await fetchImpl(url, { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      console.error(`Telegram sendMediaGroup failed [${res.status}]:`, err);
      return false;
    }
    return true;
  } catch (error) {
    console.error("Telegram sendMediaGroup error:", error);
    return false;
  }
}
