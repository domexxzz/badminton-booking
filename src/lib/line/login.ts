// LINE Login v2.1 (web). https://developers.line.biz/en/docs/line-login/integrate-line-login/
// We never trust the ID token ourselves: LINE's verify endpoint checks the
// signature, issuer, audience, expiry and nonce for us.

const AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const REQUEST_TIMEOUT_MS = 10_000;

export type LineLoginConfig = {
  channelId: string;
  channelSecret: string;
  redirectUri: string;
  /** "normal" | "aggressive": offer to add the shop's LINE OA as a friend while logging in. */
  botPrompt?: string;
};

export type LineProfile = { userId: string; name: string | null; picture: string | null };

export function buildAuthorizeUrl(config: LineLoginConfig, state: string, nonce: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.channelId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "profile openid");
  url.searchParams.set("nonce", nonce);
  if (config.botPrompt === "normal" || config.botPrompt === "aggressive") {
    url.searchParams.set("bot_prompt", config.botPrompt);
  }
  return url.toString();
}

async function postForm(url: string, form: Record<string, string>, fetchImpl: typeof fetch): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`LINE ${new URL(url).pathname} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

const field = (obj: unknown, key: string): unknown =>
  typeof obj === "object" && obj !== null ? (obj as Record<string, unknown>)[key] : undefined;
const optionalString = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);

/** Exchanges the authorization code for an ID token. */
export async function exchangeCode(
  config: LineLoginConfig,
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = await postForm(
    TOKEN_URL,
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.channelId,
      client_secret: config.channelSecret,
    },
    fetchImpl,
  );
  const idToken = field(body, "id_token");
  if (typeof idToken !== "string" || !idToken) throw new Error("LINE token response has no id_token");
  return idToken;
}

/** Asks LINE to verify the ID token (signature, audience, expiry, nonce) and returns the user. */
export async function verifyIdToken(
  config: LineLoginConfig,
  idToken: string,
  nonce: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LineProfile> {
  const payload = await postForm(VERIFY_URL, { id_token: idToken, client_id: config.channelId, nonce }, fetchImpl);
  const sub = field(payload, "sub");
  // Belt and braces: LINE already checked these, but a mismatch here must never log anyone in.
  if (typeof sub !== "string" || !/^U[0-9a-f]{32}$/.test(sub)) throw new Error("LINE ID token has no valid user id");
  if (field(payload, "aud") !== config.channelId) throw new Error("LINE ID token audience mismatch");
  if (field(payload, "nonce") !== nonce) throw new Error("LINE ID token nonce mismatch");
  return { userId: sub, name: optionalString(field(payload, "name")), picture: optionalString(field(payload, "picture")) };
}
