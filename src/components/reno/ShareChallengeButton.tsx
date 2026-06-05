'use client';

import { useState } from 'react';
import { Share2, Check } from 'lucide-react';

/**
 * Curiosity-gap share (loop A). The link carries ONLY the community slug — no
 * VOW-derived number is ever shared. The destination's generateMetadata renders
 * the branded OG card. Uses the Web Share API where available, else copies the link.
 */
export default function ShareChallengeButton({
  communitySlug,
  community,
}: {
  communitySlug: string | null;
  community: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const where = community ? ` ${community}` : '';
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/whats-my-home-hiding${communitySlug ? `?community=${communitySlug}` : ''}`
      : '';
  const text = `I just found the hidden renovation upside in my home. What's hiding in your${where} home?`;

  const onShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'What’s my home hiding?', text, url });
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  return (
    <button
      type="button"
      onClick={onShare}
      className="flex w-full items-center justify-center gap-2 rounded-md border border-emerald-700 bg-emerald-950/40 px-4 py-2.5 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-900/40"
    >
      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
      {copied ? 'Link copied' : `Challenge a neighbour`}
    </button>
  );
}
