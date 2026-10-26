"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { applyOccupancyChange, slotStart, type Occupancy, type OccupancyChange } from "@/lib/slots";

/**
 * Loads one day's occupancy and keeps it in sync via Supabase Realtime.
 *
 * The snapshot is fetched straight away, not only once the Realtime channel is
 * subscribed: on a slow connection subscribing can take many seconds, and the page
 * should not wait for it to show the day. It is fetched again on every subscribe,
 * which also re-syncs after a reconnect. Events that arrive while a snapshot is in
 * flight are kept and replayed on top of it, so a change can't be lost between fetch
 * and subscribe; applying a change twice is harmless (it is keyed by booking).
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
    // One buffer per snapshot in flight; two can overlap (the first fetch and the one on subscribe).
    const buffers = new Set<OccupancyChange[]>();
    let started = 0;
    let applied = 0;

    const channel = supabase
      .channel(`occupancy:${date}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "court_occupancy" }, (payload) => {
        const change = payload as unknown as OccupancyChange;
        buffers.forEach((b) => b.push(change));
        setOccupancy((list) => applyOccupancyChange(list, change));
      })
      .subscribe((status) => {
        if (cancelled) return;
        setLive(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void load();
      });

    async function load() {
      const mine = ++started;
      const pending: OccupancyChange[] = [];
      buffers.add(pending);
      const { data, error } = await supabase
        .from("court_occupancy")
        .select("*")
        .lt("starts_at", to)
        .gt("ends_at", from);
      buffers.delete(pending);
      // A snapshot that started earlier than one already shown is older: drop it.
      if (cancelled || mine < applied) return;
      if (error) {
        console.error("Failed to load occupancy:", error);
        setLoadError("โหลดตารางไม่สำเร็จ กรุณารีเฟรช");
        return;
      }
      applied = mine;
      setLoadError(null);
      setOccupancy(pending.reduce(applyOccupancyChange, data as Occupancy[]));
      setLoadedDate(date);
    }

    void load();

    return () => {
      cancelled = true;
      setLive(false);
      void supabase.removeChannel(channel);
    };
  }, [date]);

  return { occupancy, live, loadError, loaded: loadedDate === date };
}
