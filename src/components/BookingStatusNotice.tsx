"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { noticeForTransition, type BookingNotice } from "@/lib/booking-notice";
import { Modal } from "./Modal";

const storageKey = (id: string) => `booking-status:${id}`;

function readSeen(id: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(id));
  } catch {
    return null;
  }
}

function writeSeen(id: string, status: string) {
  try {
    window.localStorage.setItem(storageKey(id), status);
  } catch {
    // Private mode etc.: we still catch changes that happen while the page is open.
  }
}

/**
 * Pops up when the booking's status changes: slip sent, confirmed, rejected or
 * expired. Works for changes made by the shop later (the page refreshes over
 * realtime) and for changes that happened while the customer was away.
 */
export function BookingStatusNotice({
  bookingId,
  status,
  reviewNote,
  summary,
}: {
  bookingId: string;
  status: string;
  reviewNote: string | null;
  summary: { court: string; slot: string; amount: string };
}) {
  const lastSeen = useRef<string | null>(null);
  const [notice, setNotice] = useState<BookingNotice | null>(null);

  useEffect(() => {
    const prev = lastSeen.current ?? readSeen(bookingId);
    const next = noticeForTransition(prev, status, reviewNote);
    if (next) setNotice(next);
    lastSeen.current = status;
    writeSeen(bookingId, status);
  }, [bookingId, status, reviewNote]);

  if (!notice) return null;
  const close = () => setNotice(null);
  const details = (
    <div className="modal-details">
      <span>{summary.court}</span>
      <span>{summary.slot}</span>
      <strong>{summary.amount}</strong>
    </div>
  );

  if (notice === "confirmed") {
    return (
      <Modal
        tone="success"
        title="จองสำเร็จ!"
        onClose={close}
        actions={
          <>
            <button className="btn btn-block" onClick={close}>เยี่ยมเลย</button>
            <Link className="btn btn-block btn-ghost" href="/me">ดูการจองของฉัน</Link>
          </>
        }
      >
        <p>ร้านได้รับเงินแล้ว แสดงหน้านี้ที่เคาน์เตอร์เมื่อมาถึงสนาม</p>
        {details}
      </Modal>
    );
  }

  if (notice === "submitted") {
    return (
      <Modal tone="info" title="ส่งสลิปเรียบร้อย" onClose={close} actions={<button className="btn btn-block" onClick={close}>ตกลง</button>}>
        <p>ร้านกำลังตรวจสลิปของคุณ พอตรวจเสร็จจะแจ้งที่หน้านี้ทันที ปิดหน้านี้ไปก่อนก็ได้</p>
        {details}
      </Modal>
    );
  }

  if (notice === "rejected") {
    return (
      <Modal
        tone="error"
        title="สลิปไม่ผ่านการตรวจ"
        onClose={close}
        actions={
          <button
            className="btn btn-block"
            onClick={() => {
              close();
              document.getElementById("slip-upload")?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
          >
            ส่งสลิปใหม่
          </button>
        }
      >
        {reviewNote && <p className="modal-reason">เหตุผล: {reviewNote}</p>}
        <p>ตรวจยอดเงินกับบัญชีผู้รับให้ถูกต้อง แล้วส่งสลิปใหม่ภายในเวลาที่เหลือ</p>
        {details}
      </Modal>
    );
  }

  return (
    <Modal
      tone="error"
      title="หมดเวลาชำระเงิน"
      onClose={close}
      actions={<Link className="btn btn-block" href="/book">จองใหม่</Link>}
    >
      <p>ระบบปล่อยคิวนี้ให้คนอื่นแล้ว ถ้าโอนเงินไปแล้ว กรุณาติดต่อร้านพร้อมสลิป</p>
      {details}
    </Modal>
  );
}
