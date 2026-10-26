import { describe, expect, test } from "vitest";
import { formatDuration } from "../src/lib/format";

describe("formatDuration", () => {
  test.each([
    [0.5, "30 นาที"],
    [1, "1 ชม."],
    [1.5, "1 ชม. 30 นาที"],
    [2, "2 ชม."],
    [3.5, "3 ชม. 30 นาที"],
  ])("%s hours reads as %s", (hours, text) => {
    expect(formatDuration(hours)).toBe(text);
  });
});
