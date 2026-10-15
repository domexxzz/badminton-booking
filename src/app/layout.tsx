import type { Metadata, Viewport } from "next";
import { Prompt } from "next/font/google";
import "./globals.css";

const prompt = Prompt({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "แบดมินตัน@สินธานี - จองสนามแบดมินตัน",
  description: "ระบบจองสนามแบดมินตัน แบดมินตัน@สินธานี เช็คคิวว่างแบบเรียลไทม์ ชำระผ่าน PromptPay",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eef2f7",
};

// Each area brings its own shell: (customer)/layout.tsx and admin/layout.tsx.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={prompt.className}>
      <body>{children}</body>
    </html>
  );
}
