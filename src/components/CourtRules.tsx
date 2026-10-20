import React from "react";

export const COURT_RULES = [
  "แลกบัตรและประทับตราตามระเบียบของหมู่บ้านทุกครั้ง",
  "ไม่จอดรถในซอยทุกซอย และไม่จอดในจุดเส้นขาว-แดง",
  "ใช้รองเท้าสำหรับแบดมินตันเท่านั้น",
  "ไม่นำอาหารที่มีกลิ่นรุนแรงเข้าไปรับประทาน (ยกเว้นขนมและน้ำดื่ม)",
  "ห้ามเล่นการพนันทุกชนิด",
  "แก้วน้ำที่ทางสนามเตรียมไว้ให้ หากใช้แล้วให้ล้างเก็บเข้าที่เดิม",
  "ทิ้งขยะลงในถังแยกตามประเภท ของขยะที่ทางสนามเตรียมไว้ให้",
  "สูบบุหรี่ในจุดที่เตรียมไว้ให้เท่านั้น",
  "ไม่ส่งเสียงดังหลังเวลา 21.30 น.",
] as const;

export function CourtRules() {
  return (
    <section className="card stack court-rules" style={{ gap: 12 }}>
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 style={{ fontSize: 16, display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <span>📋</span> กติกาและข้อปฏิบัติของสนาม แบดมินตัน@สินธานี
        </h2>
      </div>
      <ol
        className="rules-list"
        style={{
          margin: 0,
          paddingLeft: 20,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: 14,
          lineHeight: 1.6,
          color: "var(--foreground)",
        }}
      >
        {COURT_RULES.map((rule, idx) => (
          <li key={idx} style={{ paddingLeft: 4 }}>
            {rule}
          </li>
        ))}
      </ol>
    </section>
  );
}
