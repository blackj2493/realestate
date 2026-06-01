import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  getCurrentUser: vi.fn(),
}));

import { getCurrentUser } from "@/lib/supabase/server";
import { getConsumer, requireConsumer } from "./requireConsumer";

const mockUser = vi.mocked(getCurrentUser);

beforeEach(() => mockUser.mockReset());

describe("getConsumer (soft gate)", () => {
  it("isConsumer=false / user=null for anonymous", async () => {
    mockUser.mockResolvedValueOnce(null);
    const r = await getConsumer();
    expect(r.isConsumer).toBe(false);
    expect(r.user).toBeNull();
  });

  it("isConsumer=true / passes the user through when signed in", async () => {
    mockUser.mockResolvedValueOnce({ id: "u1" } as never);
    const r = await getConsumer();
    expect(r.isConsumer).toBe(true);
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

  it("returns ok + the user when signed in", async () => {
    mockUser.mockResolvedValueOnce({ id: "u1" } as never);
    const gate = await requireConsumer();
    expect(gate.ok).toBe(true);
    if (gate.ok) expect(gate.user.id).toBe("u1");
  });
});
