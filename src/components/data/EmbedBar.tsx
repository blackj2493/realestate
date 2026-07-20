"use client";

/**
 * Embed control for a tracker page. Reveals a copy-paste snippet that iframes the
 * bare /embed/<slug> widget AND — crucially for link equity — a real <a> attribution
 * link back to the /data page (an iframe src alone is not a crawlable backlink).
 */
import { useState } from "react";
import { Code2, Check, Copy } from "lucide-react";

export function EmbedBar({
  embedUrl,
  pageUrl,
  title,
}: {
  embedUrl: string;
  pageUrl: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const snippet =
    `<iframe src="${embedUrl}" width="100%" height="640" style="border:1px solid #e2e8f0;border-radius:8px;max-width:760px" title="${title}" loading="lazy"></iframe>\n` +
    `<p style="font:12px/1.4 system-ui,sans-serif;margin:6px 0 0">Source: <a href="${pageUrl}">${title} — PureProperty.ca</a></p>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — the textarea is selectable as a fallback */
    }
  };

  return (
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan-500/40 hover:text-foreground"
      >
        <Code2 className="h-3.5 w-3.5" /> Embed this
      </button>
      {open && (
        <div className="mt-2 max-w-xl rounded-md border border-border bg-card/40 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Free to embed on your site. The snippet includes a link back to PureProperty.
          </p>
          <textarea
            readOnly
            value={snippet}
            onFocus={(e) => e.currentTarget.select()}
            className="h-28 w-full resize-none rounded border border-border bg-background p-2 font-mono text-[11px] leading-relaxed text-foreground"
          />
          <button
            type="button"
            onClick={copy}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-700 transition-colors hover:bg-cyan-500/20 dark:text-cyan-300"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copy embed code
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
