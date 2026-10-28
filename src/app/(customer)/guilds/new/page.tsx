import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/supabase/server";
import { GuildCreateForm } from "@/components/guilds/GuildCreateForm";
import type { MyGuildInfo } from "@/lib/guilds/rules";

export const dynamic = "force-dynamic";

export default async function NewGuildPage() {
  const { supabase, user } = await getSessionUser();
  if (!user) {
    redirect("/login?next=/guilds/new");
  }

  // Check if user is already in a guild
  const { data: myGuildRows } = await supabase.rpc("my_guild");
  const myGuild = ((myGuildRows as unknown) as MyGuildInfo[] | null)?.[0] || null;

  if (myGuild?.guild_id) {
    return (
      <div className="stack" style={{ gap: 16 }}>
        <div className="page-head">
          <div>
            <h1>สร้างกิลด์ใหม่</h1>
            <p className="muted">คุณสังกัดกิลด์อยู่แล้ว</p>
          </div>
        </div>

        <div className="card stack" style={{ gap: 12, padding: 20, textAlign: "center" }}>
          <div style={{ fontSize: 36 }}>🛡️</div>
          <strong style={{ fontSize: 16 }}>คุณสังกัดกิลด์อยู่แล้วในขณะนี้</strong>
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            ระบบจำกัดให้ผู้เล่นหนึ่งคนสามารถสังกัดได้เพียง 1 กิลด์เท่านั้น หากต้องการสร้างกิลด์ใหม่ กรุณาออกจากกิลด์เดิมก่อน
          </p>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 8 }}>
            <Link href={`/guilds/${myGuild.guild_id}`} className="btn btn-primary">
              ไปยังกิลด์ของฉัน
            </Link>
            <Link href="/guilds" className="btn btn-ghost">
              ย้อนกลับ
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <Link href="/guilds" className="muted" style={{ textDecoration: "none" }}>
          ← กิลด์ทั้งหมด
        </Link>
      </div>

      <div className="page-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h1>สร้างกิลด์ก๊วนแบด</h1>
          <p className="muted">
            ตั้งชื่อ เลือกตราประจำกิลด์ และรวบรวมสมาชิกก๊วน สูงสุด 120 คน
          </p>
        </div>
      </div>

      <GuildCreateForm />
    </div>
  );
}
