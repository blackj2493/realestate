/**
 * Trust pieces for /home-value: "How it works" (3 steps) and a SAMPLE price opinion, so a
 * visitor sees what they get before they give an address and an email.
 *
 * The sample is a made-up home and says so in its header. It shows the shape of a real
 * opinion (a range, the reasons, similar sales) without any real listing data: no
 * addresses, no MLS numbers, rounded illustrative figures.
 */

export const REPLY_PROMISE = "We reply the same day. Requests after 6 pm get a reply by noon the next day.";

const STEPS = [
  { n: "1", title: "You send the address", text: "Tell us anything a photo cannot show: renovations, the basement, the roof." },
  { n: "2", title: "A person checks the sales", text: "We compare your home with similar homes that sold nearby, and with its own last sale." },
  { n: "3", title: "You get the opinion by email", text: "A price range with the reasons and the similar sales, the same day." },
];

export function HowItWorks() {
  return (
    <ol className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-1" aria-label="How it works">
      {STEPS.map((s) => (
        <li key={s.n} className="rounded-lg border border-border bg-card/40 p-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white"
            >
              {s.n}
            </span>
            <span className="text-sm font-semibold text-foreground">{s.title}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

const SAMPLE_COMPS = [
  { home: "Similar home A", what: "3-bed semi, finished basement", dist: "0.3 km", when: "Aug 2026", price: "$1,135,000" },
  { home: "Similar home B", what: "3-bed semi, original kitchen", dist: "0.6 km", when: "Jun 2026", price: "$1,060,000" },
  { home: "Similar home C", what: "3-bed semi, new kitchen and baths", dist: "0.8 km", when: "May 2026", price: "$1,190,000" },
];

export function SampleOpinion() {
  return (
    <section aria-labelledby="sample" className="mt-10 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="sample" className="text-base font-semibold">What you get: a sample price opinion</h2>
        <span className="rounded border border-border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Sample, not a real home
        </span>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">A 3-bedroom semi-detached home with a finished basement</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">$1,080,000 – $1,170,000</p>
      <p className="mt-3 text-sm font-medium">Why this range</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm leading-relaxed">
        <li>It last sold in 2019. Updated for how similar homes in the city have moved since then, that sale points to about $1,120,000.</li>
        <li>Six similar homes within a kilometre sold in the last 9 months for $1,060,000 to $1,190,000.</li>
        <li>The finished basement and the updated kitchen put it in the upper half of that range.</li>
      </ul>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[460px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Similar sale</th>
              <th className="py-2 pr-3 font-medium">Home</th>
              <th className="py-2 pr-3 font-medium">Distance</th>
              <th className="py-2 pr-3 font-medium">Sold</th>
              <th className="py-2 text-right font-medium">Price</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_COMPS.map((c) => (
              <tr key={c.home} className="border-b border-border/60">
                <td className="py-2 pr-3">{c.home}</td>
                <td className="py-2 pr-3 text-muted-foreground">{c.what}</td>
                <td className="py-2 pr-3 tabular-nums">{c.dist}</td>
                <td className="py-2 pr-3">{c.when}</td>
                <td className="py-2 text-right tabular-nums">{c.price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        What could change it: the age of the roof and windows, the layout, and whether the street is busy. Send photos or ask for a short
        visit, and we narrow the range.
      </p>
    </section>
  );
}
