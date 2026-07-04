/**
 * Terminal (/properties) layout.
 *
 * The terminal now follows the global light/dark choice like the rest of the app
 * (it was previously pinned dark). Its components resolve the shared design tokens,
 * so dark renders the original Bloomberg-style surface and light renders the
 * Daylight terminal. A bare fragment keeps the terminal's full-height flex/grid
 * layout untouched (no wrapper box).
 */
export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
