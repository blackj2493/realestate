import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: vi.fn(),
}));
vi.mock("@/lib/auth/terms", () => ({
  hasAcceptedTerms: vi.fn(),
}));

import { getCurrentUser } from "@/lib/supabase/server";
import { hasAcceptedTerms } from "@/lib/auth/terms";
import { getConsumer, requireConsumer } from "./requireConsumer";

const mockUser = vi.mocked(getCurrentUser);
const mockTerms = vi.mocked(hasAcceptedTerms);

beforeEach(() => {
  mockUser.mockReset();
  mockTerms.mockReset();
  mockTerms.mockResolvedValue(true); // accepted by default; tests override as needed
});

describe("getConsumer (soft gate)", () => {
  it("isConsumer=false / user=null for anonymous", async () => {
    mockUser.mockResolvedValueOnce(null);
    const r = await getConsumer();
    expect(r.isConsumer).toBe(false);
    expect(r.user).toBeNull();
  });

  it("isConsumer=true when signed in and Terms accepted", async () => {
    mockUser.mockResolvedValueOnce({ id: "u1" } as never);
    const r = await getConsumer();
    expect(r.isConsumer).toBe(true);
    expect(r.user?.id).toBe("u1");
  });

  it("isConsumer=false when signed in but Terms NOT accepted", async () => {
    mockUser.mockResolvedValueOnce({ id: "u1" } as never);
    mockTerms.mockResolvedValueOnce(false);
    const r = await getConsumer();
    expect(r.isConsumer).toBe(false);
    expect(r.user?.id).toBe("u1");
  });
});

describe("requireConsumer (hard gate)", () => {
  it("returns a 401 with VOW_AUTH_REQUIRED for anonymous", async () => {
    mockUser.mockResolvedValueOnce(null);
    const gate = await requireConsumer();
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(401);
      const body = await gate.response.json();
      expect(body.code).toBe("VOW_AUTH_REQUIRED");
    }
  });

  it("returns a 403 with VOW_TERMS_REQUIRED when signed in but Terms not accepted", async () => {
    mockUser.mockResolvedValueOnce({ id: "u1" } as never);
    mockTerms.mockResolvedValueOnce(false);
    const gate = await requireConsumer();
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(403);
      const body = await gate.response.json();
      expect(body.code).toBe("VOW_TERMS_REQUIRED");
    }
  });

  it("returns ok + the user when signed in and Terms accepted", async () => {
    mockUser.mockResolvedValueOnce({ id: "u1" } as never);
    const gate = await requireConsumer();
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.user.id).toBe("u1");
  });
});
