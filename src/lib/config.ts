// Keep customer-facing limits in sync with the latest booking migration.
export const BOOKING_RULES = {
  venueName: "แบดมินตัน@สินธานี",
  openHour: 9,
  closeHour: 23,
  stepMinutes: 30,
  minHours: 0.5,
  // The venue's opening/closing hours and occupied slots are the real limit.
  maxHours: 24,
  maxDaysAhead: 7,
  holdMinutes: 5,
  // NOT the price anyone is charged. Every bill is computed from courts.price_per_hour in
  // the database (live: ฿130/hour), by create_booking() and friends, and every page shows
  // that column too — nothing reads the two numbers below. They are kept only as the value
  // migration 0008 set, so changing them changes no price. Change the court rows instead.
  pricePerHalfHour: 75,
  pricePerHour: 150,
} as const;

export const BANGKOK_OFFSET = "+07:00";
export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

export const SLIP_MAX_BYTES = 4 * 1024 * 1024; // EasySlip limit
export const SLIP_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
