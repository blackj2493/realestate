/**
 * SaveBubbleDialog — turn the currently-active custom area (draw / commute /
 * school) into a saved Market Bubble.
 *
 * Sign-in gated by design: anonymous users see the magic-link form embedded in
 * the same modal. The pending payload is stashed in sessionStorage so the save
 * resumes after auth verifyOtp → /properties?resume_bubble=1.
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useRouter } from "next/navigation";
import { Loader2, MapPin, Compass, GraduationCap, X } from "lucide-react";
import MagicLinkForm from "@/components/auth/MagicLinkForm";
import { useCommandCenterStore } from "@/lib/stores/commandCenterStore";
import {
  buildBubblePayload,
  type BubbleAreaType,
  type BubblePayload,
} from "@/lib/bubbles/serialize";
import { useBubblesStore, stashPendingBubble } from "@/lib/bubbles/useBubbles";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Forced area type (caller decides which active area to save). */
  areaType: BubbleAreaType;
}

const AREA_META: Record<
  BubbleAreaType,
  { label: string; icon: typeof MapPin; tagline: string }
> = {
  draw: { label: "Drawn area", icon: MapPin, tagline: "Custom polygon you sketched on the map" },
  commute: { label: "Commute zone", icon: Compass, tagline: "Within your selected travel time" },
  school: { label: "School area", icon: GraduationCap, tagline: "Properties near your chosen school" },
  // City alert rows are created by the dashboard bell (CityAlertBell), never this dialog;
  // entry exists only to satisfy the Record type.
  city: { label: "City", icon: MapPin, tagline: "Whole-city new-listing alerts" },
};

export default function SaveBubbleDialog({ open, onOpenChange, areaType }: Props) {
  const router = useRouter();
  const activePersona = useCommandCenterStore((s) => s.activePersona);
  const filters = useCommandCenterStore((s) => s.filters);
  const location = useCommandCenterStore((s) => s.location);
  const commute = useCommandCenterStore((s) => s.commute);
  const school = useCommandCenterStore((s) => s.school);
  const drawPolygon = useCommandCenterStore((s) => s.drawPolygon);
  const drawPoints = useCommandCenterStore((s) => s.drawPoints);

  const create = useBubblesStore((s) => s.create);
  const signedIn = useBubblesStore((s) => s.signedIn);
  const init = useBubblesStore((s) => s.init);
  useEffect(() => void init(), [init]);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Once the user has entered a name and clicked Save while anon, we surface
  // the magic-link form below the name field and stash the payload.
  const [authPrompt, setAuthPrompt] = useState(false);

  useEffect(() => {
    if (!open) {
      setName("");
      setError(null);
      setAuthPrompt(false);
      setSaving(false);
    }
  }, [open]);

  const meta = AREA_META[areaType];

  // Default name suggestion — area-type appropriate, easy to override.
  useEffect(() => {
    if (!open || name) return;
    if (areaType === "school" && school.targetSchool) {
      setName(`Near ${school.targetSchool.name}`);
    } else if (areaType === "commute" && commute.destination) {
      setName(`${commute.minutes}-min commute to ${commute.destination.label}`);
    } else if (areaType === "draw") {
      setName(location ? `${location} pocket` : "Custom area");
    }
  }, [open, areaType, school.targetSchool, commute.destination, commute.minutes, location, name]);

  /** Filter chips — short summary of the persona + key filter sliders. */
  const filterSummary = useMemo(() => {
    const chips: string[] = [];
    chips.push(activePersona);
    const f = filters as unknown as Record<string, unknown>;
    const minBeds = f.minBedrooms;
    if (typeof minBeds === "number" && minBeds > 0) chips.push(`${minBeds}+ bed`);
    const maxPrice = f.maxPrice;
    if (typeof maxPrice === "number" && maxPrice > 0)
      chips.push(`≤ $${(maxPrice / 1000).toFixed(0)}k`);
    const minPrice = f.minPrice;
    if (typeof minPrice === "number" && minPrice > 0)
      chips.push(`≥ $${(minPrice / 1000).toFixed(0)}k`);
    return chips;
  }, [activePersona, filters]);

  /** Build the payload from current state, returning null on validation error. */
  const buildPayload = async (): Promise<BubblePayload | null> => {
    try {
      if (areaType === "school") {
        if (!school.targetSchool) {
          setError("Pick a school first.");
          return null;
        }
        // The schools dataset is server-side only — fetch the point on demand.
        const res = await fetch(
          `/api/schools/${encodeURIComponent(school.targetSchool.id)}`,
          { cache: "force-cache" }
        );
        if (!res.ok) {
          setError("Could not look up that school.");
          return null;
        }
        const { school: s } = (await res.json()) as {
          school: { id: string; name: string; lat: number; lng: number };
        };
        return buildBubblePayload(
          {
            activePersona,
            filters,
            location,
            commute,
            school,
            drawPolygon,
            drawPoints,
          },
          {
            name: name.trim(),
            area_type: "school",
            school: {
              key: s.id,
              name: s.name,
              point: [s.lat, s.lng],
            },
          }
        );
      }

      return buildBubblePayload(
        {
          activePersona,
          filters,
          location,
          commute,
          school,
          drawPolygon,
          drawPoints,
        },
        { name: name.trim(), area_type: areaType }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the bubble.");
      return null;
    }
  };

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Give your bubble a name.");
      return;
    }
    setSaving(true);
    const payload = await buildPayload();
    if (!payload) {
      setSaving(false);
      return;
    }

    if (!signedIn) {
      // Stash and reveal the auth form. After verifyOtp, MagicLinkForm navigates
      // to next=/properties?resume_bubble=1; the resume hook on /properties
      // picks up the payload from sessionStorage and completes the save.
      stashPendingBubble(payload);
      setAuthPrompt(true);
      setSaving(false);
      return;
    }

    const result = await create(payload);
    setSaving(false);
    if ("error" in result) {
      setError(
        result.error === "bubble_cap_reached"
          ? "You've reached the 10-bubble limit. Delete one to save another."
          : result.error
      );
      return;
    }
    onOpenChange(false);
    router.push(`/dashboard?bubble=${encodeURIComponent(result.id)}`);
  };

  const Icon = meta.icon;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-foreground">
                  Save as Market Bubble
                </Dialog.Title>
                <Dialog.Description className="mt-1 text-xs text-muted-foreground">
                  {meta.tagline}. Stays on your dashboard with live sold + inventory stats.
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <label className="terminal-font block text-[10px] uppercase tracking-wider text-muted-foreground">
            Bubble name
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 80))}
            autoFocus
            placeholder="e.g. North Brampton pocket"
            className="mt-1 w-full border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-500/60"
          />

          {filterSummary.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {filterSummary.map((chip) => (
                <span
                  key={chip}
                  className="rounded border border-border bg-muted/60 px-2 py-0.5 text-[10px] text-foreground"
                >
                  {chip}
                </span>
              ))}
            </div>
          )}

          {error && <p className="mt-3 text-xs text-rose-700 dark:text-rose-400">{error}</p>}

          {authPrompt && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="mb-3 text-xs text-muted-foreground">
                Sign in to save your first bubble. Your draft is held safely — once
                you verify the code, we&apos;ll finish saving and open your dashboard.
              </p>
              <MagicLinkForm next="/properties?resume_bubble=1" />
            </div>
          )}

          {!authPrompt && (
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="border border-border bg-card px-3 py-2 text-xs text-foreground hover:border-border"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving || !name.trim()}
                className="flex items-center gap-2 border border-cyan-500/50 bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {signedIn ? "Save & view in dashboard" : "Save"}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
