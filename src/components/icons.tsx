// Small inline icon set (stroke icons, inherit currentColor). No icon library needed.
type IconProps = { size?: number; className?: string };

function Svg({ size = 24, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M7.5 14h.01M12 14h.01M16.5 14h.01M7.5 17.5h.01M12 17.5h.01" />
  </Svg>
);

/** A badminton court seen from above. */
export const CourtIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="2.5" width="16" height="19" rx="1.5" />
    <path d="M4 12h16M8 2.5v19M16 2.5v19M8 7h8M8 17h8" />
  </Svg>
);

/** Two speech bubbles: the community feed. */
export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h8A2.5 2.5 0 0 1 17 5.5v5a2.5 2.5 0 0 1-2.5 2.5H9l-3.5 3v-3H6.5A2.5 2.5 0 0 1 4 10.5z" />
    <path d="M17 8h.5A2.5 2.5 0 0 1 20 10.5v5a2.5 2.5 0 0 1-2.5 2.5h-.5v3l-3.5-3h-3A2.5 2.5 0 0 1 8 15.5V15" />
  </Svg>
);

export const UserIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
  </Svg>
);

export const ShieldIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v6c0 4.5 3.2 7.8 7.5 9 4.3-1.2 7.5-4.5 7.5-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Svg>
);

export const ChevronLeft = (p: IconProps) => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
);

export const ChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const ClockIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);

export const ReceiptIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
    <path d="M9 8h6M9 12h6" />
  </Svg>
);

/** Shuttlecock, used as a decorative mark. */
export const ShuttleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7" cy="17" r="3" />
    <path d="m9.2 14.8 8.3-8.3M9 13l6.5-9 4.5 4.5-9 6.5M12 10l2 2M14.5 7.5l2 2" />
  </Svg>
);

export const ChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
);

export const CalendarGridIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4" />
    <path d="M7.5 13h2M14.5 13h2M7.5 17h2M14.5 17h2" />
  </Svg>
);

export const CalendarGraphIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4" />
    <path d="m7 16 3-3 2.5 2 4.5-4.5" />
  </Svg>
);

export const ClipboardListIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1.5" />
    <path d="M8 11h8M8 15h8M8 19h5" />
  </Svg>
);

export const UserCircleIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="7.5" r="3.5" />
    <path d="M5.5 19.5c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5" />
  </Svg>
);

export const CourtOutlineIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 12h18M7.5 3v18M16.5 3v18M7.5 7.5h9M7.5 16.5h9" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Svg>
);

export const QueueIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="7" r="3" />
    <path d="M2.5 20v-1.5A4.5 4.5 0 0 1 7 14h2a4.5 4.5 0 0 1 4.5 4.5V20" />
    <circle cx="17" cy="8.5" r="2.4" />
    <path d="M16 14h1.5a4 4 0 0 1 4 4v2" />
  </Svg>
);

export const GoogleIcon = ({ size = 20, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.66v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.15Z"
    />
    <path
      fill="#34A853"
      d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.26v3.15C3.25 21.36 7.31 24 12 24Z"
    />
    <path
      fill="#FBBC05"
      d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.26C.46 8.17 0 9.97 0 12s.46 3.83 1.26 5.42l4.02-3.15Z"
    />
    <path
      fill="#EA4335"
      d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.25 2.64 1.26 6.58l4.02 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
    />
  </svg>
);

