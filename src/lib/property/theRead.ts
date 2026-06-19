/**
 * The Read — deterministic, persona-aware verdict for a listing.
 *
 * COMPLIANCE (CLAUDE.md §4): pure templating over already-derived metrics. No LLM,
 * no raw IDX/VOW transformation — every input is read off the assembled ListingDetail,
 * and identical inputs always yield identical output. The "catch" reuses Deal Score's
 * own deterministic component copy so the wording stays consistent with the breakdown.
 */
import type { ListingDetail } from "@/lib/property/getListingDetail";
import type { PersonaType } from "@/lib/personas/personaConfig";
import type { DiligenceFlag } from "@/lib/property/diligence";
import { isIncomeProperty } from "@/lib/underwriting/computeUnderwriting";
import { shouldRender as hasValueAdd } from "@/components/Property/forceAppreciationView";

export interface TheRead {
  tier: "full" | "lite";
  thesisByPersona: Record<PersonaType, string>;
  catch_: string;
  priceRead: string;
  grade: string | null;
  score: number | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const money = (v: number): string => {
  const a = Math.abs(Math.round(v));
  const s = v < 0 ? "−" : "";
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(a % 1_000_000 === 0 ? 0 : 1)}M`;
  if (a >= 1_000) return `${s}$${Math.round(a / 1_000)}K`;
  return `${s}$${a}`;
};
const pct1 = (v: number): string => `${v.toFixed(1)}%`;
const signedPct = (v: number): string => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}%`;
const cap1 = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function joinClauses(parts: string[]): string {
  const p = parts.filter(Boolean);
  if (p.length <= 1) return p[0] ?? "";
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(", ")}, and ${p[p.length - 1]}`;
}

export function buildTheRead(view: ListingDetail, flags: DiligenceFlag[] = []): TheRead {
  const p = view.full_payload as Record<string, unknown>;
  const tier: "full" | "lite" = view.estimate ? "full" : "lite";

  const listPrice = num(p.ListPrice) ?? view.priceTimeline.currentPrice ?? 0;
  const subType = typeof p.PropertySubType === "string" ? p.PropertySubType : null;
  const income = isIncomeProperty(subType);
  const suite = (num(p.KitchensBelowGrade) ?? 0) > 0;
  const frontage = num(p.LotWidth);
  const densityReady = p.is_density_ready === true || p.multiplex_by_right === true;
  const rawDom = num(p.DaysOnMarket);
  const capRatePct = view.capRatePct; // null for anon (gated)

  // Price drop: full → gated timeline; lite → IDX OriginalListPrice (never gated).
  const origIdx = num(p.OriginalListPrice);
  const dropLite = origIdx && origIdx > listPrice ? origIdx - listPrice : 0;
  const drop = tier === "full" ? view.priceTimeline.totalPriceDrop : dropLite;
  const trueDom = view.priceTimeline.trueDom; // null for lite
  const dom = trueDom ?? rawDom;

  const est = view.estimate?.estimatedValue ?? null;
  const overUnderPct = est && listPrice > 0 ? ((listPrice - est) / est) * 100 : null; // + = over AVM
  const va = view.valueAdd;
  const netUpside = hasValueAdd(va) ? va.headlineUpside : 0;
  const motivated = view.campaignHistory.campaignCount > 1 || drop > 0;
  const nudge = tier === "lite" ? " Sign in for our price estimate, Deal Score and reno-upside read." : "";

  // ── THESIS per persona (null-guarded clauses degrade cleanly in lite) ──
  const thesisByPersona: Record<PersonaType, string> = {
    smart:
      suite
        ? `Starter you don't carry alone — a basement suite can offset the mortgage; run the sandbox for your all-in.`
        : overUnderPct !== null && overUnderPct < -1
          ? `Priced ${signedPct(overUnderPct)} vs comparable sales — a fair entry without a bidding war.`
          : `Conventional ${subType?.toLowerCase() ?? "home"} — value is in condition and location; verify both in person.`,
    cashflow:
      income && capRatePct !== null
        ? `${pct1(capRatePct)} cap as-is${suite ? `, with second-unit upside the sandbox can model` : ``} — size it against your carry.`
        : suite
          ? `Suite-potential hold — the cashflow case rests on the second unit; model it in the sandbox.`
          : !income
            ? `Not an income property — there's no rent to underwrite here.`
            : `Thin as-is yield — this one only pencils with the value-add.`,
    flippers: (() => {
      const lev = motivated
        ? `${dom != null ? `${dom}d True DOM` : `time on market`}${drop > 0 ? ` and a ${money(drop)} cut` : ``} — real negotiating leverage`
        : `little distress signal`;
      const up = netUpside > 0 ? ` ~${money(netUpside)} net reno upside modeled.` : ``;
      return `${cap1(lev)}.${up}`.trim();
    })(),
    builders:
      frontage && frontage >= 30
        ? `Infill candidate: ${frontage}ft frontage${densityReady ? `, density-ready zoning` : ``} — check $/buildable-ft before the cashflow.`
        : densityReady
          ? `Density-ready zoning — assembly or multiplex potential worth a feasibility pass.`
          : `Standard lot (${frontage ? `${frontage}ft` : "frontage n/a"}) — limited land play.`,
  };
  if (tier === "lite") {
    (Object.keys(thesisByPersona) as PersonaType[]).forEach((k) => {
      thesisByPersona[k] += nudge;
    });
  }

  // ── PRICE READ ── lead with the ONE number (Estimated Sale Price); the AVM appears only
  // as a relative "vs comparable sales" deal note, never as a competing dollar estimate.
  let priceRead: string;
  if (tier === "full") {
    const c =
      drop > 0
        ? ` Already cut ${money(drop)} from the original ask${trueDom != null ? ` over ${trueDom}d` : ``}.`
        : ``;
    const exp = view.expectedSale;
    if (exp) {
      const gap =
        overUnderPct !== null ? ` Ask runs ${signedPct(overUnderPct)} vs comparable sales.` : ``;
      priceRead = `Asking ${money(listPrice)} — likely closes near ${money(exp.expectedPrice)} (${pct1(exp.ratio * 100)} of ask).${gap}${c}`;
    } else {
      // No trustworthy ratio → the AVM IS the single number (the card's fallback).
      priceRead = `Asking ${money(listPrice)} — comparable sales value it near ${money(est as number)}${overUnderPct !== null ? ` (${signedPct(overUnderPct)})` : ``}.${c}`;
    }
  } else {
    const a = `Asking ${money(listPrice)}.`;
    const c =
      dropLite > 0
        ? ` Down ${money(dropLite)} from the original ${money(origIdx as number)} ask${rawDom != null ? `; ${rawDom}d on the MLS` : ``}.`
        : rawDom != null
          ? ` ${rawDom}d on the MLS.`
          : ``;
    priceRead = a + c + nudge;
  }

  // ── THE CATCH — negatives ledger (top 3 by severity) ──
  const negs: Array<{ sev: number; text: string }> = [];
  // Reuse Deal Score's own buyer-unfavorable pillars (yield/upside excluded — their detail
  // isn't negatively worded). detail is already deterministic & human-readable.
  for (const c of view.dealScore.components) {
    if (c.direction === "down" && c.key !== "yield" && c.key !== "upside")
      negs.push({ sev: 62 - c.points, text: c.detail.toLowerCase() });
  }
  if (view.campaignHistory.campaignCount > 1 && trueDom != null) {
    negs.push({
      sev: 58,
      text: `relisted ${view.campaignHistory.campaignCount}× — true time on market is ${trueDom}d, not the ${rawDom ?? "fresh"}d the MLS shows`,
    });
  }
  if (income && capRatePct !== null && capRatePct < 4) {
    negs.push({ sev: 44, text: `a ${pct1(capRatePct)} cap as-is is thin for cashflow` });
  }
  // Things-to-Know diligence flags (payload-derived v1 + geo-joined v2) fold their
  // buyer-unfavorable items into the catch, ranked on the same severity scale.
  for (const fl of flags) {
    if (fl.kind === "warn") negs.push({ sev: fl.severity, text: fl.title.toLowerCase() });
  }

  const seen = new Set<string>();
  const top = negs
    .filter((x) => {
      const k = x.text.slice(0, 18);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.sev - a.sev)
    .slice(0, 3);
  const catch_ = top.length
    ? `${cap1(joinClauses(top.map((x) => x.text)))}.`
    : `Nothing major flags on the data we track — verify condition and status in person.`;

  return {
    tier,
    thesisByPersona,
    catch_,
    priceRead,
    grade: view.dealScore.grade,
    score: view.dealScore.score,
  };
}
