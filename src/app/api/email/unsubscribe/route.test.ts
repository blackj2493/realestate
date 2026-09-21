import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

/**
 * The opt-out write itself is one `update().ilike()` chain. Stubbing it here keeps these
 * tests about the two things that actually matter on this route: that the unsubscribe
 * happens unconditionally on BOTH verbs, and that the recovery offer appears only after a
 * verified one.
 */
const updates: Array<Record<string, unknown>> = [];
let updateError: string | null = null;

vi.mock("@/lib/supabase/client", () => ({
  getServiceRoleClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { ilike: async () => ({ error: updateError ? { message: updateError } : null }) };
      },
    }),
  }),
}));

import { signUnsubscribe } from "@/lib/alerts/unsubscribe";
import { GET, POST } from "./route";

beforeAll(() => {
  process.env.ALERTS_UNSUBSCRIBE_SECRET = "test-secret-for-unsubscribe-route";
});

beforeEach(() => {
  updates.length = 0;
  updateError = null;
});

const EMAIL = "reader@example.com";
const url = (e: string, s: string) =>
  `https://www.pureproperty.ca/api/email/unsubscribe?e=${encodeURIComponent(e)}&s=${encodeURIComponent(s)}`;
const signed = (e = EMAIL) => url(e, signUnsubscribe(e));

describe("GET — the unsubscribe happens first, unconditionally", () => {
  it("writes the opt-out before rendering anything", async () => {
    const res = await GET(new Request(signed()));
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ marketing_opt_out: true });
    expect(updates[0].marketing_opt_out_at).toEqual(expect.any(String));
  });

  it("says so plainly — the page is a confirmation, not a question", async () => {
    const html = await (await GET(new Request(signed()))).text();
    expect(html).toContain("You're unsubscribed.");
    // Nothing that reads as a confirmation step. CASL asks the mechanism be readily
    // performed, and it already has been by the time this renders.
    expect(html.toLowerCase()).not.toContain("are you sure");
    expect(html.toLowerCase()).not.toContain("confirm");
  });
});

describe("GET — the recovery offer", () => {
  it("offers both ways back, as signed one-click links", async () => {
    const html = await (await GET(new Request(signed()))).text();
    expect(html).toContain("Send it once a week instead");
    expect(html).toContain("Go back to a nightly email");
    expect(html).toContain("a=resub_weekly");
    expect(html).toContain("a=resub_daily");
  });

  it("frames it as a volume problem, which is what the data says it is", async () => {
    const html = await (await GET(new Request(signed()))).text();
    expect(html).toContain("If it was the amount rather than the emails themselves");
  });

  it("offers nothing when the signature does not verify", async () => {
    const res = await GET(new Request(url(EMAIL, "not-a-real-signature")));
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("couldn't be verified");
    // The important half: an unverified address must never be handed a link that could
    // re-subscribe it.
    expect(html).not.toContain("resub_weekly");
    expect(html).not.toContain("resub_daily");
    expect(updates).toHaveLength(0);
  });

  it("offers nothing when the opt-out write failed", async () => {
    updateError = "rls denied";
    const res = await GET(new Request(signed()));
    expect(res.status).toBe(400);
    const html = await res.text();
    // Offering a way back from an unsubscribe that did not happen would be a lie in both
    // directions at once.
    expect(html).not.toContain("resub_weekly");
  });

  it("signs the recovery links for the address that was unsubscribed", async () => {
    const other = "someone.else@example.com";
    const html = await (await GET(new Request(signed(other)))).text();
    expect(html).toContain(encodeURIComponent(other));
    expect(html).not.toContain(encodeURIComponent(EMAIL));
  });
});

describe("POST — the RFC 8058 one-click target is untouched", () => {
  it("opts out and returns JSON, never the page", async () => {
    const res = await POST(new Request(signed(), { method: "POST" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(updates[0]).toMatchObject({ marketing_opt_out: true });
  });

  it("never offers recovery — a mail client cannot render it", async () => {
    const body = await (await POST(new Request(signed(), { method: "POST" }))).text();
    expect(body).not.toContain("resub_weekly");
  });

  it("rejects an unverified signature without writing", async () => {
    const res = await POST(new Request(url(EMAIL, "bad"), { method: "POST" }));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false });
    expect(updates).toHaveLength(0);
  });
});
