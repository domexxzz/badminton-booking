import { describe, expect, test } from "vitest";
import { publicOrigin } from "../src/lib/site-url";

describe("publicOrigin", () => {
  test("prefers the configured public URL over what a tunnel reports", () => {
    expect(publicOrigin("https://localhost:3000/auth/line/callback", "https://abc.trycloudflare.com"))
      .toBe("https://abc.trycloudflare.com");
  });

  test("drops any path on the configured URL", () => {
    expect(publicOrigin("http://x/y", "https://badminton-booking-steel.vercel.app/")).toBe(
      "https://badminton-booking-steel.vercel.app",
    );
  });

  test("falls back to the request origin when nothing usable is configured", () => {
    expect(publicOrigin("http://localhost:3000/auth/callback", undefined)).toBe("http://localhost:3000");
    expect(publicOrigin("http://localhost:3000/auth/callback", "not a url")).toBe("http://localhost:3000");
  });
});
