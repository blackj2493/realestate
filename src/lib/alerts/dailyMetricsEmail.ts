/**
 * The morning operator report. Internal, one recipient — so no unsubscribe link and no
 * MLS notice (nothing here is listing content), but it still rides the shared shell so it
 * renders the same everywhere.
 *
 * Reading order is deliberate: what needs you first, then the funnel, then activation,
 * then whether the mail actually went out. Numbers you cannot act on go last.
 */
import { shell, sectionHeader, footer, esc, MONO } from "@/lib/alerts/emailShell";
import { attention, delta, pct, round1, subjectLine, type DailyMetricsInput } from "@/lib/ops/dailyMetrics";

const C = {
  ink: "#0a1828",
  muted: "#64748b",
  rule: "#e2e8f0",
  up: "#047857",
  down: "#b91c1c",
  alertBg: "#fef2f2",
  alertBorder: "#fecaca",
  watchBg: "#fffbeb",
  watchBorder: "#fde68a",
};

/** One headline figure: big number, trailing average, and a delta that stays quiet. */
function stat(label: string, value: string, baseline: string, d: ReturnType<typeof delta>): string {
  const colour = d.direction === "up" ? C.up : d.direction === "down" ? C.down : C.muted;
  return `<td width="33%" style="padding:0 8px 16px 0;vertical-align:top;">
    <div style="font-size:10px;letter-spacing:.10em;text-transform:uppercase;color:${C.muted};">${esc(label)}</div>
    <div style="font-family:${MONO};font-size:26px;font-weight:700;color:${C.ink};line-height:1.2;margin-top:4px;">${esc(value)}</div>
    <div style="font-size:11px;color:${colour};margin-top:2px;">${esc(d.label)} <span style="color:${C.muted};">vs ${esc(baseline)} avg</span></div>
  </td>`;
}

function row(label: string, value: string, note = ""): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:${C.ink};border-bottom:1px solid #f1f5f9;">${esc(label)}</td>
    <td align="right" style="padding:6px 0;font-family:${MONO};font-size:13px;color:${C.ink};border-bottom:1px solid #f1f5f9;">${esc(value)}</td>
    <td align="right" style="padding:6px 0 6px 10px;font-size:11px;color:${C.muted};border-bottom:1px solid #f1f5f9;">${esc(note)}</td>
  </tr>`;
}

export function renderDailyMetricsEmail(m: DailyMetricsInput): {
  subject: string;
  html: string;
  text: string;
} {
  const items = attention(m);

  const attentionHtml = items.length
    ? items
        .map((a) => {
          const alert = a.severity === "alert";
          return `<div style="background:${alert ? C.alertBg : C.watchBg};border:1px solid ${
            alert ? C.alertBorder : C.watchBorder
          };border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:${C.ink};">
            <b style="text-transform:uppercase;font-size:10px;letter-spacing:.08em;color:${alert ? C.down : "#92400e"};">
              ${alert ? "Needs you" : "Watch"}</b><br>${esc(a.text)}</div>`;
        })
        .join("")
    : `<div style="border:1px solid ${C.rule};border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:${C.muted};">
         Nothing needs you this morning.</div>`;

  const conv = pct(m.today.signups, m.today.visitors);
  const convPrior = pct(m.prior7.signups, m.prior7.visitors);

  const leadsHtml = m.leads.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;">${m.leads
        .map((l) =>
          row(`${l.kind} · ${l.who}`, new Date(l.createdAt).toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit" }), l.detail ?? "")
        )
        .join("")}</table>`
    : `<p style="font-size:13px;color:${C.muted};margin:0;">No new applications.</p>`;

  const activationHtml = m.activation.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;">${m.activation
        .map((a) => row(a.kind.replace(/_/g, " "), String(a.count)))
        .join("")}</table>`
    : `<p style="font-size:13px;color:${C.muted};margin:0;">No activation events recorded.</p>`;

  const assetless = m.totals.users - m.totals.withAnyAsset;

  const body = `
    <p style="font-size:13px;color:${C.muted};margin:0 0 14px;">Yesterday, ${esc(m.day)} (Toronto). Every user figure excludes the QA accounts.</p>
    ${attentionHtml}

    ${sectionHeader("Funnel")}
    <table role="presentation" width="100%" style="border-collapse:collapse;"><tr>
      ${stat("Visitors", String(m.today.visitors), String(round1(m.prior7.visitors)), delta(m.today.visitors, m.prior7.visitors))}
      ${stat("Signups", String(m.today.signups), String(round1(m.prior7.signups)), delta(m.today.signups, m.prior7.signups))}
      ${stat("Returning", String(m.today.returning), String(round1(m.prior7.returning)), delta(m.today.returning, m.prior7.returning))}
    </tr></table>
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      ${row("Signup conversion", `${round1(conv)}%`, `${round1(convPrior)}% avg`)}
      ${row("Visitors who did not sign up", String(Math.max(0, m.today.visitors - m.today.signups)))}
      ${row("Unsubscribes", String(m.today.unsubscribes), `${m.totals.optedOut} of ${m.totals.users} total (${round1(pct(m.totals.optedOut, m.totals.users))}%)`)}
    </table>

    ${sectionHeader("Activation")}
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      ${row("Areas + listings saved", String(m.today.assetsCreated), `${round1(m.prior7.assetsCreated)} avg`)}
      ${row("Gated (VOW) reads", String(m.today.vowReads), `${round1(m.prior7.vowReads)} avg`)}
      ${row("Users with nothing saved", String(assetless), `of ${m.totals.users} — these get no email after onboarding`)}
    </table>
    <div style="height:8px;"></div>
    ${activationHtml}

    ${sectionHeader("Applications")}
    ${leadsHtml}

    ${sectionHeader("Email delivery")}
    <table role="presentation" width="100%" style="border-collapse:collapse;">
      ${row("Digests sent", String(m.email.digestSent))}
      ${row("Rejected (not delivered)", String(m.email.digestFailed), m.email.digestFailed ? "they retry next run" : "")}
      ${row("Suppressed on consent", String(m.email.digestSuppressed))}
      ${row("Recorded send failures", String(m.email.sendFailures))}
    </table>

    ${footer({ intro: "Internal operations report from PureProperty.", mls: false })}`;

  const text = [
    `${m.day} (Toronto)`,
    "",
    items.length ? items.map((a) => `[${a.severity.toUpperCase()}] ${a.text}`).join("\n") : "Nothing needs you this morning.",
    "",
    `Visitors ${m.today.visitors} (avg ${round1(m.prior7.visitors)})`,
    `Signups ${m.today.signups} (avg ${round1(m.prior7.signups)})`,
    `Returning ${m.today.returning} (avg ${round1(m.prior7.returning)})`,
    `Signup conversion ${round1(conv)}% (avg ${round1(convPrior)}%)`,
    `Unsubscribes ${m.today.unsubscribes} — ${m.totals.optedOut}/${m.totals.users} total`,
    "",
    `Areas+listings saved ${m.today.assetsCreated}; VOW reads ${m.today.vowReads}`,
    `Users with nothing saved ${assetless} of ${m.totals.users}`,
    m.activation.length
      ? m.activation.map((a) => `  ${a.kind}: ${a.count}`).join("\n")
      : "  No activation events recorded.",
    "",
    `Applications: ${m.leads.length}`,
    ...m.leads.map((l) => `  ${l.kind} · ${l.who}${l.detail ? ` · ${l.detail}` : ""}`),
    "",
    `Digests sent ${m.email.digestSent}, rejected ${m.email.digestFailed}, suppressed ${m.email.digestSuppressed}, failures ${m.email.sendFailures}`,
  ].join("\n");

  return {
    subject: subjectLine(m),
    html: shell({
      preheader: `${m.today.signups} signups, ${m.today.visitors} visitors, ${m.today.unsubscribes} unsubscribes.`,
      headerLabel: "DAILY REPORT",
      body,
    }),
    text,
  };
}
