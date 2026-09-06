import AppHeader from "@/components/layout/AppHeader";
import SiteFooter from "@/components/layout/SiteFooter";
import AreaFollowPrompt from "@/components/areas/AreaFollowPrompt";

/**
 * Layout for the (app) route group — renders the unified AppHeader above every
 * authenticated app page (dashboard, listings, analytics, avm, property detail,
 * compare). Route groups do NOT change URLs. The /properties terminal lives
 * OUTSIDE this group so it keeps its own full-height TopCommandBar.
 *
 * SiteFooter rides along here (and on /data) rather than in the root layout: the
 * homepage is a full-bleed hero over a Mapbox canvas, the terminal owns its own
 * full-height chrome, and /embed/* must stay chrome-free for iframing. This group is
 * every page with ordinary document flow.
 *
 * AreaFollowPrompt rides here rather than on /dashboard because the accounts it exists for
 * are the ones that stopped opening the dashboard — see that component. It renders nothing
 * unless the visitor is signed in and follows no area at all. The terminal, being outside
 * this group, mounts its own copy.
 */
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AppHeader variant="app" />
      <AreaFollowPrompt />
      {children}
      <SiteFooter />
    </>
  );
}
