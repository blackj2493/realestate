import SignInLink from "@/components/auth/SignInLink";
import { rentCheck, type AreaFacts } from "@/lib/census/areaFacts";
import { plainLines, rentCheckText } from "@/lib/census/plainFacts";

/**
 * Neighbourhood — Census 2021 facts for the blocks around this home, as plain sentences
 * next to the city figure (src/lib/census/plainFacts.ts). Facts about PLACES only (housing,
 * tenure, commute, moves, income): never facts about who lives there by a protected ground
 * (Ontario Human Rights Code; TRESA). See src/lib/census/characteristics.ts.
 *
 * Public data (Statistics Canada), so the facts are not VOW-gated. The rent check uses OUR
 * rent estimate, which is VOW-gated (it comes off signed leases), so it takes `rentLocked`.
 */
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
  const lines = plainLines(census);
  const check = !rentLocked && rentMonthly ? rentCheck(rentMonthly, census.incomeGroups) : null;
  const neighbours = census.das - 1;

  return (
    <section className="mb-6 rounded-xl border border-border bg-card p-4 dark:bg-card/40">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">Statistics Canada did not publish these figures for the blocks here.</p>
      ) : (
        <ul className="space-y-3">
          {lines.map((l) => (
            <li key={l.label} className="text-[14px] leading-relaxed text-foreground">
              <span className="font-semibold">{l.label}.</span> <span className="text-muted-foreground">{l.text}</span>
            </li>
          ))}
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
            check &&
            rentCheckText(rentMonthly!, check).map((t) => (
              <p key={t} className="mt-1 text-[14px] leading-relaxed text-foreground">
                {t}
              </p>
            ))
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
