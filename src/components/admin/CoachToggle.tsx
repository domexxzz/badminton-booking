"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCoach } from "@/app/admin-actions";

/** Coach accounts may book with "pay later" and an agreed price. */
export function CoachToggle({ userId, name, isCoach }: { userId: string; name: string; isCoach: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const question = isCoach
      ? `ถอนสิทธิ์โค้ชของ ${name}? จะกลับไปจองแบบจ่ายทันทีราคาปกติ`
      : `ให้ ${name} เป็นโค้ช? จะจองแบบชำระภายหลังและใส่ราคาตกลงเองได้`;
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const result = await setCoach(userId, !isCoach);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <button type="button" className={`btn btn-sm ${isCoach ? "" : "btn-ghost"}`} onClick={toggle} disabled={pending}>
        {pending ? "…" : isCoach ? "🏅 โค้ช" : "ตั้งเป็นโค้ช"}
      </button>
      {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
