import Link from "next/link";
import { Lock } from "lucide-react";

export default function LockedCell({ next }: { next?: string }) {
  const content = (
    <>
      <Lock className="h-3.5 w-3.5 text-cyan-400/70" />
      <span aria-hidden="true" className="select-none blur-[2px]">•••</span>
    </>
  );

  // On mobile the locked cell is the highest-intent anon moment — make the whole
  // cell a tap target into the sign-in flow. Desktop (no `next` passed) keeps the
  // original inert span so the table is visually unchanged.
  if (next) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="inline-flex items-center gap-1 text-muted-foreground"
        title="Sign in to view"
      >
        {content}
      </Link>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground" title="Sign in to view">
      {content}
    </span>
  );
}
