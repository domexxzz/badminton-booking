"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { adminCreateBooking, type AdminBookingInput, type AdminBookingItemInput } from "@/app/actions";
import { AdminSlipUploader } from "./AdminSlipUploader";
import { BOOKING_RULES } from "@/lib/config";
import { CHANNEL_LABEL, formatBaht, formatDayShort } from "@/lib/format";
import { formatHour, openingSlots } from "@/lib/slots";

type Court = { id: number; name: string; price_per_hour: number };

type AdminCartItem = AdminBookingItemInput & { key: string };

const emptyForm = (date: string, courtId: number): AdminBookingInput => ({
  courtId,
  date,
  hour: BOOKING_RULES.openHour,
  hours: 1,
  channel: "phone",
  name: "",
  phone: "",
  note: "",
  paid: true,
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
  const [cartItems, setCartItems] = useState<AdminCartItem[]>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null);
  const [createdUnpaid, setCreatedUnpaid] = useState(false);
  const [pending, startTransition] = useTransition();

  const maxHours = Math.max(0.5, closeHour - form.hour);
  const effectiveHours = Math.min(form.hours, maxHours);
  const update = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const itemPrice = (it: AdminBookingItemInput) => {
    const c = courts.find((court) => court.id === it.courtId);
    return c ? Math.round(c.price_per_hour * it.hours) : 0;
  };

  const effectiveItems: AdminCartItem[] =
    cartItems.length > 0
      ? cartItems
      : [
          {
            key: `draft-${form.date}-${form.courtId}-${form.hour}`,
            courtId: form.courtId,
            date: form.date,
            hour: form.hour,
            hours: effectiveHours,
          },
        ];

  const totalAmount = effectiveItems.reduce((sum, it) => sum + itemPrice(it), 0);

  function addCurrentToCart() {
    const key = `${form.date}-${form.courtId}-${form.hour}`;
    if (cartItems.some((it) => it.key === key)) {
      setMessage({ ok: false, text: "สนามและเวลานี้อยู่ในรายการแล้ว" });
      return;
    }
    const nextCart: AdminCartItem[] = [
      ...cartItems,
      {
        key,
        courtId: form.courtId,
        date: form.date,
        hour: form.hour,
        hours: effectiveHours,
      },
    ];
    setCartItems(nextCart);
    setMessage(null);
    const nextCourt = courts.find((c) => !nextCart.some((it) => it.courtId === c.id && it.date === form.date));
    if (nextCourt) update({ courtId: nextCourt.id });
  }

  function addAllCourtsSameTime() {
    const toAdd: AdminCartItem[] = courts
      .filter((c) => !cartItems.some((it) => it.courtId === c.id && it.date === form.date && it.hour === form.hour))
      .map((c) => ({
        key: `${form.date}-${c.id}-${form.hour}`,
        courtId: c.id,
        date: form.date,
        hour: form.hour,
        hours: effectiveHours,
      }));
    setCartItems((prev) => [...prev, ...toAdd]);
    setMessage(null);
  }

  function removeCartItem(key: string) {
    setCartItems((prev) => prev.filter((it) => it.key !== key));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setCreatedBookingId(null);
    startTransition(async () => {
      const result = await adminCreateBooking({
        ...form,
        hours: effectiveHours,
        items: effectiveItems.map(({ courtId, date, hour, hours }) => ({ courtId, date, hour, hours })),
      });
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      const summary = `${form.name.trim()} (${effectiveItems.length} รายการ · ${formatBaht(totalAmount)})`;
      setMessage(
        result.data.unpaidNotSaved
          ? {
              ok: false,
              text: `บันทึกการจองของ ${summary} แล้ว แต่ยังตั้งเป็น "ค้างชำระ" ไม่สำเร็จ ตอนนี้ระบบถือว่าจ่ายแล้ว กรุณาแจ้งโดม`,
            }
          : {
              ok: true,
              text: `บันทึกการจองของ ${summary} แล้ว · ${form.paid === false ? "🕒 ค้างชำระ (ดูที่ตารางสนาม)" : "✅ ชำระแล้ว"}`,
            },
      );
      setCreatedBookingId(result.data.id);
      setCreatedUnpaid(form.paid === false && !result.data.unpaidNotSaved);
      setCartItems([]);
      setForm(emptyForm(form.date, form.courtId));
      router.refresh();
    });
  }

  const activeCourtName = courts.find((c) => c.id === form.courtId)?.name ?? `สนาม ${form.courtId}`;

  return (
    <form className="card stack" style={{ gap: 12 }} onSubmit={submit}>
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
                {c.name} ({c.price_per_hour}฿/ชม.)
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
          <select value={effectiveHours} onChange={(e) => update({ hours: Number(e.target.value) })}>
            {Array.from({ length: Math.round(maxHours * 2) }, (_, i) => (i + 1) * 0.5).map((h) => (
              <option key={h} value={h}>
                {h === 0.5 ? "30 นาที" : `${h} ชม.`} (ถึง {formatHour(form.hour + h)})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Multi-court / Multi-time Cart Controls for Admin */}
      <div className="booking-add-actions">
        <button type="button" className="btn btn-block booking-add-cart-btn" onClick={addCurrentToCart}>
          <span style={{ fontSize: 19, fontWeight: 400, lineHeight: 1 }}>＋</span>
          <span>
            เพิ่มลงในรายการจอง ({activeCourtName} · {formatHour(form.hour)}–{formatHour(form.hour + effectiveHours)})
          </span>
        </button>
        {courts.length > 1 && (
          <button type="button" className="booking-add-all-courts-btn" onClick={addAllCourtsSameTime}>
            ⚡ เหมาทุกสนามเวลานี้ ({formatHour(form.hour)}–{formatHour(form.hour + effectiveHours)}) ลงรายการ
          </button>
        )}
      </div>

      {cartItems.length > 0 && (
        <div className="stack" style={{ gap: 8, padding: "10px 12px", background: "var(--surface-2)", borderRadius: 14 }}>
          <div className="row">
            <strong style={{ fontSize: 14 }}>รายการจองในบิลนี้ ({cartItems.length} รายการ)</strong>
            <button
              type="button"
              className="link-btn"
              style={{ fontSize: 12, color: "var(--danger)" }}
              onClick={() => setCartItems([])}
            >
              ล้างทั้งหมด
            </button>
          </div>
          <div className="booking-cart-list">
            {cartItems.map((item) => {
              const courtObj = courts.find((c) => c.id === item.courtId);
              const price = itemPrice(item);
              const durationLabel = item.hours === 0.5 ? "30 นาที" : `${item.hours} ชม.`;
              return (
                <div key={item.key} className="booking-cart-item">
                  <div className="booking-cart-item-text">
                    <strong>{courtObj?.name ?? `สนาม ${item.courtId}`}</strong>
                    <span>
                      {" · "}
                      {formatDayShort(item.date)}
                      {" · "}
                      {formatHour(item.hour)} - {formatHour(item.hour + item.hours)} ({durationLabel})
                      {" · "}
                      <strong>{price}฿</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="booking-cart-remove-btn"
                    onClick={() => removeCartItem(item.key)}
                    aria-label="ลบรายการนี้"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1Zm1 4a1 1 0 0 0-1 1v9a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v9a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Z" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="form-grid">
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

      <div className="field">
        <span>การชำระเงิน</span>
        <div role="radiogroup" aria-label="การชำระเงิน" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            role="radio"
            aria-checked={form.paid !== false}
            className={`chip ${form.paid !== false ? "selected" : "free"}`}
            onClick={() => update({ paid: true })}
          >
            ✅ ชำระแล้ว
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={form.paid === false}
            className={`chip ${form.paid === false ? "selected" : "free"}`}
            onClick={() => update({ paid: false })}
          >
            🕒 ยังไม่ชำระ (เก็บทีหลัง)
          </button>
        </div>
        {form.paid === false && (
          <span className="muted" style={{ fontSize: 12 }}>
            จะขึ้นในรายการ “ค้างชำระ” ที่หน้าตารางสนาม พอได้รับเงินแล้วกด “รับเงินแล้ว” ที่นั่น
          </span>
        )}
      </div>

      <div className="row">
        <span className="muted">
          รวม {effectiveItems.length} รายการ · ราคา {formatBaht(totalAmount)} · ยืนยันทันที ·{" "}
          {form.paid === false ? "🕒 ค้างชำระ" : "✅ ชำระแล้ว"}
        </span>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "กำลังบันทึก…" : `บันทึกการจอง (${formatBaht(totalAmount)})`}
        </button>
      </div>
      {message && <p className={message.ok ? "muted" : "error"}>{message.text}</p>}

      {createdBookingId && !createdUnpaid && (
        <div className="stack" style={{ gap: 10, borderTop: "1px dashed var(--border)", paddingTop: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15 }}>💳 ลูกค้าจ่ายเงินด้วย? แนบสลิปได้เลย</h3>
          <span className="muted" style={{ fontSize: 13 }}>
            การจองนี้ยืนยันแล้ว สลิปจะเก็บไว้เป็นหลักฐานการชำระ (ไม่บังคับ ข้ามได้ถ้ายังไม่ได้รับเงิน)
          </span>
          <AdminSlipUploader bookingId={createdBookingId} />
        </div>
      )}
    </form>
  );
}
