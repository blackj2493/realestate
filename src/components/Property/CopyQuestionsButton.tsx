"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { track } from "@/lib/analytics/posthog";

/**
 * Copies the card's "worth asking" prompts as a ready-made question sheet for a
 * showing, an agent, or a lawyer. The text is built server-side by
 * formatDiligenceQuestions (diligence.ts) so the formatter stays out of the client
 * bundle. Same degrade-quietly clipboard pattern as ShareDialog.
 */
export default function CopyQuestionsButton({
  text,
  listingId,
  count,
}: {
  text: string;
  listingId: string;
  count: number;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      track("diligence_questions_copied", { listingId, count });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (permissions / insecure context) — quietly do nothing.
    }
  };

  return (
    <button
      type="button"
      onClick={onCopy}
      title="Copy the 'worth asking' questions for your agent, lawyer or showing"
      className="flex min-h-[28px] shrink-0 items-center gap-1 rounded border border-border px-2 font-mono text-[10px] font-semibold normal-case tracking-normal text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-cyan-700 active:bg-muted dark:hover:text-cyan-300"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied" : "Copy questions"}
    </button>
  );
}
