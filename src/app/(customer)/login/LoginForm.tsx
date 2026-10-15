"use client";

import { useActionState } from "react";
import { signInWithEmail } from "@/app/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInWithEmail, null);

  if (state === "sent") {
    return <p>ส่งลิงก์ไปที่อีเมลแล้ว เปิดอีเมลแล้วกดลิงก์เพื่อเข้าสู่ระบบ</p>;
  }

  return (
    <form action={action} className="stack" style={{ marginTop: 16 }}>
      <input type="hidden" name="next" value={next} />
      <input type="email" name="email" required placeholder="you@example.com" autoComplete="email" />
      {state && <p className="error">{state}</p>}
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "กำลังส่ง…" : "ส่งลิงก์เข้าสู่ระบบ"}
      </button>
    </form>
  );
}
