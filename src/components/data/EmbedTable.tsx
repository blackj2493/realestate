/**
 * Neutral table for the /embed widgets.
 *
 * DELIBERATELY NOT the Daylight/terminal look used on our own /data pages. An embed renders
 * inside SOMEONE ELSE'S article — almost always a light page — so it must read as a piece of
 * that publication, not as a foreign product tile. The branded dark widget looked like an ad
 * and screenshotted badly onto a white page, which is the opposite of what earns a citation.
 *
 * Rules this component follows, and why:
 *   • ZERO theme coupling. No `bg-card` / `text-foreground` / `--dt-*` / `dark:` variants —
 *     those resolve against the app's ThemeProvider (dark by default), which an iframe on a
 *     third-party site would inherit. Literal colours only, so the widget looks identical
 *     regardless of the visitor's theme.
 *   • System font stack, not the terminal mono. Numbers still use tabular figures so columns
 *     align — the one typographic thing publications genuinely need.
 *   • No decorative colour. The lead metric is weighted, not tinted, so the table stays
 *     legible in print, in greyscale, and against any publication's palette.
 */
import type { ReactNode } from "react";

export interface EmbedColumn<T> {
  label: string;
  align?: "left" | "right";
  value: (row: T) => ReactNode;
  /** The column the story is about — rendered heavier, never coloured. */
  lead?: boolean;
}

const FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export function EmbedTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
}: {
  columns: EmbedColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  /** Optional note directly under the table (e.g. what the lead column means). */
  caption?: string;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontFamily: FONT,
          fontSize: 14,
          color: "#0f172a",
          background: "#ffffff",
        }}
      >
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.label}
                scope="col"
                style={{
                  textAlign: c.align === "right" ? "right" : "left",
                  padding: "8px 12px",
                  borderBottom: "2px solid #0f172a",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "#475569",
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={getRowKey(row)} style={{ background: i % 2 ? "#f8fafc" : "#ffffff" }}>
              {columns.map((c) => (
                <td
                  key={c.label}
                  style={{
                    textAlign: c.align === "right" ? "right" : "left",
                    padding: "9px 12px",
                    borderBottom: "1px solid #e2e8f0",
                    fontWeight: c.lead ? 700 : 400,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && (
        <p style={{ fontFamily: FONT, fontSize: 12, color: "#64748b", margin: "8px 0 0", lineHeight: 1.5 }}>
          {caption}
        </p>
      )}
    </div>
  );
}
