"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminCreateBooking, type AdminBookingInput } from "@/app/actions";
import { BOOKING_RULES } from "@/lib/config";
import { CHANNEL_LABEL, formatBaht } from "@/lib/format";
import { formatHour, openingSlots } from "@/lib/slots";

type Court = { id: number; name: string; price_per_hour: number };

const emptyForm = (date: string, courtId: number): AdminBookingInput => ({
  courtId,
  date,
  hour: BOOKING_RULES.openHour,
  hours: 1,
  channel: "phone",
  name: "",
  phone: "",
  note: "",
});

export function AdminBookingForm({
  courts,
  dates,
  openHour = BOOKING_RULES.openHour,
  closeHour = BOOKING_RULES.closeHour,
}: {
  courts: Court[];
  dates: string[];
  openHour?: number;
  closeHour?: number;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => emptyForm(dates[0], courts[0]?.id ?? 1));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const maxHours = Math.max(0.5, closeHour - form.hour);
  const price = courts.find((c) => c.id === form.courtId)?.price_per_hour ?? 0;
  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await adminCreateBooking({ ...form, hours: Math.min(form.hours, maxHours) });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setMessage({ ok: true, text: `บันทึกการจองของ ${form.name.trim()} แล้ว` });
      setForm(emptyForm(form.date, form.courtId));
      router.refresh();
    });
  }

  return (
    <form className="card stack" style={{ gap: 10 }} onSubmit={submit}>
      <h2 style={{ margin: 0 }}>เพิ่มการจองจากโทรศัพท์ / LINE / หน้าร้าน</h2>
      <div className="form-grid">
        <label>
          วัน
          <select value={form.date} onChange={(e) => update({ date: e.target.value })}>
            {dates.map((d) => (
              <option key={d} value={d}>
                {new Date(`${d}T12:00:00+07:00`).toLocaleDateString("th-TH", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Bangkok",
                })}
              </option>
            ))}
          </select>
        </label>
        <label>
          สนาม
          <select value={form.courtId} onChange={(e) => update({ courtId: Number(e.target.value) })}>
            {courts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          เริ่ม
          <select value={form.hour} onChange={(e) => update({ hour: Number(e.target.value) })}>
            {openingSlots(0.5, openHour, closeHour).map((h) => (
              <option key={h} value={h}>
                {formatHour(h)}
              </option>
            ))}
          </select>
        </label>
        <label>
          ระยะเวลา
          <select value={Math.min(form.hours, maxHours)} onChange={(e) => update({ hours: Number(e.target.value) })}>
            {Array.from({ length: Math.round(maxHours * 2) }, (_, i) => (i + 1) * 0.5).map((h) => (
              <option key={h} value={h}>
                {h === 0.5 ? "30 นาที" : `${h} ชม.`} (ถึง {formatHour(form.hour + h)})
              </option>
            ))}
          </select>
        </label>
        <label>
          ช่องทาง
          <select
            value={form.channel}
            onChange={(e) => update({ channel: e.target.value as AdminBookingInput["channel"] })}
          >
            {(["phone", "line", "walk_in"] as const).map((value) => (
              <option key={value} value={value}>
                {CHANNEL_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          ชื่อลูกค้า *
          <input type="text" required maxLength={100} value={form.name} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label>
          เบอร์โทร
          <input type="text" inputMode="tel" maxLength={20} value={form.phone} onChange={(e) => update({ phone: e.target.value })} />
        </label>
        <label>
          หมายเหตุ
          <input
            type="text"
            maxLength={300}
            placeholder="เช่น มัดจำแล้ว 100 / จ่ายหน้าร้าน"
            value={form.note}
            onChange={(e) => update({ note: e.target.value })}
          />
        </label>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--surface-2)", borderRadius: 8, border: "1px dashed var(--border)" }}>
        <input
          type="checkbox"
          id="is-recurring-checkbox"
          style={{ width: 18, height: 18, cursor: "pointer" }}
          checked={form.note.includes("[จองประจำ]")}
          onChange={(e) => {
            if (e.target.checked) {
              update({ note: form.note.includes("[จองประจำ]") ? form.note : `[จองประจำ] ${form.note}`.trim() });
            } else {
              update({ note: form.note.replace("[จองประจำ]", "").trim() });
            }
          }}
        />
        <label htmlFor="is-recurring-checkbox" style={{ cursor: "pointer", fontSize: 13, userSelect: "none" }}>
          <strong>🔒 ก๊วนประจำ / จองประจำ (Non-active)</strong>
          <span className="muted" style={{ display: "block", fontSize: 12 }}>
            ล็อกสล็อตนี้ไว้ในตารางคิว ลูกค้าทั่วไปจะไม่สามารถจองทับได้
          </span>
        </label>
      </div>

      <div className="row">
        <span className="muted">ราคา {formatBaht(price * Math.min(form.hours, maxHours))} · ยืนยันทันทีและขึ้นบนตารางเรียลไทม์</span>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "กำลังบันทึก…" : "บันทึกการจอง"}
        </button>
      </div>
      {message && <p className={message.ok ? "muted" : "error"}>{message.text}</p>}
    </form>
  );
}

