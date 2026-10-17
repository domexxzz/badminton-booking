"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

type NotificationItem = {
  id: string;
  type: "success" | "alert" | "info";
  icon: string;
  title: string;
  message: string;
  href?: string;
  timestamp: number;
};

function playNotificationChime(type: "success" | "alert" | "info" = "info") {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "success") {
      // Pleasant bright two-tone chime
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880.0, now + 0.1); // A5
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === "alert") {
      // Attention chime
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, now); // A4
      osc.frequency.setValueAtTime(659.25, now + 0.12); // E5
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now);
      osc.stop(now + 0.4);
    } else {
      // Gentle info blip
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now); // C5
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  } catch {
    // Autoplay policy or unsupported audio
  }
}

export function RealtimeNotificationBanner({
  userId,
  isAdmin = false,
}: {
  userId?: string | null;
  isAdmin?: boolean;
}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const seenIds = useRef(new Set<string>());

  // Read sound preference from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("badminton_sound_enabled");
      if (stored !== null) setSoundEnabled(stored === "true");
    } catch {
      // ignore
    }
  }, []);

  function toggleSound() {
    setSoundEnabled((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("badminton_sound_enabled", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function addNotification(item: Omit<NotificationItem, "id" | "timestamp">) {
    const id = `${Date.now()}-${Math.random()}`;
    const newItem: NotificationItem = { ...item, id, timestamp: Date.now() };

    setNotifications((prev) => [newItem, ...prev.slice(0, 2)]);
    if (soundEnabled) playNotificationChime(item.type);

    // Auto dismiss after 7 seconds
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 7000);
  }

  function dismiss(id: string) {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }

  useEffect(() => {
    const supabase = getBrowserClient();
    if (!supabase) return;

    const channelName = isAdmin ? "admin-notifications-feed" : `customer-feed-${userId ?? "guest"}`;
    const channel = supabase.channel(channelName);

    // 1. Listen for bookings table changes
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "bookings" },
      (payload) => {
        const { eventType, new: newRow, old: oldRow } = payload as {
          eventType: "INSERT" | "UPDATE" | "DELETE";
          new: { id?: string; user_id?: string; status?: string; court_id?: number; amount?: number };
          old?: { status?: string };
        };

        if (!newRow?.id) return;
        const eventKey = `${eventType}-${newRow.id}-${newRow.status}`;
        if (seenIds.current.has(eventKey)) return;
        seenIds.current.add(eventKey);

        if (isAdmin) {
          // Admin notifications
          if (eventType === "INSERT") {
            addNotification({
              type: "alert",
              icon: "⚡",
              title: "มีรายการจองใหม่!",
              message: "ลูกค้าสร้างคิวจองใหม่ (รอชำระเงิน)",
              href: "/admin",
            });
          } else if (eventType === "UPDATE") {
            if (newRow.status === "awaiting_review" && oldRow?.status !== "awaiting_review") {
              addNotification({
                type: "alert",
                icon: "🧾",
                title: "มีสลิปใหม่รอตรวจ!",
                message: "ลูกค้าแนบสลิปชำระเงินแล้ว คลิกเพื่อตรวจสอบ",
                href: "/admin/review",
              });
            } else if (newRow.status === "confirmed" && oldRow?.status !== "confirmed") {
              addNotification({
                type: "success",
                icon: "✅",
                title: "ยืนยันการจองเรียบร้อย",
                message: `คิวสนามได้รับการยืนยันแล้ว`,
                href: "/admin",
              });
            }
          }
        } else if (userId && newRow.user_id === userId) {
          // Customer notifications for their own bookings
          if (eventType === "UPDATE") {
            if (newRow.status === "confirmed" && oldRow?.status !== "confirmed") {
              addNotification({
                type: "success",
                icon: "🎉",
                title: "การจองของคุณได้รับการยืนยันแล้ว!",
                message: "สลิปผ่านการตรวจสอบเรียบร้อย พร้อมลงสนาม",
                href: `/bookings/${newRow.id}`,
              });
            } else if (newRow.status === "awaiting_review" && oldRow?.status !== "awaiting_review") {
              addNotification({
                type: "info",
                icon: "🧾",
                title: "แนบสลิปเรียบร้อยแล้ว",
                message: "ระบบได้รับสลิปแล้ว กำลังรอแอดมินตรวจสอบ",
                href: `/bookings/${newRow.id}`,
              });
            }
          }
        }
      },
    );

    // 2. Listen for booking_requests table changes
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "booking_requests" },
      (payload) => {
        const { eventType, new: newReq } = payload as {
          eventType: "INSERT" | "UPDATE";
          new: { id?: string; booking_id?: string; kind?: "reschedule" | "cancel"; status?: "pending" | "approved" | "rejected" };
        };

        if (!newReq?.id) return;
        const eventKey = `req-${eventType}-${newReq.id}-${newReq.status}`;
        if (seenIds.current.has(eventKey)) return;
        seenIds.current.add(eventKey);

        if (isAdmin && eventType === "INSERT") {
          const kindLabel = newReq.kind === "cancel" ? "ขอยกเลิกและคืนเงิน" : "ขอเลื่อนเวลา";
          addNotification({
            type: "alert",
            icon: "🙋",
            title: `มีคำขอใหม่: ${kindLabel}`,
            message: "ลูกค้าส่งคำขอ คลิกเพื่อตรวจสอบและดำเนินการ",
            href: "/admin/requests",
          });
        } else if (!isAdmin && eventType === "UPDATE" && newReq.status && newReq.status !== "pending") {
          const resultLabel = newReq.status === "approved" ? "ได้รับการอนุมัติแล้ว" : "ไม่ได้รับการอนุมัติ";
          const kindLabel = newReq.kind === "cancel" ? "คำขอยกเลิกคิว" : "คำขอเลื่อนเวลา";
          addNotification({
            type: newReq.status === "approved" ? "success" : "alert",
            icon: newReq.status === "approved" ? "✅" : "⚠️",
            title: `${kindLabel} ${resultLabel}`,
            message: "คลิกเพื่อดูรายละเอียดการจองของคุณ",
            href: `/bookings/${newReq.booking_id}`,
          });
        }
      },
    );

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, userId, soundEnabled]);

  if (notifications.length === 0) return null;

  return (
    <div className="realtime-toast-container" aria-live="polite">
      {notifications.map((n) => (
        <div key={n.id} className={`realtime-toast toast-${n.type}`}>
          <div className="toast-icon-wrap">{n.icon}</div>
          <div className="toast-body">
            <strong className="toast-title">{n.title}</strong>
            <p className="toast-msg">{n.message}</p>
            {n.href && (
              <Link
                href={n.href}
                className="toast-action-link"
                onClick={() => dismiss(n.id)}
              >
                ดูรายละเอียด →
              </Link>
            )}
          </div>
          <div className="toast-right-controls">
            <button
              type="button"
              className="toast-sound-toggle"
              onClick={toggleSound}
              title={soundEnabled ? "ปิดเสียงแจ้งเตือน" : "เปิดเสียงแจ้งเตือน"}
              aria-label={soundEnabled ? "ปิดเสียงแจ้งเตือน" : "เปิดเสียงแจ้งเตือน"}
            >
              {soundEnabled ? "🔔" : "🔕"}
            </button>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => dismiss(n.id)}
              aria-label="ปิดการแจ้งเตือน"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
