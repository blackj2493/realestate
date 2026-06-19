import { AlertTriangle, Info } from "lucide-react";
import type { DiligenceFlag } from "@/lib/property/diligence";

/**
 * Things to Know — the interpretive diligence layer (sourced facts + "worth asking"
 * prompts), distinct from PropertyDataSheet's verbatim risk group. Server component:
 * no interactivity, so the facts render server-side and are crawlable.
 */
export default function ThingsToKnowCard({ flags }: { flags: DiligenceFlag[] }) {
  if (!flags.length) return null;
  const warnCount = flags.filter((f) => f.kind === "warn").length;

  return (
    <section className="mb-6 rounded-xl border border-amber-500/25 bg-slate-900/40 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-slate-300">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        Things to Know
        <span className="ml-auto font-mono text-[10px] font-semibold text-slate-500">
          {warnCount > 0 ? `${warnCount} to check · ` : ""}public records &amp; disclosures
        </span>
      </h3>

      <ul className="divide-y divide-slate-800">
        {flags.map((f) => (
          <li key={f.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <span
              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                f.kind === "warn" ? "bg-amber-500/[0.13] text-amber-400" : "bg-cyan-500/[0.12] text-cyan-300"
              }`}
            >
              {f.kind === "warn" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Info className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold leading-snug text-slate-200">{f.title}</p>
              <p className="mt-0.5 font-mono text-[10px] text-slate-500">Source: {f.source}</p>
              {f.ask && (
                <p className={`mt-1 text-[12px] leading-snug ${f.kind === "warn" ? "text-amber-300/90" : "text-cyan-300/80"}`}>
                  {f.kind === "warn" ? "Worth asking: " : ""}
                  {f.ask}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 font-mono text-[10px] text-slate-600">
        Sourced facts &amp; disclosures, surfaced for your due diligence — not advice. Verify on site.
      </p>
    </section>
  );
}
