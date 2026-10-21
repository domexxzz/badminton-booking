import Image from "next/image";
import Link from "next/link";

/** Sinthani Badminton Club header brand lockup. */
export function BrandLockup() {
  return (
    <Link href="/" className="brand-lockup" aria-label="สินธานี BADMINTON CLUB — หน้าแรก">
      <Image
        src="/brand/logo.png"
        alt="สินธานีแบดมินตัน"
        width={48}
        height={48}
        className="brand-sinthani"
        priority
      />
      <div className="brand-lockup-text">
        <strong className="brand-title">สินธานี</strong>
        <span className="brand-subtitle">BADMINTON CLUB</span>
      </div>
    </Link>
  );
}
