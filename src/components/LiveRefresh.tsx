"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Re-renders the current server page whenever matching rows change. */
export function LiveRefresh({ table, filter }: { table: string; filter?: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`refresh:${table}:${filter ?? "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, () => router.refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, filter, router]);

  return null;
}
