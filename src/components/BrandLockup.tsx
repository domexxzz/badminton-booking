import Image from "next/image";
import Link from "next/link";

/** Original supplied brand artwork; keep each logo's proportions intact. */
export function BrandLockup() {
  return (
    <Link href="/" className="brand-lockup" aria-label="ChivaGo × แบดมินตัน@สินธานี — หน้าแรก">
      <Image src="/brand/chivago-logo.png" alt="ChivaGo" width={88} height={58} className="brand-chivago" priority />
      <span className="brand-cross" aria-hidden="true">×</span>
      <Image src="/brand/sinthani-logo.png" alt="สินธานีแบดมินตัน" width={54} height={54} className="brand-sinthani" priority />
    </Link>
  );
}
