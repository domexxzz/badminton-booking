"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/review", label: "ตรวจสลิป / เงินเข้า" },
  { href: "/admin/requests", label: "คำขอ" },
  { href: "/admin/new", label: "เพิ่มการจอง" },
];

export function AdminNav({ reviewCount, requestCount }: { reviewCount: number; requestCount: number }) {
  const pathname = usePathname();
  return (
    <nav className="admin-tabs" aria-label="เมนูร้าน">
      {TABS.map(({ href, label }) => {
        const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className={`admin-tab ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
            {label}
            {href === "/admin/review" && reviewCount > 0 && <span className="count">{reviewCount}</span>}
            {href === "/admin/requests" && requestCount > 0 && <span className="count">{requestCount}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
