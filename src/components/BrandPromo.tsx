import Image from "next/image";
import Link from "next/link";
import { ChevronRight } from "./icons";

export function BrandPromo() {
  return (
    <Link href="/book" className="promo-banner" aria-label="PLAY CONNECT EARN — เล่น สนุก สุขภาพดี ไปด้วยกัน">
      <Image
        src="/brand/03.png"
        alt="PLAY CONNECT EARN — เล่น สนุก สุขภาพดี ไปด้วยกัน"
        width={498}
        height={274}
        className="promo-banner-img"
      />
      <div className="promo-btn-circle" aria-hidden="true">
        <ChevronRight size={18} />
      </div>
    </Link>
  );
}
