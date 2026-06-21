import { ImageResponse } from "next/og";

/**
 * Shared Open Graph / Twitter card renderer (1200×630), served by the /og route handler.
 * One branded, on-theme template so every shared PureProperty link looks professional.
 * Flexbox-only (Satori constraint): every container with >1 child declares display:flex.
 * Uses the bundled default font (no remote fetch) to keep generation fast.
 */

const WIDTH = 1200;
const HEIGHT = 630;

export function renderOgImage(opts: { title: string; subtitle?: string; eyebrow?: string }) {
  const { title, subtitle, eyebrow } = opts;
  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "linear-gradient(135deg, #020617 0%, #0f172a 55%, #042f2e 100%)",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 20, height: 20, borderRadius: 5, background: "#34d399" }} />
          <div style={{ fontSize: 34, fontWeight: 700, color: "#e2e8f0", letterSpacing: "-0.02em" }}>
            PureProperty
          </div>
        </div>

        {/* Title block */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {eyebrow ? (
            <div
              style={{
                display: "flex",
                fontSize: 26,
                color: "#34d399",
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                fontWeight: 600,
                marginBottom: 18,
              }}
            >
              {eyebrow}
            </div>
          ) : null}
          <div
            style={{
              display: "flex",
              fontSize: 72,
              fontWeight: 800,
              color: "#f8fafc",
              lineHeight: 1.04,
              letterSpacing: "-0.03em",
              maxWidth: 1010,
            }}
          >
            {title}
          </div>
          {subtitle ? (
            <div style={{ display: "flex", fontSize: 30, color: "#94a3b8", marginTop: 22, maxWidth: 960 }}>
              {subtitle}
            </div>
          ) : null}
        </div>

        {/* Footer accent */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ height: 6, width: 64, background: "#34d399", borderRadius: 3 }} />
          <div style={{ display: "flex", fontSize: 24, color: "#64748b" }}>
            Ontario real estate, decoded · pureproperty.ca
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" },
    }
  );
}
