import { describe, it, expect, vi, beforeEach } from "vitest";

// posthog-js is a browser library; the store only needs the typed wrapper to be callable.
vi.mock("@/lib/analytics/posthog", () => ({ track: vi.fn(), registerProperties: vi.fn() }));

import { useInstallPrompt, type BeforeInstallPromptEvent } from "./useInstallPrompt";

function fakePrompt(outcome: "accepted" | "dismissed"): BeforeInstallPromptEvent {
  return {
    preventDefault() {},
    prompt: async () => {},
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  } as unknown as BeforeInstallPromptEvent;
}

describe("useInstallPrompt.promptInstall", () => {
  beforeEach(() => {
    useInstallPrompt.setState({ deferred: null, installStage: "idle", dismissedAt: null, installedAt: null });
  });

  it("is unavailable and stays idle with no held event", async () => {
    await expect(useInstallPrompt.getState().promptInstall("nudge")).resolves.toBe("unavailable");
    expect(useInstallPrompt.getState().installStage).toBe("idle");
  });

  it("moves to 'installing' on accept so the page can say the install is under way", async () => {
    useInstallPrompt.setState({ deferred: fakePrompt("accepted") });
    await expect(useInstallPrompt.getState().promptInstall("nudge")).resolves.toBe("accepted");
    const s = useInstallPrompt.getState();
    expect(s.installStage).toBe("installing");
    expect(s.deferred).toBeNull();
    expect(s.dismissedAt).toBeNull();
  });

  it("snoozes on dismiss and does not claim an install", async () => {
    useInstallPrompt.setState({ deferred: fakePrompt("dismissed") });
    await expect(useInstallPrompt.getState().promptInstall("menu")).resolves.toBe("dismissed");
    const s = useInstallPrompt.getState();
    expect(s.installStage).toBe("idle");
    expect(s.dismissedAt).not.toBeNull();
  });

  it("consumes the event: a second call is unavailable", async () => {
    useInstallPrompt.setState({ deferred: fakePrompt("accepted") });
    await useInstallPrompt.getState().promptInstall("nudge");
    await expect(useInstallPrompt.getState().promptInstall("nudge")).resolves.toBe("unavailable");
  });
});
