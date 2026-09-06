"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Share, SquarePlus, X } from "lucide-react";
import { useInstallPrompt } from "@/lib/pwa/useInstallPrompt";

/**
 * iOS has no install API — Safari (and Chrome on iOS) only add a site to the Home
 * Screen from the share menu. This bottom sheet shows the three taps. Opened from the
 * install nudge or the drawer's "Install app" row via the store, so it can outlive the
 * drawer that launched it. Reuses the project's Radix Dialog like MobileNav.
 */
export default function IosInstallSheet() {
  const open = useInstallPrompt((s) => s.iosSheetOpen);
  const close = useInstallPrompt((s) => s.closeIosSheet);

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="pb-safe fixed inset-x-0 bottom-0 z-[150] rounded-t-2xl border-t border-border bg-background px-5 pt-5 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-base font-semibold text-foreground">
              Add PureProperty to your Home Screen
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            Opens full screen from your Home Screen, like an app. Three taps:
          </Dialog.Description>

          <ol className="mt-4 space-y-3 pb-5 text-sm text-foreground">
            <li className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold">
                1
              </span>
              <span className="pt-1">
                Tap <Share className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-label="Share" /> <strong>Share</strong> in
                the browser bar. In Chrome, it is in the <strong>⋯</strong> menu.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold">
                2
              </span>
              <span className="pt-1">
                Scroll down and tap{" "}
                <SquarePlus className="mx-0.5 inline h-4 w-4 align-text-bottom" aria-hidden />{" "}
                <strong>Add to Home Screen</strong>.
              </span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-xs font-bold">
                3
              </span>
              <span className="pt-1">
                Tap <strong>Add</strong>. The icon lands on your Home Screen.
              </span>
            </li>
          </ol>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
