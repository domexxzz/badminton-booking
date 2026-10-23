import { describe, expect, test } from "vitest";
import { pickSlipProvider } from "../src/lib/slip/provider";

describe("pickSlipProvider", () => {
  // EasySlip reads the bank's own record; Typhoon is an LLM reading the image and an
  // edited picture can fool it. With both keys set, EasySlip must win.
  test("prefers EasySlip when both keys are set", () => {
    expect(pickSlipProvider({ EASYSLIP_API_KEY: "e", TYPHOON_API_KEY: "t" })).toBe("easyslip");
  });

  test("falls back to Typhoon only when EasySlip is not configured", () => {
    expect(pickSlipProvider({ TYPHOON_API_KEY: "t" })).toBe("typhoon");
    expect(pickSlipProvider({ EASYSLIP_API_KEY: "   ", TYPHOON_API_KEY: "t" })).toBe("typhoon");
  });

  test("checks nothing when neither key is set", () => {
    expect(pickSlipProvider({})).toBe(null);
    expect(pickSlipProvider({ EASYSLIP_API_KEY: "", TYPHOON_API_KEY: "  " })).toBe(null);
  });
});
