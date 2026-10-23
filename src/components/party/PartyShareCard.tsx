"use client";

import { useEffect, useState } from "react";
import { PARTY_CODE_LENGTH } from "@/lib/party";

/**
 * How a host gets people into the room: the link, the six-character code, and a QR of
 * the link. The QR is drawn in the browser so the room page stays a plain server render.
 *
 * A public room has no code — anyone can find it in the list — so it shares the link only.
 */
export function PartyShareCard({ partyId, joinCode }: { partyId: string; joinCode: string | null }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [url, setUrl] = useState("");

  useEffect(() => {
    // window.location is the only honest source here: the room may be opened over the
    // Render domain, a tunnel, or localhost, and the QR has to match wherever the host is.
    const roomUrl = `${window.location.origin}/queue/${partyId}${joinCode ? `?code=${joinCode}` : ""}`;
    setUrl(roomUrl);
    let cancelled = false;
    import("qrcode")
      .then((mod) => mod.toDataURL(roomUrl, { margin: 2, width: 480 }))
      .then((data) => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [partyId, joinCode]);

  async function copy(what: "link" | "code") {
    try {
      await navigator.clipboard.writeText(what === "link" ? url : joinCode ?? "");
      setCopied(what);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // Clipboard is blocked in some in-app browsers; the text is on screen to read out.
    }
  }

  return (
    <div className="card stack party-share">
      <div className="party-share-head">
        <h2>▣ ชวนเพื่อนเข้าห้อง</h2>
        <span>{joinCode ? "ห้องส่วนตัว ต้องมีรหัสถึงเข้าได้" : "ห้องสาธารณะ ใครก็กดเข้าได้"}</span>
      </div>

      {joinCode && (
        <div className="party-share-code">
          <span>รหัสห้อง</span>
          <strong>{joinCode.split("").join(" ")}</strong>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => copy("code")}>
            {copied === "code" ? "คัดลอกแล้ว ✓" : "คัดลอกรหัส"}
          </button>
        </div>
      )}

      {qr ? (
        <div className="party-share-qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR เข้าห้อง${joinCode ? ` รหัส ${joinCode}` : ""}`} width={200} height={200} />
          <small>ให้เพื่อนสแกน แล้วเข้าห้องได้เลย{joinCode ? " ไม่ต้องพิมพ์รหัสเอง" : ""}</small>
        </div>
      ) : (
        <div className="party-share-qr"><small className="muted">กำลังสร้าง QR…</small></div>
      )}

      <button type="button" className="btn btn-block btn-ghost" onClick={() => copy("link")}>
        {copied === "link" ? "คัดลอกลิงก์แล้ว ✓" : "🔗 คัดลอกลิงก์ห้อง"}
      </button>
      {joinCode && joinCode.length !== PARTY_CODE_LENGTH && (
        <p className="error">รหัสห้องผิดรูปแบบ กรุณาแจ้งร้าน</p>
      )}
    </div>
  );
}
