"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { autoJoinParty, findPartyByCode } from "@/app/party-actions";
import { PARTY_CODE_LENGTH, type PartyMode, type PartyPreview, type PartyScoring } from "@/lib/party";

/**
 * The two ways into a room that are not "scroll the list": type the code a friend sent,
 * or let the system pick a room. Both need the player's name, the same way joining a
 * room from the list does.
 */
export function PartyFinder({
  mode,
  scoring,
  defaultName,
  loggedIn,
}: {
  mode: PartyMode;
  scoring: PartyScoring;
  defaultName: string;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState(defaultName);
  const [preview, setPreview] = useState<PartyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const cleanCode = code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  function lookUp() {
    setError(null);
    setPreview(null);
    startTransition(async () => {
      const result = await findPartyByCode(cleanCode);
      if (!result.ok) setError(result.error);
      else setPreview(result.data);
    });
  }

  function surpriseMe() {
    setError(null);
    if (!name.trim()) return setError("ใส่ชื่อของคุณก่อน");
    startTransition(async () => {
      const result = await autoJoinParty(mode, scoring, name);
      if (!result.ok) setError(result.error);
      else router.push(`/queue/${result.data.partyId}`);
    });
  }

  if (!loggedIn) return null;

  return (
    <div className="card stack party-finder">
      <div className="party-share-head">
        <h2>▣ เข้าห้องแบบอื่น</h2>
        <span>มีรหัส หรือให้ระบบเลือกให้</span>
      </div>

      <label className="field">
        <span>ชื่อของคุณในห้อง</span>
        <input value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
      </label>

      <div className="party-finder-code">
        <label className="field">
          <span>รหัสห้องส่วนตัว ({PARTY_CODE_LENGTH} ตัว)</span>
          <input
            value={code}
            maxLength={9}
            inputMode="text"
            autoCapitalize="characters"
            placeholder="เช่น BCD3GH"
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn"
          disabled={pending || cleanCode.length !== PARTY_CODE_LENGTH}
          onClick={lookUp}
        >
          {pending ? "กำลังหา…" : "หาห้อง"}
        </button>
      </div>

      {preview && (
        <div className="party-finder-preview">
          <div>
            <strong>{preview.title}</strong>
            <small>
              โดย {preview.host_name} · {preview.mode === "singles" ? "เดี่ยว" : "คู่"} ·{" "}
              {preview.scoring === "ranked" ? "จัดอันดับ" : "ชิลๆ"} · {preview.members}/{preview.capacity} คน
            </small>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => router.push(`/queue/${preview.party_id}?code=${cleanCode}`)}
          >
            เข้าห้องนี้ ›
          </button>
        </div>
      )}

      <button type="button" className="btn btn-block btn-ghost" disabled={pending} onClick={surpriseMe}>
        🎲 สุ่มห้องให้เลย ({mode === "singles" ? "เดี่ยว" : "คู่"} · {scoring === "ranked" ? "จัดอันดับ" : "ชิลๆ"})
      </button>
      <p className="muted party-finder-note">
        สุ่มห้องจะพาเข้าห้องสาธารณะที่ยังมีที่ว่าง โดยเลือกห้องที่คนใกล้เต็มที่สุดก่อน เพื่อไม่ให้แต่ละห้องมีคนน้อยเกินไป
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
