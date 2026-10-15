"use client";

import { useEffect, useState } from "react";

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/**
 * Customers usually pay on the phone they booked with, so they can't point it
 * at its own screen: they save the QR and pick it in the bank app's "scan from
 * picture". iOS only puts images into Photos through the share sheet ("Save
 * Image"); elsewhere a download lands in the gallery.
 */
export function SaveQrButton({ dataUrl, fileName }: { dataUrl: string; fileName: string }) {
  // Built ahead of the tap: Safari refuses share() once an await has passed.
  const [file, setFile] = useState<File | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(dataUrl)
      .then((res) => res.blob())
      .then((blob) => alive && setFile(new File([blob], fileName, { type: "image/png" })))
      .catch((error) => {
        console.error("Preparing QR image failed:", error);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [dataUrl, fileName]);

  function download(f: File) {
    const url = URL.createObjectURL(f);
    const link = Object.assign(document.createElement("a"), { href: url, download: f.name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function save() {
    if (!file) return;
    setFailed(false);
    if (isIOS() && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file] }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return; // sheet closed
        console.error("Sharing QR failed:", error);
        setFailed(true);
      });
      return;
    }
    try {
      download(file);
    } catch (error) {
      console.error("Downloading QR failed:", error);
      setFailed(true);
    }
  }

  return (
    <div className="qr-save">
      <button type="button" className="btn btn-ghost btn-sm btn-block" onClick={save} disabled={!file}>
        ⬇️ บันทึกรูป QR
      </button>
      <span className={failed ? "error" : "muted"}>
        {failed ? "บันทึกไม่ได้ " : "ถ้ากดแล้วไม่บันทึก "}ให้กดค้างที่รูป QR แล้วเลือก “บันทึกรูปภาพ”
      </span>
    </div>
  );
}
