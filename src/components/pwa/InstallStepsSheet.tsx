"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { EllipsisVertical, Share, SquarePlus, X } from "lucide-react";
import type { ReactNode } from "react";
import { useInstallPrompt, type StepsSheet } from "@/lib/pwa/useInstallPrompt";

/**
 * The "add to home screen" how-to sheet, for when there is no install dialog to open.
 * iOS has no install API: Safari (and Chrome on iOS) only add a site to the Home Screen
 * from the share menu. On Android, Chrome's own dialog is used when Chrome offers it;
 * when it does not (held back after a dismissal, an earlier install, another browser),
 * the browser's menu still installs the app, so this sheet shows those taps.
 * Opened from the install nudge or the drawer's "Install app" row via the store, so it
 * can outlive the drawer that launched it. Reuses the project's Radix Dialog like MobileNav.
 */
const STEPS: Record<StepsSheet, { intro: string; steps: ReactNode[] }> = {
  ios: {
    intro: "Opens full screen from your Home Screen, like an app. Three taps:",
    steps: [
      <>
        Tap <Share className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-label="Share" /> <strong>Share</strong> in
        the browser bar. In Chrome, it is in the <strong>⋯</strong> menu.
      </>,
      <>
        Scroll down and tap <SquarePlus className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-hidden />{" "}
        <strong>Add to Home Screen</strong>.
      </>,
      <>
        Tap <strong>Add</strong>. The icon lands on your Home Screen.
      </>,
    ],
  },
  android: {
    intro: "Opens full screen from your home screen, like an app. Three taps:",
    steps: [
      <>
        Tap <EllipsisVertical className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-label="Menu" />{" "}
        <strong>the menu</strong> at the top right of the browser.
      </>,
      <>
        Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>.
      </>,
      <>
        Tap <strong>Install</strong> (or <strong>Add</strong>). The icon lands on your home screen.
      </>,
    ],
  },
};

export default function InstallStepsSheet() {
  const sheet = useInstallPrompt((s) => s.stepsSheet);
  const close = useInstallPrompt((s) => s.closeStepsSheet);
  const content = STEPS[sheet ?? "ios"];

  return (
    <Dialog.Root open={sheet !== null} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="pb-safe fixed inset-x-0 bottom-0 z-[150] rounded-t-2xl border-t border-border bg-background px-5 pt-5 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold text-foreground">
              Add PureProperty to your {sheet === "android" ? "home screen" : "Home Screen"}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">{content.intro}</Dialog.Description>

          <ol className="mt-4 space-y-3 pb-5 text-sm text-foreground">
            {content.steps.map((step, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold">
                  {i + 1}
                </span>
                <span className="pt-1">{step}</span>
              </li>
            ))}
          </ol>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
