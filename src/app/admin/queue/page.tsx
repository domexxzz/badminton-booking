import Link from "next/link";

export default function AdminQueuePage() {
  return <section className="stack">
    <div className="page-head"><h1>คิวก๊วน</h1></div>
    <div className="card stack">
      <h2>ระบบ Party</h2>
      <p className="muted">เจ้าของห้องเป็นผู้จัดการสมาชิกและทีม ห้องจะเปิดอัตโนมัติเมื่อชำระค่าจองสนามผ่านแล้ว</p>
      <Link className="btn btn-block" href="/queue">ดูห้องก๊วนทั้งหมด</Link>
    </div>
  </section>;
}
