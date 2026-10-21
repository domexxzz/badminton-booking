import Image from "next/image";

/** Decorative architectural illustration, not a photograph of a particular court. */
export function CourtArt({ label }: { label: string }) {
  return (
    <Image
      src="/brand/court-hero.png"
      alt={`ภาพประกอบ${label}`}
      width={560}
      height={360}
      sizes="(max-width: 480px) 44vw, 210px"
      className="court-art"
    />
  );
}
