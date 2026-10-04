import AreaFollowPrompt from "@/components/areas/AreaFollowPrompt";
import SaveHomeHint from "@/components/watchlist/SaveHomeHint";

/**
 * Terminal (/properties) layout.
 *
 * The terminal now follows the global light/dark choice like the rest of the app
 * (it was previously pinned dark). Its components resolve the shared design tokens,
 * so dark renders the original Bloomberg-style surface and light renders the
 * Daylight terminal. A bare fragment keeps the terminal's full-height flex/grid
 * layout untouched (no wrapper box).
 *
 * AreaFollowPrompt is the one addition, and it is `fixed` — out of flow, so the fragment
 * above still wraps nothing but the terminal's own tree. It renders null unless the visitor
 * is signed in and follows no area. The terminal sits outside the (app) route group, so it
 * needs its own mount; without this the map-first users, who are most of the population it
 * targets, would never see it.
 *
 * SaveHomeHint shares that corner but only for a reader who DOES follow an area and has no
 * saved home, so at most one of the two ever renders.
 */
export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AreaFollowPrompt variant="floating" />
      <SaveHomeHint />
    </>
  );
}
