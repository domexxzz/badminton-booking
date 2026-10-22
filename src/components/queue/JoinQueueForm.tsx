"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { joinQueue } from "@/app/queue-actions";
import { QUEUE_NAME_MAX } from "@/lib/queue";

export function JoinQueueForm({
  courts,
  defaultName,
}: {
  courts: { id: number; name: string; waiting: number }[];
  defaultName: string;
}) {
  const router = useRouter();
  const [courtId, setCourtId] = useState(courts[0]?.id);
  const [name, setName] = useState(defaultName.slice(0, QUEUE_NAME_MAX));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const court = courts.find((c) => c.id === courtId) ?? courts[0];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!court) return;
    setError(null);
    startTransition(async () => {
      const result = await joinQueue(court.id, name);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <form className="card stack queue-join" onSubmit={submit}>
      <h2>ต่อคิว</h2>
      {courts.length > 1 && (
        <div className="queue-court-pick" role="radiogroup" aria-label="เลือกสนามที่จะต่อคิว">
          {courts.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.id === court?.id}
              className={`chip ${c.id === court?.id ? "selected" : ""}`}
              onClick={() => setCourtId(c.id)}
            >
              <strong>{c.name}</strong>
              <span>รอ {c.waiting} คน</span>
            </button>
          ))}
        </div>
      )}
      <label className="field">
        <span>ชื่อที่จะขึ้นในคิว (ทุกคนในหน้านี้เห็นชื่อนี้)</span>
        <input
          type="text"
          value={name}
          maxLength={QUEUE_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder="เช่น ต้น หรือ ต้น+เอ"
          required
        />
      </label>
      <button className="btn btn-block" type="submit" disabled={pending || !court}>
        {pending ? "กำลังต่อคิว…" : `ต่อคิว${court ? ` ${court.name}` : ""}`}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
