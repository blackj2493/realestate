/**
 * Landing-hero comparison: the same property as a typical consumer listing card
 * (left, sparse) vs. PureProperty's intelligence card (right, decoded). Purely
 * illustrative — hardcoded sample data — its job is to show the depth gap at a glance.
 * Palette mirrors the product tokens (navy #0f1f30 surface, cyan #1dd3e0 accent).
 */

const SAMPLE_PHOTO = "/sample-listing.jpg";

const RENO = [
  { label: "Basement apt · no separate entrance", adds: "+$44K", width: "39%" },
  { label: "Legal 2nd suite · side entrance", adds: "+$112K", width: "100%" },
];

const SCHOOLS = [
  { name: "Earl Haig SS", meta: "Public secondary · 0.6 km", score: "9.1", width: "91%" },
  { name: "John Wanless PS", meta: "Public elementary · 0.4 km", score: "8.7", width: "87%" },
];

const CASHFLOW = [
  { value: "4.8%", label: "Cap rate" },
  { value: "$4.2K", label: "Carry/mo" },
  { value: "$3.3K", label: "Rent/mo" },
];

export default function ListingCompare() {
  return (
    <div className="mx-auto mt-6 grid w-full max-w-[1020px] grid-cols-1 items-stretch gap-4 text-left md:grid-cols-[300px_auto_1fr] md:gap-6">
      {/* ── THEM: a typical consumer listing card ── */}
      <div className="pp-fade-up flex flex-col gap-3" style={{ animationDelay: "0.05s" }}>
        <div className="flex items-center gap-2">
          <span className="h-px w-5 bg-slate-600" />
          <div>
            {/* slate-400, not text-muted-foreground: these two labels sit on the
                dark hero, outside the white card below. */}
            <div className="terminal-font text-[12px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Every other platform
            </div>
            <div className="text-[10px] text-slate-400">Just the basics</div>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl bg-white text-slate-900 opacity-95 shadow-2xl transition-transform duration-300 will-change-transform hover:-translate-y-1">
          <div
            className="relative h-[172px] bg-cover bg-center"
            style={{ backgroundImage: `url('${SAMPLE_PHOTO}')` }}
          >
            <span className="absolute left-2.5 top-2.5 rounded bg-blue-600 px-2 py-[3px] text-[10px] font-bold tracking-[0.06em] text-white">
              NEW
            </span>
            <span className="absolute right-2.5 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/90 text-[15px] text-muted-foreground shadow">
              ♡
            </span>
          </div>
          <div className="p-4">
            <div className="text-[25px] font-extrabold tracking-tight">$899,000</div>
            <div className="mt-2 flex gap-4 text-[13px] text-muted-foreground">
              <span>
                <b className="text-slate-900">4</b> beds
              </span>
              <span>
                <b className="text-slate-900">3</b> baths
              </span>
              <span>
                <b className="text-slate-900">1,900</b> sqft
              </span>
            </div>
            <div className="mt-2.5 text-[14px] font-semibold">14 Maple Ave, Toronto, ON</div>
            <div className="mt-0.5 text-[12px] text-muted-foreground">Detached · North York</div>
            <div className="mt-2.5 flex items-center gap-1.5 text-[12px] text-green-700">
              <span className="h-[7px] w-[7px] rounded-full bg-green-500" />
              Just listed · 5 days on market
            </div>
            <div className="mt-3 border-t border-slate-200 pt-2.5 text-[11px] text-muted-foreground">
              Listed by ABC Realty Inc., Brokerage
            </div>
          </div>
        </div>
      </div>

      {/* ── VS divider ── */}
      <div className="flex items-center justify-center py-1 md:py-0">
        <span
          className="pp-pop terminal-font flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/90 text-[12px] font-bold tracking-[0.08em] text-foreground shadow-lg"
          style={{ animationDelay: "0.3s" }}
        >
          VS
        </span>
      </div>

      {/* ── US: custom intelligence card ── */}
      <div className="pp-fade-up flex flex-col gap-3" style={{ animationDelay: "0.12s" }}>
        <div className="flex items-center gap-2">
          <span className="h-px w-5 bg-[#1dd3e0]" />
          <div>
            <div className="terminal-font text-[12px] font-semibold uppercase tracking-[0.18em] text-[#1dd3e0]">
              PureProperty.ca
            </div>
            <div className="text-[10px] text-[#8fa4b8]">The same listing, decoded</div>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[#1dd3e0]/40 bg-[#0f1f30] shadow-2xl ring-1 ring-[#1dd3e0]/20 transition-all duration-300 will-change-transform hover:-translate-y-1 hover:ring-[#1dd3e0]/40">
          {/* photo banner */}
          <div
            className="relative h-[78px] bg-cover bg-center"
            style={{ backgroundImage: `url('${SAMPLE_PHOTO}')` }}
          >
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0a1828]/10 to-[#0a1828]/90" />
            <span className="terminal-font absolute right-2.5 top-2.5 z-[2] rounded-full border border-[#1dd3e0]/50 bg-[#0a1828]/65 px-2 py-[3px] text-[9px] uppercase tracking-[0.12em] text-[#1dd3e0]">
              ● Active
            </span>
            <div className="absolute inset-x-3 bottom-2 z-[2]">
              <span className="block text-[14px] font-bold text-white">14 Maple Ave, Toronto</span>
              <span className="terminal-font mt-px block text-[9px] tracking-[0.05em] text-[#aebccb]">
                DETACHED · NORTH YORK · listed 5d ago
              </span>
            </div>
          </div>

          {/* verdict + deal-score ring */}
          <div className="flex items-center gap-3.5 border-b border-[#8fa4b8]/[0.13] px-3.5 py-2.5">
            <div className="relative h-[52px] w-[52px] shrink-0">
              <svg className="h-[52px] w-[52px] -rotate-90" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(143,164,184,0.18)" strokeWidth={4} />
                <circle
                  className="pp-ring-anim"
                  style={{ "--pp-ring-offset": "38", animationDelay: "0.15s" } as React.CSSProperties}
                  cx="20"
                  cy="20"
                  r="16"
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth={4}
                  strokeLinecap="round"
                  pathLength={100}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <b className="terminal-font text-[16px] font-bold leading-none text-white">62</b>
                <span className="terminal-font mt-0.5 text-[6.5px] tracking-[0.14em] text-[#8fa4b8]">
                  DEAL
                </span>
              </div>
            </div>
            <div>
              <div className="terminal-font text-[14px] font-bold text-red-700 dark:text-red-400">
                ⚠ $85K over comp value
              </div>
              <div className="mt-[3px] text-[11.5px] text-[#8fa4b8]">
                Asking $899K · worth $814K · grade C
              </div>
            </div>
          </div>

          {/* two-column body */}
          <div className="grid grid-cols-1 md:grid-cols-2">
            {/* col 1 */}
            <div>
              <Section>
                <H4>Where the price sits</H4>
                <div className="relative mx-3 my-[18px] h-1 rounded-sm bg-[#8fa4b8]/15">
                  <div
                    className="absolute -top-px h-[6px] rounded-sm bg-red-400/30"
                    style={{ left: "38%", width: "50%" }}
                  />
                  <div
                    className="terminal-font absolute bottom-[15px] -translate-x-1/2 text-[10px] font-bold text-red-700 dark:text-red-400"
                    style={{ left: "63%" }}
                  >
                    +$85K over
                  </div>
                  <div
                    className="terminal-font absolute bottom-[15px] -translate-x-1/2 text-[10px] text-red-700 dark:text-red-400"
                    style={{ left: "88%" }}
                  >
                    List $899K
                  </div>
                  <div
                    className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-400 shadow-[0_0_0_2px_#0f1f30]"
                    style={{ left: "38%" }}
                  />
                  <div
                    className="absolute top-1/2 h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-400 shadow-[0_0_0_2px_#0f1f30]"
                    style={{ left: "88%" }}
                  />
                  <div
                    className="terminal-font absolute top-[15px] -translate-x-1/2 text-[10px] text-green-700 dark:text-green-400"
                    style={{ left: "38%" }}
                  >
                    Worth $814K
                  </div>
                </div>
              </Section>
              <Section bordered>
                <H4>Price history &amp; timing</H4>
                <svg className="block h-[26px] w-full" viewBox="0 0 280 32" preserveAspectRatio="xMidYMid meet">
                  <polyline
                    className="pp-draw"
                    style={{ "--pp-draw-len": "400", animationDelay: "0.6s" } as React.CSSProperties}
                    points="0,7 75,7 75,14 155,14 155,22 280,22"
                    fill="none"
                    stroke="#1dd3e0"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx="75" cy="14" r="3.5" fill="#f87171" />
                  <circle cx="155" cy="22" r="3.5" fill="#f87171" />
                </svg>
                <div className="mt-2 text-[11px] text-[#8fa4b8]">
                  <span className="text-[#1dd3e0]">47 true days</span> · relisted 3× ·{" "}
                  <span className="text-amber-700 dark:text-amber-400">2 cuts −$50K</span>
                </div>
              </Section>
              <Section bordered>
                <H4>Cashflow</H4>
                <div className="grid grid-cols-3 gap-2">
                  {CASHFLOW.map((c) => (
                    <div
                      key={c.label}
                      className="rounded-md border border-[#8fa4b8]/10 bg-[#8fa4b8]/[0.06] px-1 py-2.5 text-center"
                    >
                      <b className="terminal-font block text-[15px] font-bold text-[#e8eef4]">
                        {c.value}
                      </b>
                      <span className="mt-[3px] block text-[8.5px] uppercase tracking-[0.07em] text-[#8fa4b8]">
                        {c.label}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>

            {/* col 2 */}
            <div className="border-t border-[#8fa4b8]/[0.13] md:border-l md:border-t-0">
              <Section>
                <H4>Renovation upside</H4>
                <div className="mb-2 text-[11.5px] text-[#8fa4b8]">
                  <b className="terminal-font text-[17px] text-green-700 dark:text-green-400">+$156K</b> unlockable · ~$58K
                  net after cost
                </div>
                {RENO.map((r, i) => (
                  <div key={r.label} className="mt-2 grid grid-cols-[1fr_64px_42px] items-center gap-2.5">
                    <span className="text-[11px] leading-tight text-[#cdd8e3]">{r.label}</span>
                    <span className="h-[7px] overflow-hidden rounded bg-green-400/[0.13]">
                      <i
                        className="pp-bar-anim block h-full rounded bg-green-400"
                        style={{ width: r.width, animationDelay: `${0.35 + i * 0.13}s` }}
                      />
                    </span>
                    <span className="terminal-font text-right text-[11.5px] text-green-700 dark:text-green-400">{r.adds}</span>
                  </div>
                ))}
              </Section>
              <Section bordered>
                <H4>School zone</H4>
                {SCHOOLS.map((s, i) => (
                  <div
                    key={s.name}
                    className={`grid grid-cols-[1fr_54px_24px] items-center gap-2.5 ${i > 0 ? "mt-2" : ""}`}
                  >
                    <span className="text-[11px] text-[#cdd8e3]">
                      {s.name}
                      <small className="mt-px block text-[9px] text-[#6b7e92]">{s.meta}</small>
                    </span>
                    <span className="h-[6px] overflow-hidden rounded bg-green-400/[0.13]">
                      <i
                        className="pp-bar-anim block h-full rounded bg-green-400"
                        style={{ width: s.width, animationDelay: `${0.5 + i * 0.12}s` }}
                      />
                    </span>
                    <span className="terminal-font text-right text-[12px] font-bold text-green-700 dark:text-green-400">
                      {s.score}
                    </span>
                  </div>
                ))}
              </Section>
            </div>
          </div>

          {/* footer */}
          <div className="terminal-font border-t border-[#8fa4b8]/[0.18] bg-[#0a1828] px-3.5 py-2.5 text-[9.5px] tracking-[0.06em] text-[#6b7e92]">
            ▸ 40+ shadow-data signals · active &amp; sold · all Ontario
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ children, bordered }: { children: React.ReactNode; bordered?: boolean }) {
  return (
    <div className={`px-3.5 py-2.5 ${bordered ? "border-t border-[#8fa4b8]/[0.13]" : ""}`}>
      {children}
    </div>
  );
}

function H4({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="terminal-font mb-2 text-[9px] uppercase tracking-[0.16em] text-[#8fa4b8]">
      {children}
    </h4>
  );
}
