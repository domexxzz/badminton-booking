"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { applyOccupancyChange, slotStart, type Occupancy, type OccupancyChange } from "@/lib/slots";

/**
 * Loads one day's occupancy and keeps it in sync via Supabase Realtime.
 * Events that arrive while the snapshot is loading are buffered and replayed
 * on top of it, so a change can't be lost between fetch and subscribe.
 */
export function useOccupancy(date: string) {
  const [occupancy, setOccupancy] = useState<Occupancy[]>([]);
  const [live, setLive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The date whose snapshot has arrived: until it matches `date`, the list is not that day's yet.
  const [loadedDate, setLoadedDate] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    const from = slotStart(date, 0);
    const to = slotStart(date, 24);
    let cancelled = false;
    let buffer: OccupancyChange[] | null = null; // non-null while a load is in flight

    const channel = supabase
      .channel(`occupancy:${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "court_occupancy" }, (payload) => {
        const change = payload as unknown as OccupancyChange;
        if (buffer) buffer = [...buffer, change];
        else setOccupancy((list) => applyOccupancyChange(list, change));
      })
      .subscribe((status) => {
        if (cancelled) return;
        setLive(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void load(); // also re-syncs after a reconnect
      });

    async function load() {
      buffer = [];
      const { data, error } = await supabase
        .from("court_occupancy")
        .select("*")
        .lt("starts_at", to)
        .gt("ends_at", from);
      const pending = buffer;
      buffer = null;
      if (cancelled) return;
      if (error) {
        console.error("Failed to load occupancy:", error);
        setLoadError("โหลดตารางไม่สำเร็จ กรุณารีเฟรช");
        return;
      }
      setLoadError(null);
      setOccupancy(pending.reduce(applyOccupancyChange, data as Occupancy[]));
      setLoadedDate(date);
    }

    return () => {
      cancelled = true;
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [date]);

  return { occupancy, live, loadError, loaded: loadedDate === date };
}
