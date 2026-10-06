import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A tiny in-memory stand-in for the service-role client: enough of select / eq / ilike /
 * update / maybeSingle to drive this route against real-looking rows, so the tests can
 * assert what was WRITTEN rather than which methods were called.
 */
type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
let writes = 0;

function query(table: string) {
  const preds: Array<(r: Row) => boolean> = [];
  let patch: Row | null = null;
  const rows = () => (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
  const run = () => {
    if (patch) {
      writes += 1;
      for (const r of rows()) Object.assign(r, structuredClone(patch));
      return { data: null, error: null };
    }
    return { data: rows(), error: null };
  };
  const q = {
    select: () => q,
    update: (p: Row) => {
      patch = p;
      return q;
    },
    eq: (col: string, v: unknown) => {
      preds.push((r) => r[col] === v);
      return q;
    },
    ilike: (col: string, v: string) => {
      preds.push((r) => String(r[col]).toLowerCase() === v.toLowerCase());
      return q;
    },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve(run()),
  };
  return q;
}

vi.mock("@/lib/supabase/client", () => ({
  getServiceRoleClient: () => ({ from: (t: string) => query(t) }),
}));

import { briefActionUrl } from "@/lib/alerts/briefAction";
import { DEFAULT_ACTIVITY_LENS } from "@/lib/dashboard/config";
import { GET, POST } from "./route";

const EMAIL = "reader@example.com";
const SITE = "https://www.pureproperty.ca";

beforeAll(() => {
  process.env.ALERTS_UNSUBSCRIBE_SECRET = "test-secret-for-brief-route";
});

beforeEach(() => {
  writes = 0;
  db.profiles = [{ id: "u1", email: EMAIL }, { id: "u2", email: "other@example.com" }];
  db.dashboard_prefs = [
    {
      user_id: "u1",
      config: {
        regions: ["Vaughan", "Toronto"],
        marketActivity: { ...DEFAULT_ACTIVITY_LENS, minBeds: 2 },
        persona: "smart",
        somethingNew: { keep: true },
      },
    },
  ];
  db.market_bubbles = [
    { id: "vau", user_id: "u1", name: "Vaughan", area_type: "city", alert_scope: "all", filters: null },
    {
      id: "tor",
      user_id: "u1",
      name: "Toronto",
      area_type: "city",
      alert_scope: "filtered",
      filters: { lens: { ...DEFAULT_ACTIVITY_LENS, minBeds: 2 } },
    },
    { id: "theirs", user_id: "u2", name: "Markham", area_type: "city", alert_scope: "all", filters: null },
  ];
});

const post = (url: string) => {
  const q = new URL(url).searchParams;
  const form = new FormData();
  for (const k of ["e", "a", "b", "s"]) form.set(k, q.get(k) ?? "");
  return POST(new Request(`${SITE}/api/email/brief`, { method: "POST", body: form }));
};

describe("GET — confirm only", () => {
  it("asks first and writes nothing, so a mail scanner opening it changes nothing", async () => {
    const res = await GET(new Request(briefActionUrl(EMAIL, "filter:detached", SITE, "vau")));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Send only detached homes in Vaughan from tomorrow?");
    expect(html).toContain('method="post"');
    expect(writes).toBe(0);
  });

  it("refuses a tampered link", async () => {
    const url = briefActionUrl(EMAIL, "filter:detached", SITE, "vau").replace("filter%3Adetached", "filter%3Acondo");
    expect((await GET(new Request(url))).status).toBe(400);
  });
});

describe("POST — filter links", () => {
  it("sets the dashboard lens, filters the area, and re-snaps the other filtered areas", async () => {
    const res = await post(briefActionUrl(EMAIL, "filter:detached", SITE, "vau"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("From tomorrow, Vaughan sends only detached homes");

    const cfg = db.dashboard_prefs[0].config as Record<string, unknown>;
    const lens = cfg.marketActivity as typeof DEFAULT_ACTIVITY_LENS;
    expect(lens.propertyTypes).toEqual(["detached"]);
    expect(lens.minBeds).toBe(2); // the reader's own filter survives
    expect(cfg.somethingNew).toEqual({ keep: true }); // unknown config fields survive

    const vau = db.market_bubbles.find((b) => b.id === "vau")!;
    expect(vau.alert_scope).toBe("filtered");
    expect((vau.filters as { lens: typeof lens }).lens.propertyTypes).toEqual(["detached"]);
    const tor = db.market_bubbles.find((b) => b.id === "tor")!;
    expect((tor.filters as { lens: typeof lens }).lens.propertyTypes).toEqual(["detached"]);
  });

  it("cannot touch an area on another account", async () => {
    const res = await post(briefActionUrl(EMAIL, "filter:detached", SITE, "theirs"));
    expect(res.status).toBe(400);
    expect(db.market_bubbles.find((b) => b.id === "theirs")!.alert_scope).toBe("all");
  });

  it("filters just the area when the account has no dashboard row, and never creates one", async () => {
    db.dashboard_prefs = [];
    const res = await post(briefActionUrl(EMAIL, "filter:beds3", SITE, "vau"));
    expect(res.status).toBe(200);
    expect(db.dashboard_prefs).toHaveLength(0);
    const vau = db.market_bubbles.find((b) => b.id === "vau")!;
    expect((vau.filters as { lens: { minBeds: number } }).lens.minBeds).toBe(3);
  });
});

describe("POST — persona links", () => {
  it("reorders the picks by writing the dashboard persona", async () => {
    const res = await post(briefActionUrl(EMAIL, "persona:cashflow", SITE));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ordered for rental income");
    expect((db.dashboard_prefs[0].config as { persona: string }).persona).toBe("cashflow");
  });

  it("asks the reader to open the dashboard rather than inventing a config", async () => {
    db.dashboard_prefs = [];
    const res = await post(briefActionUrl(EMAIL, "persona:builders", SITE));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Open your dashboard once");
    expect(db.dashboard_prefs).toHaveLength(0);
  });
});
