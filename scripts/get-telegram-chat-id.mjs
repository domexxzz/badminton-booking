import fs from "node:fs";
import path from "node:path";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8827549262:AAGt7aDuc0jF8sYPSrZLZIh4ee5gwcvtAyg";

async function main() {
  console.log("Checking Telegram updates for bot...");
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
  const data = await res.json();

  if (!data.ok) {
    console.error("Telegram API error:", data);
    process.exit(1);
  }

  const updates = data.result || [];
  if (updates.length === 0) {
    console.log("No messages found yet.");
    console.log("Please make sure:");
    console.log("1. Add @sinthanee_bot to your Telegram group (https://t.me/+QRPdrWxHBuo2NDg1)");
    console.log("2. Type a message in the group (e.g. 'hello' or '/start')");
    console.log("3. Run this script again.");
    return;
  }

  // Find group or supergroup
  const chats = new Map();
  for (const u of updates) {
    const chat = u.message?.chat || u.my_chat_member?.chat || u.channel_post?.chat;
    if (chat && !chats.has(chat.id)) {
      chats.set(chat.id, chat);
    }
  }

  console.log(`Found ${chats.size} chat(s):`);
  let targetChatId = null;

  for (const [id, chat] of chats.entries()) {
    console.log(`- Chat ID: ${id} | Title: "${chat.title || chat.username || 'Direct'}" | Type: ${chat.type}`);
    if (chat.type === "group" || chat.type === "supergroup") {
      targetChatId = id;
    }
  }

  if (targetChatId) {
    console.log(`\nDetected Group Chat ID: ${targetChatId}`);
    const envPath = path.resolve(process.cwd(), ".env.local");
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";

    if (!content.includes("TELEGRAM_BOT_TOKEN=")) {
      content += `\nTELEGRAM_BOT_TOKEN=${BOT_TOKEN}`;
    }
    if (!content.includes("TELEGRAM_CHAT_ID=")) {
      content += `\nTELEGRAM_CHAT_ID=${targetChatId}`;
    } else {
      content = content.replace(/TELEGRAM_CHAT_ID=.*/g, `TELEGRAM_CHAT_ID=${targetChatId}`);
    }

    fs.writeFileSync(envPath, content.trim() + "\n", "utf8");
    console.log("Saved TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env.local!");
  }
}

main().catch(console.error);
