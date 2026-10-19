"use client";

import { useState, useTransition } from "react";
import { updateShopContactAction } from "@/app/admin-actions";
import type { ShopContact } from "@/lib/shop-contact";

export function ShopContactSettings({ current }: { current: ShopContact }) {
  const [name, setName] = useState(current.name ?? "");
  const [phone, setPhone] = useState(current.phone ?? "");
  const [line, setLine] = useState(current.line ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateShopContactAction(name, phone, line);
      if (result.ok) setSaved(true);
      else setError(result.error);
    });
  }

  return (
    <form onSubmit={save} className="card stack" style={{ gap: 14, maxWidth: 520 }}>
      <h3>ข้อมูลติดต่อแอดมิน (ลูกค้าเห็น)</h3>
      <p className="muted" style={{ margin: 0 }}>
        แสดงเป็นการ์ด “สอบถาม / ติดต่อแอดมิน” ในหน้าแรก หน้าของฉัน และหน้ารายละเอียดการจอง ใส่อย่างน้อยเบอร์โทรหรือ LINE
      </p>
      <label className="field">
        <span>ชื่อผู้ติดต่อ</span>
        <input id="contact-name" type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>เบอร์โทร</span>
        <input
          id="contact-phone"
          type="text"
          inputMode="tel"
          placeholder="08xxxxxxxx"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, "").slice(0, 10))}
        />
      </label>
      <label className="field">
        <span>LINE ID, @บัญชีทางการ หรือลิงก์ LINE</span>
        <input
          id="contact-line"
          type="text"
          placeholder="เช่น akkanay หรือ @sinthani หรือ https://lin.ee/…"
          maxLength={200}
          value={line}
          onChange={(e) => setLine(e.target.value)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      {saved && <p className="badge confirmed" style={{ padding: "8px 12px", borderRadius: 8 }}>บันทึกแล้ว ลูกค้าเห็นทันที</p>}
      <button className="btn btn-block" type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก…" : "บันทึกข้อมูลติดต่อ"}
      </button>
    </form>
  );
}
