import { Building2, Clock3, KeyRound, PackageOpen, User } from "lucide-react";
import SignInLink from "@/components/auth/SignInLink";
import { rentCheck, type AreaFacts } from "@/lib/census/areaFacts";
import { areaRows, barWidth, fmtRowValue, peopleOfTen, rentCheckText, type AreaRowKey } from "@/lib/census/plainFacts";

/**
 * Neighbourhood — Census 2021 facts for the blocks around this home. Each fact is a short
 * verdict over two bars, this area and the city (src/lib/census/plainFacts.ts). Facts about
 * PLACES only (housing, tenure, commute, moves, income): never facts about who lives there
 * by a protected ground (Ontario Human Rights Code; TRESA). See src/lib/census/characteristics.ts.
 *
 * Public data (Statistics Canada), so the facts are not VOW-gated. The rent check uses OUR
 * rent estimate, which is VOW-gated (it comes off signed leases), so it takes `rentLocked`.
 */
const ICONS: Record<AreaRowKey, typeof KeyRound> = {
  tenure: KeyRound,
  type: Building2,
  moves: PackageOpen,
  commute: Clock3,
};

function Bar({ name, value, width, here }: { name: string; value: string; width: number; here: boolean }) {
  return (
    <div className="grid grid-cols-[6rem_1fr_3.25rem] items-center gap-2 text-[12px]" aria-hidden="true">
      <span className={`truncate ${here ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{name}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-muted">
        <span
          className={`block h-full rounded-full ${
            here ? "bg-gradient-to-r from-cyan-600 to-cyan-400" : "bg-slate-300 dark:bg-slate-600"
          }`}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className={`text-right tabular-nums ${here ? "font-bold text-foreground" : "text-muted-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

export default function AreaCard({
  census,
  rentMonthly,
  rentLocked,
}: {
  census: AreaFacts;
  /** Our monthly rent estimate for the whole home (or the asking rent on a lease). */
  rentMonthly: number | null;
  /** True for an anon reader on a sale listing: the rent estimate is VOW data. */
  rentLocked: boolean;
}) {
  const rows = areaRows(census);
  const check = !rentLocked && rentMonthly ? rentCheck(rentMonthly, census.incomeGroups) : null;
  const neighbours = census.das - 1;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 dark:bg-card/40">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Statistics Canada did not publish these figures for the blocks here.</p>
      ) : (
        <ul className="space-y-4">
          {rows.map((r) => {
            const Icon = ICONS[r.key];
            return (
              <li key={r.key} className="flex items-start gap-3">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-cyan-500/10 text-cyan-700 dark:text-cyan-300">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[14px] leading-snug">
                    <span className="font-semibold text-foreground">{r.label}</span>{" "}
                    <span className="text-[12px] text-muted-foreground">· {r.measure}</span>
                  </p>
                  <span className="sr-only">{r.text}</span>
                  <div className="space-y-1">
                    <Bar name="Here" value={fmtRowValue(r.here, r.unit)} width={barWidth(r.here, r.max)} here />
                    {r.city != null && (
                      <Bar
                        name={census.cityName}
                        value={fmtRowValue(r.city, r.unit)}
                        width={barWidth(r.city, r.max)}
                        here={false}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {(rentLocked || check) && (
        <div className="mt-4 rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-3">
          <p className="text-[14px] font-semibold text-foreground">Rent check</p>
          {rentLocked ? (
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              Can local households pay the rent this home would get?{" "}
              <SignInLink className="font-semibold text-cyan-700 underline-offset-2 hover:underline dark:text-cyan-300">
                Sign in to see it
              </SignInLink>
              .
            </p>
          ) : (
            check && (
              <>
                <div className="mt-2 flex gap-1" aria-hidden="true">
                  {Array.from({ length: 10 }, (_, i) => (
                    <User
                      key={i}
                      className={`h-5 w-5 ${
                        i < peopleOfTen(check.sharePct)
                          ? "fill-emerald-600 text-emerald-600 dark:fill-emerald-400 dark:text-emerald-400"
                          : "fill-slate-200 text-slate-200 dark:fill-slate-700 dark:text-slate-700"
                      }`}
                    />
                  ))}
                </div>
                {rentCheckText(rentMonthly!, check).map((t) => (
                  <p key={t} className="mt-1 text-[14px] leading-relaxed text-foreground">
                    {t}
                  </p>
                ))}
              </>
            )
          )}
        </div>
      )}

      <p className="mt-4 text-[11px] leading-snug text-muted-foreground">
        Source: Statistics Canada, 2021 Census, for {neighbours > 0 ? `this block and the ${neighbours} next to it` : "this block"}.
        {check ? " Incomes are 2020 household incomes before tax." : ""}
      </p>
    </section>
  );
}
