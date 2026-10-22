"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { saveCoachProfile } from "@/app/coach-actions";
import { COACH_BIO_MAX, COACH_NAME_MAX, LESSON_PRICE_MAX } from "@/lib/coach";

export type CoachProfile = {
  display_name: string;
  bio: string | null;
  lesson_price_per_hour: number;
  is_listed: boolean;
};

export function CoachProfileForm({
  userId,
  profile,
  fallbackName,
}: {
  userId: string;
  profile: CoachProfile | null;
  fallbackName: string;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(profile?.display_name ?? fallbackName);
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [price, setPrice] = useState(String(profile?.lesson_price_per_hour ?? 300));
  const [isListed, setIsListed] = useState(profile?.is_listed ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await saveCoachProfile({
        userId,
        displayName,
        bio,
        pricePerHour: Math.round(Number(price)),
        isListed,
      });
      if (!result.ok) return setError(result.error);
      setMessage("บันทึกแล้ว");
      router.refresh();
    });
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <h2>ข้อมูลโค้ชของคุณ</h2>
      <label className="field">
        <span>ชื่อที่ลูกค้าเห็น</span>
        <input
          type="text"
          value={displayName}
          maxLength={COACH_NAME_MAX}
          onChange={(e) => setDisplayName(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>แนะนำตัวสั้นๆ (ไม่ใส่ก็ได้)</span>
        <textarea
          value={bio}
          maxLength={COACH_BIO_MAX}
          rows={3}
          onChange={(e) => setBio(e.target.value)}
          placeholder="เช่น สอนพื้นฐานถึงระดับแข่ง รับเด็กอายุ 8 ปีขึ้นไป"
        />
      </label>
      <label className="field">
        <span>ค่าเรียนต่อชั่วโมง (บาท, ไม่รวมค่าสนาม)</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={LESSON_PRICE_MAX}
          step={1}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          required
        />
      </label>
      <label className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
        <span style={{ flex: 1 }}>
          <strong>เปิดรับสอน</strong>
          <br />
          <span className="muted" style={{ fontSize: 13 }}>
            เปิดไว้ลูกค้าจะเห็นชื่อคุณในหน้า “เรียนกับโค้ช” และจองได้
          </span>
        </span>
        <input
          type="checkbox"
          checked={isListed}
          onChange={(e) => setIsListed(e.target.checked)}
          style={{ width: 22, height: 22 }}
        />
      </label>
      <button className="btn btn-block" type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก…" : "บันทึก"}
      </button>
      {message && <p className="muted" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
