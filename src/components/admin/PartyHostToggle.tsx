"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPartyHost } from "@/app/admin-actions";

/** Party host accounts may create and host party queue rooms. */
export function PartyHostToggle({ userId, name, isPartyHost }: { userId: string; name: string; isPartyHost: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle() {
    const question = isPartyHost
      ? `ถอนสิทธิ์การตั้งก๊วนของ ${name}?`
      : `เปิดสิทธิ์ให้ ${name} สามารถตั้งห้องก๊วนได้? (สำหรับลูกค้าที่ติดต่อทางร้าน)`;
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const result = await setPartyHost(userId, !isPartyHost);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "grid", justifyItems: "end", gap: 4 }}>
      <button
        type="button"
        className={`btn btn-sm ${isPartyHost ? "" : "btn-ghost"}`}
        style={isPartyHost ? { background: "var(--primary-strong)", color: "#fff" } : {}}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "…" : isPartyHost ? "🏸 หัวหน้าก๊วน" : "ตั้งเป็นหัวหน้าก๊วน"}
      </button>
      {error && <span className="error" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  );
}
