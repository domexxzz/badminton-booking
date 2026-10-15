import { describe, expect, test, vi } from "vitest";
import { buildAuthorizeUrl, exchangeCode, verifyIdToken, type LineLoginConfig } from "../src/lib/line/login";
import {
  bookingConfirmedText,
  sanitizeName,
  slipNeedsReviewText,
  unmatchedTransferText,
} from "../src/lib/line/messages";
import { multicastText } from "../src/lib/line/messaging";

const CONFIG: LineLoginConfig = {
  channelId: "1234567890",
  channelSecret: "secret",
  redirectUri: "https://court.example.com/auth/line/callback",
};
const USER_ID = `U${"a1".repeat(16)}`;

const jsonResponse = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("LINE Login", () => {
  test("builds the authorization URL with state, nonce and openid scope", () => {
    const url = new URL(buildAuthorizeUrl({ ...CONFIG, botPrompt: "aggressive" }, "st4te", "n0nce"));
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: CONFIG.channelId,
      redirect_uri: CONFIG.redirectUri,
      state: "st4te",
      scope: "profile openid",
      nonce: "n0nce",
      bot_prompt: "aggressive",
    });
  });

  test("ignores an unknown bot_prompt value", () => {
    const url = new URL(buildAuthorizeUrl({ ...CONFIG, botPrompt: "spam" }, "s", "n"));
    expect(url.searchParams.has("bot_prompt")).toBe(false);
  });

  test("exchanges the code with the channel secret", async () => {
    const fetchImpl = jsonResponse(200, { access_token: "a", id_token: "id.tok.en" });
    expect(await exchangeCode(CONFIG, "the-code", fetchImpl)).toBe("id.tok.en");

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/oauth2/v2.1/token");
    const form = new URLSearchParams(init.body as URLSearchParams);
    expect(form.get("code")).toBe("the-code");
    expect(form.get("client_secret")).toBe("secret");
    expect(form.get("redirect_uri")).toBe(CONFIG.redirectUri);
  });

  test("fails when the token exchange fails", async () => {
    await expect(exchangeCode(CONFIG, "bad", jsonResponse(400, { error: "invalid_grant" }))).rejects.toThrow();
  });

  test("returns the verified profile", async () => {
    const fetchImpl = jsonResponse(200, { sub: USER_ID, aud: CONFIG.channelId, nonce: "n", name: "สมชาย", picture: "https://p" });
    expect(await verifyIdToken(CONFIG, "id", "n", fetchImpl)).toEqual({ userId: USER_ID, name: "สมชาย", picture: "https://p" });
    const form = new URLSearchParams((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams);
    expect(form.get("nonce")).toBe("n");
  });

  test("rejects tokens LINE refuses or that do not match our channel and nonce", async () => {
    await expect(verifyIdToken(CONFIG, "id", "n", jsonResponse(400, { error: "invalid_request" }))).rejects.toThrow();
    await expect(
      verifyIdToken(CONFIG, "id", "n", jsonResponse(200, { sub: USER_ID, aud: "999", nonce: "n" })),
    ).rejects.toThrow("audience");
    await expect(
      verifyIdToken(CONFIG, "id", "n", jsonResponse(200, { sub: USER_ID, aud: CONFIG.channelId, nonce: "other" })),
    ).rejects.toThrow("nonce");
    await expect(
      verifyIdToken(CONFIG, "id", "n", jsonResponse(200, { sub: "not-a-line-id", aud: CONFIG.channelId, nonce: "n" })),
    ).rejects.toThrow("user id");
  });
});

describe("LINE messaging", () => {
  test("multicasts a text message with the channel token", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await multicastText("tok", [USER_ID, USER_ID], "hello", fetchImpl)).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/bot/message/multicast");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body as string)).toEqual({ to: [USER_ID], messages: [{ type: "text", text: "hello" }] });
  });

  test("does nothing without a token or recipients", async () => {
    const fetchImpl = vi.fn();
    expect(await multicastText("", [USER_ID], "x", fetchImpl)).toBe(false);
    expect(await multicastText("tok", [], "x", fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("splits more than 500 recipients into several requests", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const ids = Array.from({ length: 501 }, (_, i) => `U${i.toString(16).padStart(32, "0")}`);
    await multicastText("tok", ids, "x", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("never throws when LINE is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await multicastText("tok", [USER_ID], "x", down)).toBe(false);
    expect(await multicastText("tok", [USER_ID], "x", vi.fn(async () => new Response("no", { status: 429 })))).toBe(false);
  });
});

describe("shop messages", () => {
  const booking = {
    court: "สนาม 2",
    startsAt: "2026-10-20T11:00:00Z",
    endsAt: "2026-10-20T13:00:00Z",
    amount: 260,
    customer: "สมชาย",
    channel: "online",
  };

  test("describe the booking", () => {
    const text = bookingConfirmedText(booking);
    expect(text).toContain("สนาม 2");
    expect(text).toContain("18:00–20:00");
    expect(text).toContain("฿260");
  });

  test("list review reasons", () => {
    expect(slipNeedsReviewText(booking, ["ยอดไม่ตรง"])).toContain("• ยอดไม่ตรง");
  });

  test("strip links and newlines from customer names", () => {
    expect(sanitizeName("สมชาย\nโอนคืนที่ https://evil.example/x")).toBe("สมชาย โอนคืนที่ [ลิงก์]");
    expect(sanitizeName("ติดต่อ evil.example ด่วน")).toBe("ติดต่อ [ลิงก์] ด่วน");
    expect(sanitizeName("ก".repeat(60))).toHaveLength(41);
    expect(sanitizeName("   ")).toBe("ลูกค้า");
  });

  test("handle an unreadable amount", () => {
    expect(unmatchedTransferText(null)).toContain("อ่านยอดไม่ได้");
    expect(unmatchedTransferText(260)).toContain("฿260");
  });
});
