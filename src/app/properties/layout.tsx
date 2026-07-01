/**
 * Terminal (/properties) stays DARK regardless of the global light/dark choice — it's
 * a data-dense, Bloomberg-style pro surface designed dark (see LIGHT_DARK_THEME_PLAN).
 *
 * We scope the `dark` class here so the whole terminal subtree resolves the dark CSS
 * tokens even when the rest of the site is in light mode. `display:contents` removes
 * this wrapper's own box so the terminal's full-height flex/grid layout is untouched
 * (custom properties + color-scheme still inherit through a display:contents element).
 */
export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dark" style={{ display: "contents" }}>
      {children}
    </div>
  );
}
