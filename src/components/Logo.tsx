import React from "react";

type LogoSize = "sm" | "md" | "lg" | "xl";
type LogoTheme = "dark" | "light";

interface LogoProps {
  size?: LogoSize; // default 'md'
  theme?: LogoTheme; // default 'dark'
  /** Chevron + "PURE" only — the phone-header mark. The full wordmark is ~150px,
   *  which is what kept blowing the 360-390px header budget and clipping controls. */
  compact?: boolean;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string; // default 'PureProperty.ca home'
}

// Size scale — these are the ONLY allowed sizes. Do not introduce intermediates.
const SIZE_MAP = {
  sm: { fontSize: 14, chevW: 8, chevH: 14, stroke: 1.75, gap: 6, offsetY: 1 },
  md: { fontSize: 18, chevW: 11, chevH: 18, stroke: 2.0, gap: 8, offsetY: 2 },
  lg: { fontSize: 28, chevW: 17, chevH: 28, stroke: 2.5, gap: 12, offsetY: 3 },
  xl: { fontSize: 44, chevW: 26, chevH: 44, stroke: 3.5, gap: 18, offsetY: 5 },
} as const;

export const Logo: React.FC<LogoProps> = ({
  size = "md",
  theme = "dark",
  compact = false,
  className = "",
  onClick,
  ariaLabel = "PureProperty.ca home",
}) => {
  const s = SIZE_MAP[size];
  const primary = theme === "dark" ? "var(--pp-text-primary)" : "var(--pp-text-primary-light)";
  const secondary = theme === "dark" ? "var(--pp-text-secondary)" : "var(--pp-text-secondary-light)";
  const tertiary = theme === "dark" ? "var(--pp-text-tertiary)" : "var(--pp-text-tertiary-light)";

  // Chevron geometry inside its own viewBox
  const cx2 = s.chevW - 2;
  const cy1 = 2;
  const cym = s.chevH / 2;
  const cy2 = s.chevH - 2;

  return (
    <span
      className={className}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: `${s.gap}px`,
        cursor: onClick ? "pointer" : "default",
        userSelect: "none",
        fontFamily: "inherit",
        lineHeight: 1,
      }}
    >
      <svg
        width={s.chevW}
        height={s.chevH}
        viewBox={`0 0 ${s.chevW} ${s.chevH}`}
        style={{ display: "block", transform: `translateY(${s.offsetY}px)`, flexShrink: 0 }}
        aria-hidden="true"
      >
        <polyline
          points={`${cx2},${cy1} 2,${cym} ${cx2},${cy2}`}
          fill="none"
          stroke={primary}
          strokeWidth={s.stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span style={{ fontSize: `${s.fontSize}px`, fontWeight: 700, color: primary, letterSpacing: 0 }}>
        PURE
        {!compact && (
          <>
            <span style={{ fontWeight: 400, color: secondary }}>PROPERTY</span>
            <span style={{ fontWeight: 400, color: tertiary }}>.ca</span>
          </>
        )}
      </span>
    </span>
  );
};

export default Logo;
