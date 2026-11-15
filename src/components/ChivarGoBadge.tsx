import Image from "next/image";

/** ChivarGO partner badge. Shown at the end of the home page and on the profile page. */
export function ChivarGoBadge() {
  return (
    <aside className="chivargo-badge">
      <Image
        src="/brand/chivargo-logo.webp"
        alt="ChivarGO"
        width={132}
        height={132}
        className="chivargo-badge-logo"
      />
      <div className="chivargo-badge-text">
        <span className="chivargo-badge-eyebrow">พาร์ทเนอร์</span>
        <strong>ร่วมกับ ChivarGO</strong>
        <span className="chivargo-badge-note">เที่ยวไทยอย่างยั่งยืน ไปด้วยกันกับสินธานี</span>
      </div>
    </aside>
  );
}
