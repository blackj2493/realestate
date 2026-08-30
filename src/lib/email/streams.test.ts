import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
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
