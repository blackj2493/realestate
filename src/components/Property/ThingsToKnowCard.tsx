import { AlertTriangle, Info, ShieldCheck } from "lucide-react";
import type { DiligenceFlag } from "@/lib/property/diligence";
import { formatDiligenceQuestions } from "@/lib/property/diligence";
import { ACTIVE_DATASETS } from "@/lib/property/geoDatasets";
import CopyQuestionsButton from "./CopyQuestionsButton";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-05-14" → "May 2026" — manual, so SSR output never drifts with locale/TZ. */
function fmtAsOf(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(iso);
  if (!m) return null;
  const mi = Number(m[2]) - 1;
  return mi >= 0 && mi < 12 ? `${MONTHS[mi]} ${m[1]}` : null;
}

/**
 * Things to Know — the interpretive diligence layer (sourced facts + "worth asking"
 * prompts), distinct from PropertyDataSheet's verbatim risk group. Server component:
 * no interactivity beyond the copy-questions island, so the facts render server-side
 * and are crawlable.
 *
 * `geoChecked` gates every "clear" claim: the enrichment writes flags=[] both when a
 * listing is genuinely clear AND when it had no trustworthy coord — only checked=true
 * rows may say "checked & clear" (migration 054).
 */
export default function ThingsToKnowCard({
  flags,
  geoChecked = false,
  address,
  listingId,
}: {
  flags: DiligenceFlag[];
  geoChecked?: boolean;
  address: string;
  listingId: string;
}) {
  // Hazard (warn-kind) datasets that were checked and did NOT flag — the "clear" list.
  // Info datasets (e.g. transit proximity) are upside context; their absence isn't
  // "clear" news, so they stay out of the claim.
  const flaggedIds = new Set(flags.map((f) => f.id));
  const warnDatasets = ACTIVE_DATASETS.filter((d) => d.flag.kind === "warn");
  const clearLabels = geoChecked
    ? warnDatasets.filter((d) => !flaggedIds.has(d.flag.id)).map((d) => d.shortLabel)
    : [];

  // Nothing to show AND no completed check to report → render nothing (pre-054 behavior).
  if (!flags.length && !geoChecked) return null;

  // ── Checked & clear: the diligence layer stays visible on clean listings ──
  if (!flags.length) {
    return (
      <section data-tour="listing-things-to-know" className="mb-6 rounded-xl border border-emerald-500/25 bg-card/40 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Things to Know
          <span className="ml-auto font-mono text-[10px] font-semibold text-muted-foreground">
            public records &amp; disclosures
          </span>
        </h3>
        <p className="flex items-start gap-2 text-[13px] leading-relaxed text-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>
            Checked against {warnDatasets.length} public hazard datasets — {clearLabels.join(", ")} —
            nothing flagged, and the listing carries no disclosure flags we track.
          </span>
        </p>
        <p className="mt-3 font-mono text-[10px] text-muted-foreground">
          Sourced facts &amp; disclosures, surfaced for your due diligence — not advice. Verify on site.
        </p>
      </section>
    );
  }

  const warnCount = flags.filter((f) => f.kind === "warn").length;
  const askCount = flags.filter((f) => f.ask).length;

  return (
    <section data-tour="listing-things-to-know" className="mb-6 rounded-xl border border-amber-500/25 bg-card/40 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Things to Know
        <span className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold text-muted-foreground">
            {warnCount > 0 ? `${warnCount} to check · ` : ""}public records &amp; disclosures
          </span>
          {askCount > 0 && (
            <CopyQuestionsButton
              text={formatDiligenceQuestions(flags, address)}
              listingId={listingId}
              count={askCount}
            />
          )}
        </span>
      </h3>

      <ul className="divide-y divide-border">
        {flags.map((f) => {
          const asOf = f.asOf ? fmtAsOf(f.asOf) : null;
          return (
            <li key={f.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                  f.kind === "warn" ? "bg-amber-500/[0.13] text-amber-700 dark:text-amber-400" : "bg-cyan-500/[0.12] text-cyan-700 dark:text-cyan-300"
                }`}
              >
                {f.kind === "warn" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-snug text-foreground">{f.title}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  Source: {f.source}
                  {asOf ? ` · as of ${asOf}` : ""}
                </p>
                {f.ask && (
                  <p className={`mt-1 text-[12px] leading-snug ${f.kind === "warn" ? "text-amber-700/90 dark:text-amber-300/90" : "text-cyan-700/80 dark:text-cyan-300/80"}`}>
                    {f.kind === "warn" ? "Worth asking: " : ""}
                    {f.ask}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {clearLabels.length > 0 && (
        <p className="mt-3 font-mono text-[10px] text-emerald-700/90 dark:text-emerald-400/90">
          Also checked, clear: {clearLabels.join(", ")}.
        </p>
      )}
      <p className={`${clearLabels.length > 0 ? "mt-1" : "mt-3"} font-mono text-[10px] text-muted-foreground`}>
        Sourced facts &amp; disclosures, surfaced for your due diligence — not advice. Verify on site.
      </p>
    </section>
  );
}
