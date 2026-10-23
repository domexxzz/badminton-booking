import { GoogleIcon, ShuttleIcon } from "@/components/icons";
import { isLineLoginEnabled } from "@/lib/line/config";
import { safeNext } from "@/lib/safe-next";
import { LoginForm } from "./LoginForm";

const ERRORS: Record<string, string> = {
  link: "ลิงก์หมดอายุหรือไม่ถูกต้อง กรุณาขอลิงก์ใหม่",
  line_cancelled: "ยกเลิกการเข้าสู่ระบบด้วย LINE",
  line_state: "การเข้าสู่ระบบหมดเวลา กรุณาลองใหม่",
  line_failed: "เข้าสู่ระบบด้วย LINE ไม่สำเร็จ กรุณาลองใหม่",
  line_unavailable: "ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย LINE",
  google_failed: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next: rawNext, error } = await searchParams;
  const next = safeNext(rawNext);
  const lineEnabled = isLineLoginEnabled();
  return (
    <section className="card stack" style={{ marginTop: 24, textAlign: "center" }}>
      <span className="quick" style={{ boxShadow: "none", padding: 0, background: "none" }}>
        <span className="icon" style={{ width: 64, height: 64 }}>
          <ShuttleIcon size={34} />
        </span>
      </span>
      <div>
        <h1>เข้าสู่ระบบ</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>เพื่อจองสนามและดูการจองของคุณ</p>
      </div>
      {error && <p className="error">{ERRORS[error] ?? ERRORS.link}</p>}
      <div className="login-oauth-buttons stack" style={{ gap: 10 }}>
        {lineEnabled && (
          <a className="btn btn-line btn-block" href={`/auth/line?next=${encodeURIComponent(next)}`}>
            เข้าสู่ระบบด้วย LINE
          </a>
        )}
        <a className="btn btn-google btn-block" href={`/auth/google?next=${encodeURIComponent(next)}`}>
          <GoogleIcon size={18} />
          <span>เข้าสู่ระบบด้วย Google</span>
        </a>
      </div>
      <details open={!lineEnabled} style={{ textAlign: "left" }}>
        <summary className="muted">หรือเข้าด้วยอีเมล (Magic link)</summary>
        <p className="muted">กรอกอีเมล แล้วเราจะส่งลิงก์เข้าสู่ระบบให้ ไม่ต้องตั้งรหัสผ่าน</p>
        <LoginForm next={next} />
      </details>
    </section>
  );
}
