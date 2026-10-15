"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function Countdown({ until }: { until: string }) {
  const router = useRouter();
  const deadline = Date.parse(until);
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const id = setInterval(() => {
      const ms = Math.max(0, deadline - Date.now());
      setLeft(ms);
      if (ms === 0) {
        clearInterval(id);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [deadline, router]);

  const minutes = Math.floor(left / 60_000);
  const seconds = Math.floor((left % 60_000) / 1000);
  return (
    <span className="countdown">
      {minutes}:{seconds.toString().padStart(2, "0")}
    </span>
  );
}
