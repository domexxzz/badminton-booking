import { createClient } from "./supabase/server";

export type ShopContact = {
  name: string | null;
  phone: string | null;
  line: string | null;
};

const EMPTY: ShopContact = { name: null, phone: null, line: null };

/** Admin contact for customer questions; empty fields when not set (or not migrated yet). */
export async function getShopContact(): Promise<ShopContact> {
  try {
    const supabase = await createClient();
    // "*" keeps working before the contact columns exist.
    const { data } = await supabase.from("venue_settings").select("*").eq("id", 1).maybeSingle();
    if (!data) return EMPTY;
    return {
      name: data.contact_name ?? null,
      phone: data.contact_phone ?? null,
      line: data.contact_line ?? null,
    };
  } catch (error) {
    console.error("Failed to load shop contact:", error);
    return EMPTY;
  }
}
