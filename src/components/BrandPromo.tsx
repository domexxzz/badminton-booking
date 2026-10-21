import Link from "next/link";
import { ShuttleIcon } from "./icons";

export function BrandPromo() {
  return (
    <Link href="/book" className="brand-promo" aria-label="ออกไปเล่น ให้สุขภาพดีไปทุกวัน — จองสนาม">
      <div>
        <span className="brand-eyebrow">CHIVA GO × SINTHANI</span>
        <strong>PLAY. CONNECT.<br />FEEL GOOD.</strong>
        <span>ออกไปเล่น ให้สุขภาพดีไปทุกวัน</span>
      </div>
      <ShuttleIcon size={96} className="promo-shuttle" />
      <span className="promo-arrow" aria-hidden="true">↗</span>
    </Link>
  );
}
