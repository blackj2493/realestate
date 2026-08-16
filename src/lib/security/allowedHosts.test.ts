import { describe, expect, it } from "vitest";
import { decideHost, normalizeHost, parseAllowedHosts } from "./allowedHosts";

const REGISTERED = parseAllowedHosts("www.pureproperty.ca, pureproperty.ca");

describe("normalizeHost", () => {
  it("lowercases and strips the port", () => {
    expect(normalizeHost("WWW.PureProperty.CA:443")).toBe("www.pureproperty.ca");
    expect(normalizeHost("localhost:3000")).toBe("localhost");
  });

  it("strips a fully-qualified trailing dot", () => {
    // "www.pureproperty.ca." resolves the same but fails a naive string compare — a real
    // way to slip past an allowlist.
    expect(normalizeHost("www.pureproperty.ca.")).toBe("www.pureproperty.ca");
  });

  it("keeps IPv6 brackets and drops the port", () => {
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
  });

  it("does not mistake a hostname colon for a port", () => {
    expect(normalizeHost("host:notaport")).toBe("host:notaport");
  });

  it("handles empty input", () => {
    expect(normalizeHost("")).toBe("");
    expect(normalizeHost(null)).toBe("");
  });
});

describe("decideHost — gate disabled", () => {
  it("allows everything when the allowlist is empty (default)", () => {
    // Deploying the gate must change nothing until it is deliberately configured.
    expect(decideHost("anything.vercel.app", []).allowed).toBe(true);
    expect(decideHost("anything.vercel.app", []).reason).toBe("gate-disabled");
    expect(decideHost(parseAllowedHosts("")[0], parseAllowedHosts("")).allowed).toBe(true);
  });
});

describe("decideHost — gate enabled", () => {
  it("allows the registered hosts", () => {
    expect(decideHost("www.pureproperty.ca", REGISTERED).allowed).toBe(true);
    expect(decideHost("pureproperty.ca", REGISTERED).allowed).toBe(true);
    expect(decideHost("WWW.PUREPROPERTY.CA", REGISTERED).allowed).toBe(true);
  });

  it("BLOCKS Vercel preview deployments — the actual hole", () => {
    expect(decideHost("realestate-git-main-tanmay.vercel.app", REGISTERED).allowed).toBe(false);
    expect(decideHost("realestate-abc123.vercel.app", REGISTERED).reason).toBe("not-registered");
  });

  it("BLOCKS a lookalike subdomain — no suffix matching", () => {
    // Allowing "*.pureproperty.ca" would re-open the hole: a preview alias can be given
    // a subdomain, and the agreement registers URLs, not a domain tree.
    expect(decideHost("preview.pureproperty.ca", REGISTERED).allowed).toBe(false);
    expect(decideHost("staging.www.pureproperty.ca", REGISTERED).allowed).toBe(false);
  });

  it("BLOCKS a domain that merely ends with the registered one", () => {
    expect(decideHost("evilpureproperty.ca", REGISTERED).allowed).toBe(false);
    expect(decideHost("www.pureproperty.ca.attacker.com", REGISTERED).allowed).toBe(false);
  });

  it("BLOCKS a request with no Host header", () => {
    expect(decideHost(null, REGISTERED).allowed).toBe(false);
    expect(decideHost("", REGISTERED).reason).toBe("no-host");
  });

  it("always allows local development", () => {
    expect(decideHost("localhost:3000", REGISTERED).allowed).toBe(true);
    expect(decideHost("127.0.0.1:3000", REGISTERED).allowed).toBe(true);
    expect(decideHost("[::1]:3000", REGISTERED).allowed).toBe(true);
  });
});

describe("parseAllowedHosts", () => {
  it("trims, lowercases and drops blanks", () => {
    expect(parseAllowedHosts(" www.pureproperty.ca , , PUREPROPERTY.CA ")).toEqual([
      "www.pureproperty.ca",
      "pureproperty.ca",
    ]);
  });

  it("treats unset/empty as the gate being off", () => {
    expect(parseAllowedHosts(undefined)).toEqual([]);
    expect(parseAllowedHosts("")).toEqual([]);
    expect(parseAllowedHosts("  ,  ")).toEqual([]);
  });

  it("accepts a host written with a scheme-less port and normalizes it", () => {
    expect(parseAllowedHosts("staging.example.com:8443")).toEqual(["staging.example.com"]);
  });
});
