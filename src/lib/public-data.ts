import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase/env";
import type { ShopContact } from "./shop-contact";
import type { VenueHours } from "./venue-settings";
import { toShopContact, toVenueHours, type VenueRow } from "./venue-rows";

// Courts, opening hours and the shop contact change a few times a year, yet every
// customer page load asked the database for them. Customer pages read them from a
// short shared cache instead; bookings and occupancy are always read live.
// Admin pages keep reading the database directly so a saved setting shows at once.
const CACHE_SECONDS = 60;

export type PublicCourt = { id: number; name: string; price_per_hour: number };

// No cookies: this data is public (RLS allows anon reads), so one copy serves everyone.
const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

// Errors are thrown, never returned, so a failed read is not cached for a minute.
const cachedCourts = unstable_cache(
  async (): Promise<PublicCourt[]> => {
    const { data, error } = await anon()
      .from("courts")
      .select("id, name, price_per_hour")
      .eq("is_active", true)
      .order("id");
    if (error) throw error;
    return data;
  },
  ["public-courts"],
  { revalidate: CACHE_SECONDS },
);

const cachedVenueRow = unstable_cache(
  async (): Promise<VenueRow> => {
    // "*" keeps working before newer columns (contact_*) are migrated.
    const { data, error } = await anon().from("venue_settings").select("*").eq("id", 1).maybeSingle();
    if (error) throw error;
    return data;
  },
  ["public-venue-settings"],
  { revalidate: CACHE_SECONDS },
);

/** Active courts, or null when they could not be loaded. */
export async function getPublicCourts(): Promise<PublicCourt[] | null> {
  try {
    return await cachedCourts();
  } catch (error) {
    console.error("Failed to load courts:", error);
    return null;
  }
}

export async function getPublicVenueHours(): Promise<VenueHours> {
  try {
    return toVenueHours(await cachedVenueRow());
  } catch (error) {
    console.error("Failed to fetch venue hours:", error);
    return toVenueHours(null);
  }
}

export async function getPublicShopContact(): Promise<ShopContact> {
  try {
    return toShopContact(await cachedVenueRow());
  } catch (error) {
    console.error("Failed to load shop contact:", error);
    return toShopContact(null);
  }
}
