import React from "react";
import type { GuildEmblem as EmblemName } from "@/lib/guilds/rules";

interface GuildEmblemProps {
  emblem: string;
  color?: string;
  size?: "sm" | "md" | "lg" | "xl";
  level?: number;
  className?: string;
}

export function GuildEmblem({
  emblem,
  color = "#0f766e",
  size = "md",
  level,
  className = "",
}: GuildEmblemProps) {
  const pixelSizes = {
    sm: 34,
    md: 48,
    lg: 64,
    xl: 84,
  };
  const px = pixelSizes[size] || 48;
  const iconPx = Math.round(px * 0.55);

  const renderIcon = (name: string) => {
    switch (name) {
      case "racket":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <ellipse cx="14.5" cy="9.5" rx="6.5" ry="6.5" />
            <path d="m9.9 14.1-6.4 6.4a1.4 1.4 0 0 0 2 2l6.4-6.4" />
            <path d="M12 9.5h5" />
            <path d="M14.5 7v5" />
          </svg>
        );
      case "crown":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14v2H5z" />
          </svg>
        );
      case "fire":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
          </svg>
        );
      case "bolt":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        );
      case "star":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        );
      case "shield":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
        );
      case "dragon":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 19 4-2 3 3 5-3-2-5 3-4-4-1-2 3-3-1-3 5 2 3z" />
            <path d="M14 6l5-3 2 2-2 5" />
            <circle cx="16" cy="9" r="1" fill="currentColor" />
          </svg>
        );
      case "tiger":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="m8 9 2 2" />
            <path d="m16 9-2 2" />
            <path d="M9 16c1.5 1 4.5 1 6 0" />
            <path d="M12 12v2" />
          </svg>
        );
      case "eagle":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 13c3-3 6-5 9-5s6 2 9 5c-3 1-5 3-9 3s-6-2-9-3z" />
            <path d="M12 8v8" />
            <path d="M8 11l4 5 4-5" />
          </svg>
        );
      case "wave":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12c2.5-4 5.5-4 8 0s5.5 4 8 0 4-2 4-2" />
            <path d="M2 17c2.5-4 5.5-4 8 0s5.5 4 8 0 4-2 4-2" />
          </svg>
        );
      case "leaf":
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
          </svg>
        );
      case "shuttle":
      default:
        return (
          <svg width={iconPx} height={iconPx} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 18a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            <path d="M8.5 12L4 4" />
            <path d="M15.5 12L20 4" />
            <path d="M12 10V2" />
            <path d="M6 5.5h12" />
          </svg>
        );
    }
  };

  return (
    <div
      className={`guild-emblem-wrap ${className}`}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: px,
        height: px,
        minWidth: px,
        minHeight: px,
        borderRadius: "28%",
        background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 75%, #000))`,
        color: "#ffffff",
        boxShadow: `0 4px 12px ${color}40`,
        flexShrink: 0,
      }}
    >
      {renderIcon(emblem)}
      {level !== undefined && (
        <span
          style={{
            position: "absolute",
            bottom: -4,
            right: -4,
            background: "#1f2937",
            color: "#fbbf24",
            border: "2px solid #ffffff",
            borderRadius: 999,
            fontSize: size === "sm" ? 9 : size === "xl" ? 13 : 11,
            fontWeight: 800,
            padding: size === "sm" ? "1px 4px" : "2px 6px",
            lineHeight: 1,
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          }}
        >
          {level}
        </span>
      )}
    </div>
  );
}
