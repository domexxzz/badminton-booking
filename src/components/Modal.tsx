"use client";

import { useEffect, useRef } from "react";

export type ModalTone = "success" | "error" | "info" | "loading";

/** Centered popup with an animated status icon. Esc / backdrop close it unless it is a loading state. */
export function Modal({
  tone,
  title,
  children,
  actions,
  onClose,
}: {
  tone: ModalTone;
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  onClose?: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button, a")?.focus();
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        ref={panel}
        className={`modal tone-${tone}`}
        role={tone === "loading" ? "status" : "dialog"}
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-icon" aria-hidden="true">
          {tone === "loading" && <span className="spinner" />}
          {tone === "success" && (
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27l7 7 15-16" />
            </svg>
          )}
          {tone === "error" && (
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="M18 18l16 16M34 18L18 34" />
            </svg>
          )}
          {tone === "info" && (
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="M26 14v13l8 5" />
            </svg>
          )}
        </div>
        <h2 id="modal-title">{title}</h2>
        {children && <div className="modal-body">{children}</div>}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  );
}
