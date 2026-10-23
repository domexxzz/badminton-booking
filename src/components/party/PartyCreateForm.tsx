"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { createPartyBooking } from "@/app/party-actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht } from "@/lib/format";
import { PARTY_NAME_MAX, PARTY_TITLE_MAX, type PartyMode } from "@/lib/party";
import { formatHour, maxBookableHours, openingSlots, slotStart, upcomingDates } from "@/lib/slots";
import { DatePills } from "@/components/DatePills";
import { CourtArt } from "@/components/CourtArt";
import { useOccupancy } from "@/components/useOccupancy";

type Court = { id: number; name: string; price_per_hour: number };

export function PartyCreateForm({ courts, defaultName, openHour, closeHour }: {
  courts: Court[]; defaultName: string; openHour: number; closeHour: number;
}) {
  const router = useRouter();
  const dates = useMemo(() => upcomingDates(new Date(), BOOKING_RULES.maxDaysAhead + 1), []);
  const [date, setDate] = useState(dates[0]);
  const [courtId, setCourtId] = useState(courts[0]?.id ?? 1);
  const [hour, setHour] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [mode, setMode] = useState<PartyMode>("doubles");
  const [title, setTitle] = useState("ก๊วนแบดสนุก ๆ");
  const [hostName, setHostName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { occupancy, loadError } = useOccupancy(date);
  const court = courts.find((c) => c.id === courtId) ?? courts[0];
  const now = new Date();
  const slots = openingSlots(0.5, openHour, closeHour);

  function chooseCourt(id: number) { setCourtId(id); setHour(null); }
  function chooseDate(value: string) { setDate(value); setHour(null); }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (hour === null || !court) return setError("กรุณาเลือกเวลาเริ่ม");
    setError(null);
    startTransition(async () => {
      const result = await createPartyBooking({ courtId: court.id, startsAt: slotStart(date, hour), hours, mode, title, hostName });
      if (!result.ok) return setError(result.error);
      router.push(`/bookings/${result.data.bookingId}?party=${result.data.partyId}`);
    });
  }

  return (
    <form className="card stack party-create" onSubmit={submit}>
      <div className="party-create-head"><div><span className="queue-section-label">เปิดห้องใหม่</span><h2>สร้างห้องก๊วน</h2></div><span className="badge confirmed">เปิดห้องฟรี</span></div>
      <div className="party-create-guide"><span>1</span><p><strong>จองเหมือนหน้าจองสนาม</strong><small>เลือกวัน สนาม เวลา และระยะเวลา</small></p><i>›</i><span>2</span><p><strong>ชำระเต็มจำนวน</strong><small>ห้องจะเปิดหลังยืนยันเงิน</small></p></div>
      <label className="field"><span>ชื่อห้อง</span><input value={title} maxLength={PARTY_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required /></label>
      <label className="field"><span>ชื่อของคุณในห้อง</span><input value={hostName} maxLength={PARTY_NAME_MAX} onChange={(e) => setHostName(e.target.value)} required /></label>
      <div className="field"><span>รูปแบบการเล่น</span><div className="party-mode-pick">
        <button type="button" className={`chip ${mode === "singles" ? "selected" : ""}`} onClick={() => setMode("singles")}><strong>เดี่ยว</strong><span>1 ต่อ 1</span></button>
        <button type="button" className={`chip ${mode === "doubles" ? "selected" : ""}`} onClick={() => setMode("doubles")}><strong>คู่</strong><span>2 ต่อ 2</span></button>
      </div></div>
      <div className="field"><span className="booking-section-title">เลือกวัน</span><DatePills dates={dates} value={date} onChange={chooseDate} /></div>
      <div className="field"><span className="booking-section-title">เลือกสนามและเวลาที่ต้องการ</span><div className="booking-court-scroller">
        {courts.map((c) => <button key={c.id} type="button" className={`booking-court-horiz-card ${c.id === courtId ? "selected" : ""}`} onClick={() => chooseCourt(c.id)}><div className="booking-court-horiz-thumb"><CourtArt label={c.name} /></div><div className="booking-court-horiz-info"><strong>{c.name} ({c.price_per_hour}฿/ชม.)</strong><span>เลือกเวลาด้านล่างเพื่อจองเปิดห้อง</span></div></button>)}
      </div></div>
      <div className="field"><span className="booking-section-title">เลือกเวลาเริ่มต้น</span><div className="chip-grid">
        {slots.map((slot) => {
          const available = maxBookableHours(courtId, date, slot, occupancy, now, 0.5, closeHour);
          const disabled = available < 1;
          return <button key={slot} type="button" disabled={disabled} className={`chip time-slot ${hour === slot ? "selected" : disabled ? "unavailable" : "free"}`} onClick={() => { setHour(slot); setHours(Math.min(hours, Math.max(.5, available))); }}><span className="chip-time-start">{formatHour(slot)}</span><span className="chip-time-end">{disabled ? "🔒 ล็อกแล้ว" : `– ${formatHour(slot + .5)}`}</span></button>;
        })}
      </div></div>
      {hour !== null && <div className="field"><span className="booking-section-title">ระยะเวลา</span><div className="hours-grid">
        {[.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].filter((h) => h <= maxBookableHours(courtId, date, hour, occupancy, now, 0.5, closeHour)).map((h) => <button key={h} type="button" className={`chip duration-chip ${hours === h ? "selected" : "free"}`} onClick={() => setHours(h)}><span className="duration-title">{h === .5 ? "30 นาที" : `${h} ชม.`}</span><span className="duration-sub">เลิก {formatHour(hour + h)}</span></button>)}
      </div></div>}
      {court && hour !== null && <div className="party-booking-summary"><div><strong>{court.name}</strong><span>{formatHour(hour)}–{formatHour(hour + hours)} น. · {hours === .5 ? "30 นาที" : `${hours} ชม.`}</span></div><div><span>หัวห้องชำระทั้งหมด</span><strong>{formatBaht(court.price_per_hour * hours)}</strong></div></div>}
      {loadError && <p className="error">{loadError}</p>}{error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-block" type="submit" disabled={pending || hour === null}>{pending ? "กำลังสร้างห้อง…" : "จองสนามและไปชำระเงิน"}</button>
    </form>
  );
}
