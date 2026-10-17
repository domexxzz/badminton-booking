import { BOOKING_RULES } from "./config";
import { createClient } from "./supabase/server";

export type VenueHours = {
  openHour: number;
  closeHour: number;
};

export async function getVenueHours(): Promise<VenueHours> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("venue_settings")
      .select("open_hour, close_hour")
      .eq("id", 1)
      .maybeSingle();

    if (data && data.open_hour !== null && data.close_hour !== null) {
      return {
        openHour: Number(data.open_hour),
        closeHour: Number(data.close_hour),
      };
    }
  } catch (err) {
    console.error("Failed to fetch venue hours:", err);
  }

  return {
    openHour: BOOKING_RULES.openHour,
    closeHour: BOOKING_RULES.closeHour,
  };
}
