"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setAdmin } from "@/app/admin-actions";

export function AdminToggle({ userId, name, isAdmin }: { userId: string; name: string; isAdmin: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const question = isAdmin ? `ถอนสิทธิ์แอดมินของ ${name}?` : `ให้ ${name} เป็นแอดมิน? จะเห็นข้อมูลลูกค้าและรายรับทั้งหมด`;
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const result = await setAdmin(userId, !isAdmin);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <button
        type="button"
        className={`btn btn-sm ${isAdmin ? "btn-ghost" : ""}`}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "…" : isAdmin ? "ถอนแอดมิน" : "ตั้งเป็นแอดมิน"}
      </button>
      {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
