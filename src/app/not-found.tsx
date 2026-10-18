import Link from "next/link";

// Thai 404 instead of Next's default English page.
export default function NotFound() {
  return (
    <div className="app">
      <main className="app-main">
        <section className="card stack" style={{ gap: 12, marginTop: 24, textAlign: "center" }}>
          <div style={{ fontSize: 40 }} aria-hidden="true">🏸</div>
          <h1 style={{ margin: 0 }}>ไม่พบหน้านี้</h1>
          <p className="muted" style={{ margin: 0 }}>
            ลิงก์อาจพิมพ์ผิด หรือเป็นการจองของบัญชีอื่น ถ้าเปิดจากลิงก์การจอง ให้เช็คว่าเข้าระบบด้วยบัญชีเดียวกับที่จองไว้
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/me" className="btn btn-ghost btn-block" style={{ flex: 1, textAlign: "center" }}>
              การจองของฉัน
            </Link>
            <Link href="/" className="btn btn-block" style={{ flex: 1, textAlign: "center" }}>
              หน้าแรก
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
