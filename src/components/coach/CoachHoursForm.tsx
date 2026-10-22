"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setCoachAvailability } from "@/app/coach-actions";
import {
  formatMinute,
  isValidSlot,
  parseMinute,
  WEEKDAY_LABELS,
  type AvailabilitySlot,
} from "@/lib/coach";

const MAX_SLOTS = 28;
const DEFAULT_SLOT = { start_minute: 17 * 60, end_minute: 21 * 60 };

/** The coach's weekly hours. Saving replaces the whole week in one call. */
export function CoachHoursForm({ userId, initial }: { userId: string; initial: AvailabilitySlot[] }) {
  const router = useRouter();
  const [slots, setSlots] = useState<AvailabilitySlot[]>(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const addSlot = (weekday: number) =>
    setSlots((list) => (list.length >= MAX_SLOTS ? list : [...list, { weekday, ...DEFAULT_SLOT }]));

  const removeSlot = (index: number) => setSlots((list) => list.filter((_, i) => i !== index));

  const editSlot = (index: number, key: "start_minute" | "end_minute", value: string) => {
    const minute = parseMinute(value);
    if (minute === null) return;
    setSlots((list) => list.map((s, i) => (i === index ? { ...s, [key]: minute } : s)));
  };

  function save() {
    setError(null);
    setMessage(null);
    const invalid = slots.find((s) => !isValidSlot(s));
    if (invalid) {
      setError(`ช่วงเวลา ${WEEKDAY_LABELS[invalid.weekday]} ไม่ถูกต้อง เวลาจบต้องหลังเวลาเริ่ม`);
      return;
    }
    startTransition(async () => {
      const result = await setCoachAvailability(userId, slots);
      if (!result.ok) return setError(result.error);
      setMessage("บันทึกตารางสอนแล้ว");
      router.refresh();
    });
  }

  return (
    <section className="card stack">
      <h2>ตารางสอนประจำสัปดาห์</h2>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        ลูกค้าจะจองได้เฉพาะในช่วงนี้ และต้องมีสนามว่างด้วย เวลาเป็นช่วงครึ่งชั่วโมง
      </p>

      {WEEKDAY_LABELS.map((label, weekday) => {
        const indexes = slots.map((s, i) => ({ slot: s, i })).filter(({ slot }) => slot.weekday === weekday);
        return (
          <div key={weekday} className="coach-hours-day">
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <strong>{label}</strong>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => addSlot(weekday)} disabled={pending}>
                + เพิ่มช่วงเวลา
              </button>
            </div>
            {indexes.length === 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>ไม่สอน</span>
            ) : (
              indexes.map(({ slot, i }) => (
                <div key={i} className="coach-hours-row">
                  <input
                    type="time"
                    step={1800}
                    max="23:30"
                    value={formatMinute(slot.start_minute)}
                    onChange={(e) => editSlot(i, "start_minute", e.target.value)}
                    aria-label={`เวลาเริ่มสอนวัน${label}`}
                  />
                  <span className="muted">ถึง</span>
                  {/* A slot ending at midnight has no time-input value; show it and let it be deleted. */}
                  {slot.end_minute === 1440 ? (
                    <span>24:00</span>
                  ) : (
                    <input
                      type="time"
                      step={1800}
                      max="23:30"
                      value={formatMinute(slot.end_minute)}
                      onChange={(e) => editSlot(i, "end_minute", e.target.value)}
                      aria-label={`เวลาจบการสอนวัน${label}`}
                    />
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => removeSlot(i)}
                    disabled={pending}
                    aria-label={`ลบช่วงเวลาวัน${label}`}
                  >
                    ลบ
                  </button>
                </div>
              ))
            )}
          </div>
        );
      })}

      <button type="button" className="btn btn-block" onClick={save} disabled={pending}>
        {pending ? "กำลังบันทึก…" : "บันทึกตารางสอน"}
      </button>
      {message && <p className="muted" style={{ margin: 0 }}>{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
