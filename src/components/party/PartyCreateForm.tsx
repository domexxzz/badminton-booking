"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";
import { createPartyBooking } from "@/app/party-actions";
import { BOOKING_RULES } from "@/lib/config";
import { formatBaht } from "@/lib/format";
import { PARTY_NAME_MAX, PARTY_TITLE_MAX, type PartyMode, type PartyScoring, type PartyVisibility } from "@/lib/party";
import { formatHour, maxBookableHours, openingSlots, slotStart, upcomingDates } from "@/lib/slots";
import { DatePills } from "@/components/DatePills";
import { CourtArt } from "@/components/CourtArt";
import { useOccupancy } from "@/components/useOccupancy";

type Court = { id: number; name: string; price_per_hour: number };

export function PartyCreateForm({ courts, defaultName, openHour, closeHour }: {
  courts: Court[]; defaultName: string; openHour: number; closeHour: number;
}) {
  const router = useRouter();
  const dates = useMemo(() => upcomingDates(new Date(), BOOKING_RULES.maxDaysAhead), []);
  const [date, setDate] = useState(dates[0]);
  const [courtId, setCourtId] = useState(courts[0]?.id ?? 1);
  const [hour, setHour] = useState<number | null>(null);
  const [hours, setHours] = useState(1);
  const [mode, setMode] = useState<PartyMode>("doubles");
  const [visibility, setVisibility] = useState<PartyVisibility>("public");
  const [scoring, setScoring] = useState<PartyScoring>("ranked");
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
      const result = await createPartyBooking({ courtId: court.id, startsAt: slotStart(date, hour), hours, mode, title, hostName, visibility, scoring });
      if (!result.ok) return setError(result.error);
      router.push(`/bookings/${result.data.bookingId}?party=${result.data.partyId}`);
    });
  }

  return (
    <form className="stack booking-cart-page party-create-flow" onSubmit={submit}>
      <DatePills dates={dates} value={date} onChange={chooseDate} />
      <section className="card stack booking-picker-card">
      <div className="field"><span className="booking-section-title">เลือกสนามและเวลาที่ต้องการ</span><div className="booking-court-scroller">
        {courts.map((c) => <button key={c.id} type="button" className={`booking-court-horiz-card ${c.id === courtId ? "selected" : ""}`} onClick={() => chooseCourt(c.id)}><div className="booking-court-horiz-thumb"><CourtArt label={c.name} /></div><div className="booking-court-horiz-info"><strong>{c.name} ({c.price_per_hour}฿/ชม.)</strong><span>เลือกเวลาด้านล่างเพื่อจองเปิดห้อง</span></div></button>)}
      </div></div>
      <div className="field"><div className="row"><span className="booking-section-title">เลือกเวลาเริ่มต้น</span>{hour !== null && <span className="badge confirmed">{court.name} · {formatHour(hour)} – {formatHour(hour + hours)} น.</span>}</div><div className="chip-grid">
        {slots.map((slot) => {
          const available = maxBookableHours(courtId, date, slot, occupancy, now, 0.5, closeHour);
          const disabled = available < .5;
          const selected = hour !== null && slot >= hour && slot < hour + hours;
          return <button key={slot} type="button" disabled={disabled && !selected} className={`chip time-slot ${selected ? slot === hour ? "selected" : "in-range" : disabled ? "unavailable" : "free"}`} onClick={() => { setHour(slot); setHours(Math.min(hours, Math.max(.5, available))); }}><span className="chip-time-start">{formatHour(slot)}</span><span className="chip-time-end">{disabled && !selected ? "🔒 ล็อกแล้ว" : `– ${formatHour(slot + .5)}`}</span></button>;
        })}
      </div></div>
      <div className="field"><div className="row"><span className="booking-section-title">ระยะเวลา</span>{hour !== null && <span className="muted">เล่นถึง {formatHour(hour + hours)} น.</span>}</div><div className="hours-grid">
        {[.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((h) => { const available = hour !== null && h <= maxBookableHours(courtId, date, hour, occupancy, now, 0.5, closeHour); return <button key={h} type="button" disabled={!available} className={`chip duration-chip ${hours === h && hour !== null ? "selected" : available ? "free" : "unavailable"}`} onClick={() => setHours(h)}><span className="duration-title">{h === .5 ? "30 นาที" : `${h} ชม.`}</span>{hour !== null && <span className="duration-sub">เลิก {formatHour(hour + h)}</span>}</button>; })}
      </div></div>
      </section>

      <section className="card stack party-create party-detail-card">
        <div className="party-detail-head"><div><span>รายละเอียดห้อง</span><h2>ตั้งค่าห้องก๊วน</h2></div><span className="party-free-pill">▣ เปิดห้องฟรี</span></div>
        <div className="party-create-guide"><span>1</span><p><strong>♣ หัวห้องจ่ายค่าจอง</strong><small>ชำระเต็มจำนวนผ่านระบบ</small></p><i>›</i><span>2</span><p><strong>🔗 สมาชิกเข้าร่วมฟรี</strong><small>ตกลงค่าใช้จ่ายกับหัวห้องเอง</small></p></div>
        <label className="field party-detail-field"><span><b aria-hidden="true">♣</b> ชื่อห้อง</span><div className="party-input-wrap"><b aria-hidden="true">✎</b><input value={title} maxLength={PARTY_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} required /><small>{title.length}/{PARTY_TITLE_MAX}</small></div></label>
        <label className="field party-detail-field"><span><b aria-hidden="true">◇</b> ชื่อของคุณในห้อง</span><div className="party-input-wrap"><b aria-hidden="true">♙</b><input value={hostName} maxLength={PARTY_NAME_MAX} onChange={(e) => setHostName(e.target.value)} required /><small>{hostName.length}/{PARTY_NAME_MAX}</small></div></label>
        <div className="field party-detail-field"><span><b aria-hidden="true">▣</b> รูปแบบการเล่น</span><div className="party-mode-cards">
          <button type="button" className={mode === "singles" ? "selected" : ""} onClick={() => setMode("singles")}><b className="mode-icon">♣</b><span><strong>เดี่ยว</strong><small>1 ต่อ 1</small></span><i /></button>
          <button type="button" className={mode === "doubles" ? "selected" : ""} onClick={() => setMode("doubles")}><b className="mode-icon">♟</b><span><strong>คู่</strong><small>2 ต่อ 2</small></span><i /></button>
        </div></div>
        <div className="field party-detail-field"><span><b aria-hidden="true">⚿</b> ใครเข้าห้องได้บ้าง</span><div className="party-mode-cards">
          <button type="button" className={visibility === "public" ? "selected" : ""} onClick={() => setVisibility("public")}><b className="mode-icon">◎</b><span><strong>สาธารณะ</strong><small>ขึ้นในรายการ ใครก็กดเข้าได้</small></span><i /></button>
          <button type="button" className={visibility === "private" ? "selected" : ""} onClick={() => setVisibility("private")}><b className="mode-icon">☉</b><span><strong>ส่วนตัว</strong><small>ไม่ขึ้นรายการ ต้องมีรหัสห้อง</small></span><i /></button>
        </div></div>
        <div className="field party-detail-field"><span><b aria-hidden="true">⚑</b> เล่นจริงจังแค่ไหน</span><div className="party-mode-cards">
          <button type="button" className={scoring === "ranked" ? "selected" : ""} onClick={() => setScoring("ranked")}><b className="mode-icon">🏆</b><span><strong>จัดอันดับ</strong><small>แต้มขึ้นลงจริง มีผลกับอันดับร้าน</small></span><i /></button>
          <button type="button" className={scoring === "casual" ? "selected" : ""} onClick={() => setScoring("casual")}><b className="mode-icon">☺</b><span><strong>ชิลๆ</strong><small>เก็บสถิติในห้อง ไม่กระทบอันดับร้าน</small></span><i /></button>
        </div></div>
        {visibility === "private" && <div className="party-selection-notice"><b>☉</b><span>ระบบจะสร้างรหัสห้อง 6 ตัวให้หลังจ่ายเงินสำเร็จ ส่งรหัสหรือ QR ให้เพื่อนเพื่อเข้าห้อง</span></div>}
        {court && hour !== null ? <div className="party-booking-summary"><div><strong>{court.name}</strong><span>{formatHour(hour)}–{formatHour(hour + hours)} น. · {hours === .5 ? "30 นาที" : `${hours} ชม.`}</span></div><div><span>รวมทั้งหมด</span><strong>{formatBaht(court.price_per_hour * hours)}</strong></div></div> : <div className="party-selection-notice"><b>i</b><span>เลือกสนาม เวลา และระยะเวลาด้านบนเพื่อดูสรุปรายการ</span></div>}
      {loadError && <p className="error">{loadError}</p>}{error && <p className="error" role="alert">{error}</p>}
      <button className="btn btn-block party-submit-btn" type="submit" disabled={pending || hour === null}><span aria-hidden="true">▣</span>{pending ? "กำลังสร้างห้อง…" : "จองสนามและไปชำระเงิน"}<b aria-hidden="true">›</b></button>
      </section>
    </form>
  );
}
