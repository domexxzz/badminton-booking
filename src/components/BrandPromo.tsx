import Link from "next/link";
import { ChevronRight } from "./icons";

export function BrandPromo() {
  return (
    <Link href="/book" className="promo-banner" aria-label="PLAY CONNECT EARN — เล่น สนุก สุขภาพดี ไปด้วยกัน">
      <div className="promo-content">
        <div className="promo-headings">
          <span>PLAY</span>
          <span>CONNECT</span>
          <span>EARN</span>
        </div>
        <p className="promo-sub">เล่น สนุก สุขภาพดี ไปด้วยกัน</p>
      </div>

      <div className="promo-players-art" aria-hidden="true">
        {/* Badminton player silhouettes and dynamic motion swooshes */}
        <svg
          viewBox="0 0 220 140"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="promo-svg"
        >
          {/* Dynamic background light streaks */}
          <path
            d="M-20 160 L140 -20 L180 -20 L20 160 Z"
            fill="url(#streak1)"
            opacity="0.35"
          />
          <path
            d="M30 160 L190 -20 L230 -20 L70 160 Z"
            fill="url(#streak2)"
            opacity="0.25"
          />

          {/* Player 1 (Smashing badminton player) */}
          <g transform="translate(45, 12)" fill="url(#playerGrad1)">
            {/* Head */}
            <circle cx="48" cy="22" r="7" />
            {/* Torso & arm */}
            <path d="M42 30 Q46 48 40 68 L48 70 Q54 48 54 30 Z" />
            {/* Right arm reaching up with racket */}
            <path d="M53 32 L66 16 L74 6" stroke="url(#playerGrad1)" strokeWidth="4.5" strokeLinecap="round" />
            {/* Racket shaft & head */}
            <path d="M74 6 L86 -6" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
            <ellipse cx="94" cy="-14" rx="8" ry="11" transform="rotate(35 94 -14)" stroke="#ffffff" strokeWidth="2" fill="none" opacity="0.9" />
            <path d="M88 -20 L100 -8 M89 -9 L99 -19" stroke="#ffffff" strokeWidth="1" opacity="0.6" />
            {/* Left arm */}
            <path d="M42 34 L30 42 L22 46" stroke="url(#playerGrad1)" strokeWidth="4" strokeLinecap="round" />
            {/* Legs in jump */}
            <path d="M42 66 L36 90 L30 112" stroke="url(#playerGrad1)" strokeWidth="5" strokeLinecap="round" />
            <path d="M48 68 L56 86 L68 98" stroke="url(#playerGrad1)" strokeWidth="5" strokeLinecap="round" />
          </g>

          {/* Player 2 (Ready / lunging player with racket) */}
          <g transform="translate(105, 32)" fill="url(#playerGrad2)">
            {/* Head */}
            <circle cx="34" cy="24" r="6.5" />
            {/* Torso */}
            <path d="M29 32 Q32 48 26 64 L34 66 Q40 48 39 32 Z" />
            {/* Arm with racket raised */}
            <path d="M38 34 L48 24 L56 16" stroke="url(#playerGrad2)" strokeWidth="4" strokeLinecap="round" />
            {/* Racket */}
            <path d="M56 16 L65 7" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" opacity="0.9" />
            <ellipse cx="72" cy="0" rx="7" ry="9.5" transform="rotate(25 72 0)" stroke="#ffffff" strokeWidth="1.8" fill="none" opacity="0.9" />
            {/* Other arm */}
            <path d="M28 36 L18 42 L12 40" stroke="url(#playerGrad2)" strokeWidth="3.5" strokeLinecap="round" />
            {/* Lunging legs */}
            <path d="M27 63 L22 82 L12 96" stroke="url(#playerGrad2)" strokeWidth="4.5" strokeLinecap="round" />
            <path d="M33 65 L44 80 L56 94" stroke="url(#playerGrad2)" strokeWidth="4.5" strokeLinecap="round" />
          </g>

          {/* Gradients */}
          <defs>
            <linearGradient id="streak1" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#4ade80" stopOpacity="0" />
              <stop offset="50%" stopColor="#86efac" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="streak2" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0" />
              <stop offset="50%" stopColor="#a7f3d0" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="playerGrad1" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1e3a34" />
              <stop offset="100%" stopColor="#0d2621" />
            </linearGradient>
            <linearGradient id="playerGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1e3a34" />
              <stop offset="100%" stopColor="#0d2621" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="promo-btn-circle" aria-hidden="true">
        <ChevronRight size={18} />
      </div>
    </Link>
  );
}
