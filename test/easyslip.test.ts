import { describe, expect, test, vi } from "vitest";
import { parseRawSlip, verifyWithEasySlip } from "../src/lib/slip/easyslip";

// Shape taken from https://document.easyslip.com/en/v2/verify/bank
const RAW_SLIP = {
  payload: "0000",
  transRef: "68370160657749I376388B35",
  date: "2024-01-15T14:30:00+07:00",
  countryCode: "TH",
  amount: { amount: 1500, local: { amount: 1500, currency: "THB" } },
  fee: 0,
  sender: { bank: { id: "004", name: "กสิกรไทย", short: "KBANK" }, account: { name: { th: "นาย ผู้โอน" } } },
  receiver: {
    bank: { id: "014", name: "ไทยพาณิชย์", short: "SCB" },
    account: {
      name: { th: "บริษัท ตัวอย่าง จำกัด" },
      bank: { type: "BANKAC", account: "xxx-x-x5678-x" },
      proxy: { type: "MSISDN", account: "08xxxxxxxx89" },
    },
    merchantId: null,
  },
};

const respond = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const image = new Blob(["fake"], { type: "image/jpeg" });

describe("parseRawSlip", () => {
  test("extracts the fields we verify", () => {
    expect(parseRawSlip(RAW_SLIP)).toEqual({
      transRef: "68370160657749I376388B35",
      amount: 1500,
      date: "2024-01-15T14:30:00+07:00",
      receiver: {
        names: ["บริษัท ตัวอย่าง จำกัด"],
        bankAccount: "xxx-x-x5678-x",
        proxyType: "MSISDN",
        proxyAccount: "08xxxxxxxx89",
      },
    });
  });

  test("tolerates a missing proxy and English-only name", () => {
    const raw = {
      ...RAW_SLIP,
      receiver: { account: { name: { en: "SHOP" }, bank: { type: "BANKAC", account: "xxx-x-x5678-x" } } },
    };
    expect(parseRawSlip(raw)?.receiver).toEqual({
      names: ["SHOP"],
      bankAccount: "xxx-x-x5678-x",
      proxyType: null,
      proxyAccount: null,
    });
  });

  test("treats a date without an offset as Bangkok time", () => {
    expect(parseRawSlip({ ...RAW_SLIP, date: "2024-01-15T14:30:00" })?.date).toBe("2024-01-15T14:30:00+07:00");
  });

  test("rejects data missing required fields", () => {
    expect(parseRawSlip({ ...RAW_SLIP, transRef: "" })).toBeNull();
    expect(parseRawSlip({ ...RAW_SLIP, amount: { amount: "1500" } })).toBeNull();
    expect(parseRawSlip(null)).toBeNull();
  });
});

describe("verifyWithEasySlip", () => {
  test("sends the image with a bearer token and returns the slip", async () => {
    const fetchImpl = respond(200, { success: true, data: { isDuplicate: false, rawSlip: RAW_SLIP }, message: "ok" });

    const result = await verifyWithEasySlip(image, "key-123", fetchImpl);

    expect(result.kind).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.easyslip.com/v2/verify/bank");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer key-123");
    expect((init.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  test("maps SLIP_NOT_FOUND to unreadable so the customer can re-upload", async () => {
    const result = await verifyWithEasySlip(
      image,
      "k",
      respond(404, { success: false, error: { code: "SLIP_NOT_FOUND", message: "x" } }),
    );
    expect(result.kind).toBe("unreadable");
  });

  test("maps quota and pending errors to error so a human reviews", async () => {
    for (const code of ["QUOTA_EXCEEDED", "SLIP_PENDING", "API_SERVER_ERROR"]) {
      const result = await verifyWithEasySlip(image, "k", respond(403, { success: false, error: { code, message: "x" } }));
      expect(result.kind).toBe("error");
    }
  });

  test("handles network failures and non-JSON bodies", async () => {
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await verifyWithEasySlip(image, "k", down)).kind).toBe("error");

    const html = vi.fn(async () => new Response("<html>502</html>", { status: 502 }));
    expect((await verifyWithEasySlip(image, "k", html)).kind).toBe("error");
  });

  test("treats a success response with a malformed slip as an error", async () => {
    const result = await verifyWithEasySlip(image, "k", respond(200, { success: true, data: { rawSlip: {} } }));
    expect(result.kind).toBe("error");
  });
});
