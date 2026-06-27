'use client';

/**
 * PostHog bootstrap + provider (mounted once in the root layout).
 *
 * Responsibilities:
 *  1. Initialise `posthog-js` against our reverse proxy (`/ingest`) — see
 *     next.config.mjs rewrites; ad-blockers see only first-party requests.
 *  2. Manually capture SPA pageviews. Next.js App Router does client-side
 *     navigations, so we disable PostHog's automatic pageview and fire one on
 *     every pathname/search change (wrapped in <Suspense> per useSearchParams).
 *  3. Bridge Supabase Auth → PostHog identity: identify on sign-in, reset on
 *     sign-out, so anonymous → known stitches together as users pass the
 *     "Velvet Rope".
 *
 * Session replay masking: maskAllInputs + a [data-ph-mask] selector. When replay is
 * enabled in the PostHog project, financial/VOW screens stay masked by default
 * (CLAUDE.md §4 — licensed sold data is sensitive).
 */

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import posthog from 'posthog-js';
import { PostHogProvider as PHProvider } from 'posthog-js/react';
import { createClient } from '@/lib/supabase/browser';
import {
  POSTHOG_KEY,
  POSTHOG_HOST,
  analyticsEnabled,
  identifyUser,
  resetUser,
} from '@/lib/analytics/posthog';

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!analyticsEnabled || !pathname) return;
    let url = window.origin + pathname;
    const qs = searchParams?.toString();
    if (qs) url += `?${qs}`;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

/** Subscribes to Supabase auth changes and mirrors them into PostHog identity. */
function PostHogAuthBridge() {
  useEffect(() => {
    if (!analyticsEnabled) return;
    const supabase = createClient();

    // Identify immediately if a session already exists on mount.
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) identifyUser(data.user.id, { email: data.user.email ?? undefined });
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        resetUser();
      } else if (session?.user) {
        identifyUser(session.user.id, { email: session.user.email ?? undefined });
      }
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}

export default function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (!analyticsEnabled || posthog.__loaded) return;
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      ui_host: 'https://us.posthog.com',
      // Only create person profiles for identified users — keeps anonymous-first
      // traffic cheap and privacy-friendly (CLAUDE.md §3A onboarding is optional).
      person_profiles: 'identified_only',
      // We fire pageviews manually for App Router (see PostHogPageView).
      capture_pageview: false,
      capture_pageleave: true,
      // Replay defaults stay conservative; actual recording is toggled in the
      // PostHog project. Mask all inputs + anything tagged [data-ph-mask].
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: '[data-ph-mask]',
      },
    });
  }, []);

  // When unconfigured (no key), render children without the provider — zero overhead.
  if (!analyticsEnabled) return <>{children}</>;

  return (
    <PHProvider client={posthog}>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogAuthBridge />
      {children}
    </PHProvider>
  );
}
