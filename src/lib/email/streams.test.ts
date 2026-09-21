import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EMAIL_STREAMS, LIVE_EMAIL_STREAMS, type StreamKey } from "./streams";

/**
 * The invariant these guard: the preference centre offers a stream if and ONLY if
 * something sends it. For three of migration 106's five columns that was not true —
 * `data_drop`, `home_value` and `product` rendered as working switches with no sender
 * behind them, so neither position had any effect.
 */
describe("email stream catalogue", () => {
  it("covers every email_prefs boolean column, exactly once", () => {
    // Mirrors BOOL_KEYS in src/app/api/email-prefs/route.ts and the columns in
    // supabase/migrations/106_email_prefs.sql.
    const columns: StreamKey[] = ["onboarding", "alerts", "data_drop", "home_value", "product"];
    expect([...EMAIL_STREAMS.map((s) => s.key)].sort()).toEqual([...columns].sort());
  });

  it("only exposes streams that name a sender", () => {
    const senderless = LIVE_EMAIL_STREAMS.filter((s) => !s.sender);
    expect(
      senderless.map((s) => s.key),
      "a stream on /account/emails with no sender is a switch that does nothing — " +
        "ship the sender first, then set `sender` in streams.ts"
    ).toEqual([]);
  });

  // The invariant above is only as good as the path. A typo, or a worker that is later
  // renamed or deleted, would leave a stream claiming a sender that does not exist — and it
  // would claim it on the preference centre, to users. Resolve it on disk.
  it("names a sender file that actually exists", () => {
    for (const s of LIVE_EMAIL_STREAMS) {
      expect(
        existsSync(path.join(process.cwd(), s.sender!)),
        `${s.key} names ${s.sender}, which is not in the repo`
      ).toBe(true);
    }
  });

  it("hides every stream that has no sender yet", () => {
    const hidden = EMAIL_STREAMS.filter((s) => s.sender === null).map((s) => s.key);
    const shown = LIVE_EMAIL_STREAMS.map((s) => s.key);
    for (const key of hidden) expect(shown).not.toContain(key);
  });

  it("gives every stream user-facing copy", () => {
    for (const s of EMAIL_STREAMS) {
      expect(s.title.length, `${s.key} needs a title`).toBeGreaterThan(0);
      expect(s.desc.length, `${s.key} needs a description`).toBeGreaterThan(0);
    }
  });
});

/**
 * The second half of the invariant. `sender` says the code exists; `armedBy` says something
 * runs it. Conflating the two is how "Your street, monthly" sat on /account/emails for
 * weeks having never sent to anybody.
 */
describe("a live stream is armed, not merely shipped", () => {
  it("names what runs every stream it offers", () => {
    const unarmed = LIVE_EMAIL_STREAMS.filter((s) => !s.armedBy);
    expect(
      unarmed.map((s) => s.key),
      "a stream on /account/emails that nothing schedules delivers exactly as much mail " +
        "as one with no sender — arm it first, then set `armedBy` in streams.ts"
    ).toEqual([]);
  });

  it("resolves a workflow it names, and that workflow calls the sender", () => {
    for (const s of LIVE_EMAIL_STREAMS) {
      const armedBy = s.armedBy!;
      // A pg_cron job cannot be resolved from the repo — migrations 127/128 moved most
      // scheduled work there and such a workflow fires as workflow_dispatch, which is
      // indistinguishable from unarmed in the YAML. Declared, not inferred.
      if (armedBy.startsWith("pg_cron:")) {
        expect(armedBy.slice("pg_cron:".length).trim().length, `${s.key} names an empty pg_cron job`).toBeGreaterThan(0);
        continue;
      }
      const file = path.join(process.cwd(), armedBy);
      expect(existsSync(file), `${s.key} names ${armedBy}, which is not in the repo`).toBe(true);
      // The link has to be real in both directions, or a rename leaves the catalogue
      // claiming an arming that stopped existing.
      const yml = readFileSync(file, "utf8");
      expect(yml.includes(s.sender!), `${armedBy} never runs ${s.sender}`).toBe(true);
    }
  });

  it("keeps the unarmed street recap off the preference centre", () => {
    // Explicit rather than incidental: this is the row the invariant was written for, and a
    // future edit that quietly re-exposes it should fail here with a reason attached.
    const recap = EMAIL_STREAMS.find((s) => s.key === "home_value");
    expect(recap?.sender, "the recap worker did ship").toBeTruthy();
    expect(recap?.armedBy, "…but nothing calls it yet — 0 of 538 addresses as of 2026-09-21").toBeNull();
    expect(LIVE_EMAIL_STREAMS.map((s) => s.key)).not.toContain("home_value");
  });
});
