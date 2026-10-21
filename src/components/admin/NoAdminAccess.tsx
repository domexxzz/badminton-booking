import Link from "next/link";
import { signOut } from "@/app/actions";

/**
 * Shown when a signed-in account without admin rights opens the back office.
 * A bare 404 left people retrying the link; this says which account they are
 * on and what to do next.
 */
export function NoAdminAccess({ displayName }: { displayName: string | null }) {
  return (
    <div className="app admin-app">
      <main className="app-main">
        <section className="card stack" style={{ gap: 12, marginTop: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }} aria-hidden="true">🔒</div>
          <h1 style={{ margin: 0 }}>บัญชีนี้ยังไม่มีสิทธิ์เข้าหลังร้าน</h1>
          <p className="muted" style={{ margin: 0 }}>
            ตอนนี้เข้าระบบอยู่ในชื่อ <strong>{displayName ?? "ผู้ใช้"}</strong>
          </p>
          <ol className="steps" style={{ textAlign: "left" }}>
            <li>ถ้าคุณเป็นพนักงานร้าน ส่งชื่อนี้ให้แอดมิน</li>
            <li>แอดมินเปิดหลังร้าน แท็บ “แอดมิน” แล้วกด “ตั้งเป็นแอดมิน” ที่ชื่อของคุณ</li>
            <li>กลับมาเปิดลิงก์นี้อีกครั้ง</li>
          </ol>
          <p className="muted" style={{ margin: 0 }}>
            ถ้าคิดว่าเข้าผิดบัญชี ให้ออกจากระบบแล้วเข้าใหม่ด้วยบัญชีที่เป็นแอดมิน
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <form action={signOut} style={{ flex: 1 }}>
              <button className="btn btn-ghost btn-block" type="submit">ออกจากระบบ</button>
            </form>
            <Link href="/" className="btn btn-block" style={{ flex: 1, textAlign: "center" }}>
              ไปหน้าจองสนาม
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
