"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { kickPartyMember, setPartyModerator, transferPartyHost } from "@/app/party-actions";
import type { PartyMember } from "@/lib/party";

type ManagedMember = PartyMember & { role?: string };

/**
 * Who runs the night. The host can hand the room on or share the work; a moderator can
 * call winners and set the rules but cannot give the room away or remove another
 * moderator — the database enforces both, this screen just stops offering it.
 */
export function PartyManagePanel({
  partyId,
  members,
  myEntry,
  isHost,
}: {
  partyId: string;
  members: ManagedMember[];
  myEntry: string | null;
  isHost: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const others = members.filter((m) => m.entry_id !== myEntry);
  if (others.length === 0) {
    return (
      <div className="card stack party-manage">
        <h2>▣ จัดการห้อง</h2>
        <p className="muted" style={{ margin: 0 }}>ยังไม่มีสมาชิกคนอื่นในห้อง เมื่อมีคนเข้ามาแล้วจะตั้งผู้ดูแลหรือโอนหัวห้องได้ที่นี่</p>
      </div>
    );
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setError(result.error ?? "เกิดข้อผิดพลาด");
      else router.refresh();
    });
  }

  return (
    <div className="card stack party-manage">
      <div className="party-share-head">
        <h2>▣ จัดการห้อง</h2>
        <span>{isHost ? "คุณเป็นหัวห้อง" : "คุณเป็นผู้ดูแล"}</span>
      </div>
      <p className="muted party-manage-note">
        ผู้ดูแลช่วยกดผลการแข่งและตั้งกติกาได้ แต่โอนหัวห้องต่อไม่ได้ · หัวห้องมีได้คนเดียว
      </p>

      {others.map((member) => {
        const isModerator = member.role === "moderator";
        return (
          <div key={member.entry_id} className="party-manage-row">
            <span className="party-manage-name">
              {member.name}
              {isModerator && <i>ผู้ดูแล</i>}
            </span>
            <div>
              {isHost && (
                <>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={pending}
                    onClick={() => run(() => setPartyModerator(partyId, member.entry_id, !isModerator))}
                  >
                    {isModerator ? "ถอดผู้ดูแล" : "ตั้งผู้ดูแล"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => transferPartyHost(partyId, member.entry_id),
                        `โอนหัวห้องให้ ${member.name}? คุณจะกลายเป็นผู้ดูแลแทน`,
                      )
                    }
                  >
                    โอนหัวห้อง
                  </button>
                </>
              )}
              <button
                type="button"
                className="btn btn-sm btn-ghost party-manage-kick"
                disabled={pending || (!isHost && isModerator)}
                onClick={() => run(() => kickPartyMember(partyId, member.entry_id), `เอา ${member.name} ออกจากห้อง?`)}
              >
                เอาออก
              </button>
            </div>
          </div>
        );
      })}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
