import AppHeader from "@/components/layout/AppHeader";
import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * Layout for the (app) route group — renders the unified AppHeader above every
 * authenticated app page (dashboard, listings, analytics, avm, property detail,
 * compare). Route groups do NOT change URLs. The /properties terminal lives
 * OUTSIDE this group so it keeps its own full-height TopCommandBar.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader variant="app" />
      {/* Interim toggle home: AppHeader.tsx has unrelated uncommitted WIP, so the
          light/dark toggle lives here (a clean file) for now — a labelled pill fixed
          at bottom-left, raised (bottom-20) to clear the Next.js dev "Issues" indicator
          and the bottom-right discovery button. Move it into AppHeader once that WIP lands. */}
      <ThemeToggle
        showLabel
        className="fixed bottom-20 left-4 z-[60] inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2.5 text-foreground shadow-lg ring-1 ring-primary/40 transition-colors hover:bg-muted"
      />
      {children}
    </>
  );
}
