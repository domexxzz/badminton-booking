"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moderateContent, setCommunityPosting } from "@/app/community-actions";

export type OpenReport = {
  report_id: string;
  target_type: "post" | "comment";
  target_id: string;
  reason: string;
  created_at: string;
  reports: number;
  body: string | null;
  author_name: string | null;
  content_status: "visible" | "hidden" | "removed";
};

/**
 * The report queue. Hiding takes something off every screen at once because the public
 * mirror drops the row; the text stays in the private table with who hid it and why, so
 * a complaint can still be looked into afterwards. Restoring puts it back.
 */
export function CommunityModeration({ reports, postingOpen }: { reports: OpenReport[]; postingOpen: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "เกิดข้อผิดพลาด");
      else router.refresh();
    });
  }

  return (
    <section className="stack">
      <div className="card moderation-switch">
        <div>
          <strong>{postingOpen ? "เปิดรับโพสต์อยู่" : "ปิดรับโพสต์ชั่วคราว"}</strong>
          <small>
            {postingOpen
              ? "ถ้าสัปดาห์ไหนไม่มีคนดูแลคิวรายงาน ปิดไว้ก่อนได้ คนยังอ่านโพสต์เดิมได้ตามปกติ"
              : "ตอนนี้ไม่มีใครโพสต์หรือคอมเมนต์ใหม่ได้ อ่านของเดิมได้อย่างเดียว"}
          </small>
        </div>
        <button type="button" className="btn btn-sm" disabled={pending} onClick={() => run(() => setCommunityPosting(!postingOpen))}>
          {postingOpen ? "ปิดรับโพสต์" : "เปิดรับโพสต์"}
        </button>
      </div>

      <div className="party-list-head">
        <h2>เรื่องที่ถูกรายงาน</h2>
        <span>{reports.length} รายการ</span>
      </div>

      {reports.length === 0 ? (
        <div className="card community-empty">
          <strong>ไม่มีเรื่องค้าง</strong>
          <span className="muted">ยังไม่มีใครรายงานอะไรเข้ามา</span>
        </div>
      ) : (
        reports.map((report) => (
          <article key={report.report_id} className="card moderation-item">
            <div className="moderation-item-head">
              <span className="badge">{report.target_type === "post" ? "โพสต์" : "ความเห็น"}</span>
              {report.reports > 1 && <span className="badge warn">ถูกรายงาน {report.reports} ครั้ง</span>}
              {report.content_status === "hidden" && <span className="badge warn">ซ่อนอยู่</span>}
              <small>โดย {report.author_name ?? "ไม่ทราบ"}</small>
            </div>
            <blockquote>{report.body ?? "(ไม่พบข้อความ อาจถูกลบไปแล้ว)"}</blockquote>
            <p className="moderation-reason">เหตุผลที่รายงาน: {report.reason}</p>
            <div className="moderation-actions">
              {report.content_status === "hidden" ? (
                <button type="button" className="btn btn-sm btn-ghost" disabled={pending}
                  onClick={() => run(() => moderateContent(report.target_type, report.target_id, "restore", "ตรวจแล้วไม่ผิดกติกา"))}>
                  เอากลับขึ้น
                </button>
              ) : (
                <button type="button" className="btn btn-sm" disabled={pending}
                  onClick={() => run(() => moderateContent(report.target_type, report.target_id, "hide", "ไม่เหมาะสม"))}>
                  ซ่อนเนื้อหานี้
                </button>
              )}
              <button type="button" className="btn btn-sm btn-ghost" disabled={pending}
                onClick={() => run(() => moderateContent(report.target_type, report.target_id, "dismiss"))}>
                ไม่เป็นไร ปิดเรื่อง
              </button>
            </div>
          </article>
        ))
      )}
      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
