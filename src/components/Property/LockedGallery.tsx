"use client";

import { useState } from "react";
import { Lock, CameraOff } from "lucide-react";
import SignInLink from "@/components/auth/SignInLink";

/**
 * What an anonymous visitor sees in place of a sold/leased listing's gallery.
 *
 * Two different situations wear the same "no photos" look today, and conflating them is
 * the bug: 5,015 sold listings HAVE photos the page never showed, and ~20,320 genuinely
 * have none. Promising a gallery that doesn't exist is worse than an empty box, so the
 * count decides which of these renders — it comes from `photoTeaser`, the one photo fact
 * that survives VOW gating.
 *
 * The backdrop is /api/property/[id]/photo-blur: a 24px-wide, server-blurred derivative.
 * The real URL is never sent to the browser (see that route), so this is a genuine gate,
 * not a CSS effect over a photo that is really there.
 */
export function LockedGallery({
  listingKey,
  count,
  label,
  className = "",
}: {
  listingKey: string;
  /** Photos behind the gate. 0 renders the honest empty state instead. */
  count: number;
  /** "SOLD" | "LEASED" — so the copy matches the badge above it. */
  label?: string;
  className?: string;
}) {
  // The blur is best-effort: a listing whose photo origin 404s should degrade to the plain
  // lock, never to a broken-image icon.
  const [blurFailed, setBlurFailed] = useState(false);

  if (count <= 0) return <NoPhotos className={className} />;

  const noun = count === 1 ? "photo" : "photos";
  const what = label === "LEASED" ? "this lease" : "this sale";

  return (
    <div className={`relative overflow-hidden rounded-md bg-card ${className}`}>
      {!blurFailed && (
        // eslint-disable-next-line @next/next/no-img-element -- a 24px redaction, not a
        // photo: next/image would add an optimizer round trip to ~400 bytes we already own.
        <img
          src={`/api/property/${encodeURIComponent(listingKey)}/photo-blur`}
          alt=""
          aria-hidden="true"
          onError={() => setBlurFailed(true)}
          className="absolute inset-0 h-full w-full scale-110 object-cover"
        />
      )}
      {/* Scrim keeps the foreground legible over whatever colours the blur happens to be. */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/55 via-slate-950/65 to-slate-950/80" />

      <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-900/70 backdrop-blur-sm">
          <Lock className="h-5 w-5 text-white" />
        </div>
        <p className="mt-3 font-mono text-sm font-bold tracking-wide text-white">
          {count} {noun.toUpperCase()}
        </p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-white/75">
          Real estate board rules limit photos of {what} to signed-in members.
        </p>
        <SignInLink className="mt-4 inline-flex min-h-[40px] items-center rounded-lg border border-cyan-400/60 bg-cyan-500/20 px-4 text-sm font-bold text-cyan-50 backdrop-blur-sm transition-colors hover:bg-cyan-500/30">
          Sign in free to view
        </SignInLink>
      </div>
    </div>
  );
}

/** No photos exist for this record — say so plainly rather than implying a locked gallery. */
export function NoPhotos({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-md bg-card ${className}`}
    >
      <CameraOff className="mb-2 h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-medium text-foreground">No photos on this record</p>
      <p className="mt-1 max-w-xs px-6 text-center text-xs leading-relaxed text-muted-foreground">
        This listing reached us without any, and the board doesn&rsquo;t supply them after a
        listing closes.
      </p>
    </div>
  );
}
