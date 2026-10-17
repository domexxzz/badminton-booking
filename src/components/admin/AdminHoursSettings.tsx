"use client";

import { useState, useTransition } from "react";
import { updateVenueHoursAction } from "@/app/admin-actions";
import { formatHour } from "@/lib/slots";

const ALL_HOURS: number[] = [];
for (let h = 5; h <= 24; h += 0.5) {
  ALL_HOURS.push(h);
}

export function AdminHoursSettings({
  currentOpenHour,
  currentCloseHour,
}: {
  currentOpenHour: number;
  currentCloseHour: number;
}) {
  const [openHour, setOpenHour] = useState(currentOpenHour);
  const [closeHour, setCloseHour] = useState(currentCloseHour);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (openHour >= closeHour) {
      setError("เวลาเปิดต้องน้อยกว่าเวลาปิด");
      return;
    }

    startTransition(async () => {
      const res = await updateVenueHoursAction(openHour, closeHour);
      if (res.ok) {
        setSuccess("บันทึกเวลาเปิด-ปิดสนามเรียบร้อยแล้ว");
      } else {
        setError(res.error);
      }
    });
  };

  const lastStartHour = closeHour - 0.5;

  return (
    <form onSubmit={handleSave} className="card stack" style={{ gap: 16, maxWidth: 520 }}>
      <h3>กำหนดเวลาเปิด - ปิดสนาม</h3>
      <p className="muted" style={{ margin: 0 }}>
        การเปลี่ยนเวลาที่นี่จะมีผลทันทีต่อรอบการจองในหน้าเว็บของลูกค้า ตารางคิว และระบบตรวจสอบความถูกต้องในฐานข้อมูล
      </p>

      {error && <p className="error">{error}</p>}
      {success && <p className="badge confirmed" style={{ padding: "8px 12px", borderRadius: 8 }}>{success}</p>}

      <div className="row" style={{ gap: 16 }}>
        <div style={{ flex: 1, display: "grid", gap: 6 }}>
          <label htmlFor="openHour">
            <strong>เวลาเปิดสนาม</strong>
          </label>
          <select
            id="openHour"
            value={openHour}
            disabled={pending}
            onChange={(e) => setOpenHour(Number(e.target.value))}
            style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
          >
            {ALL_HOURS.filter((h) => h < closeHour).map((h) => (
              <option key={h} value={h}>
                {formatHour(h)} น.
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, display: "grid", gap: 6 }}>
          <label htmlFor="closeHour">
            <strong>เวลาปิดสนาม</strong>
          </label>
          <select
            id="closeHour"
            value={closeHour}
            disabled={pending}
            onChange={(e) => setCloseHour(Number(e.target.value))}
            style={{ width: "100%", padding: "10px", borderRadius: "8px", border: "1px solid var(--border)" }}
          >
            {ALL_HOURS.filter((h) => h > openHour).map((h) => (
              <option key={h} value={h}>
                {formatHour(h)} น.
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          background: "var(--surface-2)",
          padding: "12px 14px",
          borderRadius: "10px",
          fontSize: "14px",
          color: "var(--text)",
          display: "grid",
          gap: 4,
        }}
      >
        <div>
          💡 <strong>รอบที่เปิดให้จอง:</strong> {formatHour(openHour)} น. ถึงรอบสุดท้ายที่เริ่มเวลา{" "}
          <strong style={{ color: "var(--primary-strong)" }}>{formatHour(lastStartHour)} น.</strong> (เล่นจบที่{" "}
          {formatHour(closeHour)} น.)
        </div>
        <div className="muted" style={{ fontSize: "13px" }}>
          * หากต้องการให้ลูกค้าจองรอบ <strong>23:00 น.</strong> ได้ ให้ตั้งเวลาปิดสนามเป็นอย่างน้อย{" "}
          <strong>23:30 น.</strong> (เล่น 30 นาที) หรือ <strong>24:00 น.</strong> (เล่นได้สูงสุด 1 ชั่วโมง)
        </div>
      </div>

      <button className="btn btn-block" type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
      </button>
    </form>
  );
}
