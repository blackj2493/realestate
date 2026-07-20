import type { ReactNode } from "react";

/**
 * Embed ground. The root layout's body carries the app's themed background (dark by
 * default), which an iframe on a third-party site would otherwise inherit — the widget
 * would render as a black box inside a white article. This wrapper paints an explicit
 * white ground and sets `color-scheme: light` so form/scrollbar chrome matches too.
 *
 * Kept outside the /data tree deliberately: no AppHeader, no site chrome — a widget must
 * be only the data plus its attribution.
 */
export default function EmbedLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "#ffffff", colorScheme: "light", minHeight: "100vh" }}>
      {children}
    </div>
  );
}
