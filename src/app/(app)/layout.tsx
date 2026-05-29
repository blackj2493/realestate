import AppHeader from "@/components/layout/AppHeader";

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
      {children}
    </>
  );
}
