import { describe, expect, test } from "vitest";
import { BOOKING_RULES } from "../src/lib/config";
import { toShopContact, toVenueHours } from "../src/lib/venue-rows";

describe("toVenueHours", () => {
  test("reads the hours set by the admin", () => {
    expect(toVenueHours({ open_hour: 8, close_hour: "22" })).toEqual({ openHour: 8, closeHour: 22 });
  });

  test("falls back to the built-in hours when the row or a column is missing", () => {
    const fallback = { openHour: BOOKING_RULES.openHour, closeHour: BOOKING_RULES.closeHour };
    expect(toVenueHours(null)).toEqual(fallback);
    expect(toVenueHours({ open_hour: 8, close_hour: null })).toEqual(fallback);
  });
});

describe("toShopContact", () => {
  test("reads the contact fields", () => {
    expect(toShopContact({ contact_name: "แอดมิน", contact_phone: "0812345678", contact_line: "@shop" })).toEqual({
      name: "แอดมิน",
      phone: "0812345678",
      line: "@shop",
    });
  });

  test("treats missing, empty or not-yet-migrated columns as not set", () => {
    const empty = { name: null, phone: null, line: null };
    expect(toShopContact(null)).toEqual(empty);
    expect(toShopContact({ id: 1 })).toEqual(empty);
    expect(toShopContact({ contact_name: "", contact_phone: null, contact_line: "" })).toEqual(empty);
  });
});
