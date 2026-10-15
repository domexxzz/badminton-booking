/** A badminton court drawn from above, used in place of a photo. */
export function CourtArt({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 140 92" role="img" aria-label={`ภาพ${label}`}>
      <rect width="140" height="92" rx="10" fill="#3f9d70" />
      <rect x="8" y="8" width="124" height="76" rx="2" fill="#4fae7f" stroke="#fff" strokeWidth="1.6" />
      <g stroke="#fff" strokeWidth="1.2" fill="none">
        <path d="M70 8v76" strokeWidth="2.2" strokeDasharray="3 2" />
        <path d="M8 16h124M8 76h124" />
        <path d="M50 8v76M90 8v76" />
        <path d="M18 8v76M122 8v76" />
        <path d="M18 46h32M90 46h32" />
      </g>
      <text x="70" y="52" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" opacity="0.9">
        {label}
      </text>
    </svg>
  );
}
