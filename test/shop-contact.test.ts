import { describe, expect, test } from "vitest";
import { formatPhone, lineUrl } from "../src/lib/contact-format";

describe("formatPhone", () => {
  test("formats mobile and landline numbers", () => {
    expect(formatPhone("0829457278")).toBe("082-945-7278");
    expect(formatPhone("021234567")).toBe("02-123-4567");
  });
});

describe("lineUrl", () => {
  test("turns a personal LINE ID into an add-friend link", () => {
    expect(lineUrl("akkanay.b")).toBe("https://line.me/ti/p/~akkanay.b");
  });

  test("turns an official account into its link", () => {
    expect(lineUrl("@sinthani")).toBe("https://line.me/R/ti/p/%40sinthani");
  });

  test("keeps a pasted LINE link as it is", () => {
    expect(lineUrl("https://lin.ee/AbC123")).toBe("https://lin.ee/AbC123");
  });
});
