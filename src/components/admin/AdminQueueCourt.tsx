"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  adminAddToQueue,
  queueEntryAction,
  queueNextGame,
  setCourtQueue,
  type QueueEntryAction,
} from "@/app/queue-actions";
import type { ActionResult } from "@/app/actions";
import { QUEUE_NAME_MAX, type CourtQueueView } from "@/lib/queue";

const PLAYER_OPTIONS = [
  { value: 2, label: "เดี่ยว (2 คน)" },
  { value: 4, label: "คู่ (4 คน)" },
  { value: 3, label: "3 คน" },
];

/** One court's queue in the back office: open/close, next game, and per-player moves. */
export function AdminQueueCourt({ view }: { view: CourtQueueView }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) return setError(result.error);
      after?.();
      router.refresh();
    });
  }

  function toggleOpen() {
    if (view.isOpen && !confirm(`ปิดคิว ${view.courtName}? คนที่รออยู่ทั้งหมดจะออกจากคิว`)) return;
    run(() => setCourtQueue(view.courtId, !view.isOpen, view.playersPerGame));
  }

  function addWalkIn(event: FormEvent) {
    event.preventDefault();
    run(() => adminAddToQueue(view.courtId, name), () => setName(""));
  }

  const act = (entryId: string, action: QueueEntryAction) => run(() => queueEntryAction(entryId, action));
  const nextCount = Math.min(view.playersPerGame, view.waiting.length);

  return (
    <section className={`card queue-court ${view.isOpen ? "" : "is-closed"}`} aria-labelledby={`admin-queue-${view.courtId}`}>
      <div className="queue-court-head">
        <h2 id={`admin-queue-${view.courtId}`}>{view.courtName}</h2>
        <button type="button" className={`btn btn-sm ${view.isOpen ? "btn-ghost" : ""}`} onClick={toggleOpen} disabled={pending}>
          {view.isOpen ? "ปิดคิว" : "เปิดคิวก๊วน"}
        </button>
      </div>

      <label className="field">
        <span>ลงสนามครั้งละ</span>
        <select
          value={view.playersPerGame}
          disabled={pending}
          onChange={(e) => run(() => setCourtQueue(view.courtId, view.isOpen, Number(e.target.value)))}
        >
          {PLAYER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {view.isOpen && (
        <>
          <button
            type="button"
            className="btn btn-block queue-next-btn"
            onClick={() => run(() => queueNextGame(view.courtId))}
            disabled={pending || (view.playing.length === 0 && view.waiting.length === 0)}
          >
            {nextCount > 0 ? `▶ เกมถัดไป · เรียก ${nextCount} คน` : "▶ จบเกมนี้ (ไม่มีคนรอ)"}
          </button>

          <div className="queue-on-court">
            <span className="queue-section-label">🏸 กำลังเล่น ({view.playing.length})</span>
            {view.playing.length === 0 && <span className="muted">ยังไม่มีคนลงสนาม</span>}
            <ul className="queue-list">
              {view.playing.map((r) => (
                <li key={r.entry_id}>
                  <span className="queue-name">{r.name}</span>
                  <span className="queue-actions">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(r.entry_id, "back")} disabled={pending}>
                      ต่อท้ายคิว
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(r.entry_id, "done")} disabled={pending}>
                      จบ
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="queue-on-court">
            <span className="queue-section-label">รอคิว ({view.waiting.length})</span>
            {view.waiting.length === 0 && <span className="muted">ยังไม่มีคนรอ</span>}
            <ol className="queue-list">
              {view.waiting.map((r, i) => (
                <li key={r.entry_id}>
                  <span className="queue-num">{i + 1}</span>
                  <span className="queue-name">{r.name}</span>
                  <span className="queue-actions">
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => act(r.entry_id, "play")} disabled={pending}>
                      ลงเลย
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => confirm(`เอา ${r.name} ออกจากคิว?`) && act(r.entry_id, "remove")}
                      disabled={pending}
                    >
                      ลบ
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <form className="queue-add" onSubmit={addWalkIn}>
            <input
              type="text"
              value={name}
              maxLength={QUEUE_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder="เพิ่มชื่อคนที่ไม่มีมือถือ"
              aria-label={`เพิ่มชื่อเข้าคิว ${view.courtName}`}
            />
            <button type="submit" className="btn btn-sm" disabled={pending || name.trim() === ""}>
              เพิ่ม
            </button>
          </form>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </section>
  );
}
