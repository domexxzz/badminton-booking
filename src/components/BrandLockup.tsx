import Image from "next/image";
import Link from "next/link";

/** Sinthani Badminton Club header brand lockup. */
export function BrandLockup() {
  return (
    <Link href="/" className="brand-lockup" aria-label="สินธานี BADMINTON CLUB × ChivarGO — หน้าแรก">
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
      <span className="brand-cross" aria-hidden="true">
        ×
      </span>
      <Image
        src="/brand/chivargo-mark.webp"
        alt="ChivarGO"
        width={40}
        height={40}
        className="brand-chivargo"
      />
    </Link>
  );
}
