"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setLeaderboardVisibility } from "@/app/player-actions";

/** Puts the player on the shop's ladder, or takes them off it (migration 0030). */
export function LeaderboardVisibility({ listed }: { listed: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    setError(null);
    startTransition(async () => {
      const result = await setLeaderboardVisibility(!listed);
      if (!result.ok) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <div className="player-visibility">
      <div>
        <strong>{listed ? "ชื่อของคุณอยู่บนตารางอันดับ" : "คุณไม่อยู่บนตารางอันดับ"}</strong>
        <small>
          {listed
            ? "ผู้เล่นที่เข้าสู่ระบบจะเห็นชื่อ รูป และแต้มของคุณ"
            : "ยังเก็บแต้มให้ตามปกติ แค่ไม่แสดงชื่อให้คนอื่นเห็น"}
        </small>
      </div>
      <button type="button" className="btn btn-sm btn-ghost" disabled={pending} onClick={toggle}>
        {pending ? "กำลังบันทึก…" : listed ? "ขอไม่แสดงชื่อ" : "ขอขึ้นตาราง"}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
