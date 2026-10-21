import { BOOKING_RULES } from "./config";
import type { ShopContact } from "./shop-contact";
import type { VenueHours } from "./venue-settings";

export type VenueRow = Record<string, unknown> | null;

/** Opening hours from a venue_settings row, falling back to the built-in hours. */
export function toVenueHours(row: VenueRow): VenueHours {
  if (row && row.open_hour != null && row.close_hour != null) {
    return { openHour: Number(row.open_hour), closeHour: Number(row.close_hour) };
  }
  return { openHour: BOOKING_RULES.openHour, closeHour: BOOKING_RULES.closeHour };
}

/** Shop contact from a venue_settings row; empty fields when not set (or not migrated yet). */
export function toShopContact(row: VenueRow): ShopContact {
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { name: text(row?.contact_name), phone: text(row?.contact_phone), line: text(row?.contact_line) };
}
