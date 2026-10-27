import { ChevronDown } from "lucide-react";

/**
 * A section that is CLOSED on phones and always open on desktop (lg+), so the
 * long reference cards (data sheet, room map, schools) stop pushing the comps
 * carousels down the page. Pure CSS (a peer checkbox, same as Property History):
 * server-rendered, no client boundary, and the content stays in the HTML for
 * crawlers. Jumps into a closed section open it first: DetailMobileNav,
 * TheReadCard and Spotlight call expandCollapsedAncestors, which checks
 * `#<id>-toggle` on every ancestor of the target.
 */
export default function MobileCollapse({
  id,
  title,
  sub,
  className,
  children,
}: {
  id: string;
  title: string;
  /** One line under the title that says what is inside. */
  sub?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div id={id} className={`scroll-mt-28 ${className ?? ""}`}>
      <input type="checkbox" id={`${id}-toggle`} className="peer sr-only" />
      <label
        htmlFor={`${id}-toggle`}
        className="mb-3 flex min-h-[52px] cursor-pointer select-none items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-500 peer-checked:[&_svg]:rotate-180 lg:hidden dark:bg-card/40"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-foreground">{title}</span>
          {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform" aria-hidden />
      </label>
      <div className="hidden peer-checked:block lg:block">{children}</div>
    </div>
  );
}
