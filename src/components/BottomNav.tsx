"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarIcon, CourtIcon, HomeIcon, QueueIcon, UserIcon } from "./icons";

const TABS = [
  { href: "/", label: "หน้าแรก", Icon: HomeIcon },
  { href: "/schedule", label: "ตารางคิว", Icon: CalendarIcon },
  { href: "/book", label: "จองสนาม", Icon: CourtIcon },
  { href: "/queue", label: "คิวก๊วน", Icon: QueueIcon },
  { href: "/me", label: "ของฉัน", Icon: UserIcon },
];

export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <nav className="bottom-nav" aria-label="เมนูหลัก">
      {TABS.map(({ href, label, Icon }) => (
        <Link
          key={href}
          href={href}
          className={`tab ${isActive(href) ? "active" : ""}`}
          aria-current={isActive(href) ? "page" : undefined}
        >
          <Icon size={22} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
}
