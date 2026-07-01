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
          light/dark toggle lives here (a clean file) for now — fixed bottom-left to
          clear the header and the bottom-right discovery button. Move it into
          AppHeader once that WIP lands. */}
      <ThemeToggle className="fixed bottom-4 left-4 z-[60] inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-lg transition-colors hover:bg-muted" />
      {children}
    </>
  );
}
