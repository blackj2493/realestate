"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * App-wide light/dark provider (see LIGHT_DARK_THEME_PLAN_2026-07-01.md).
 *
 * - `attribute="class"` pairs with Tailwind `darkMode:["class"]` and the CSS tokens
 *   (light on `:root`, dark under `.dark`) in globals.css.
 * - `defaultTheme="light"` makes light the app-wide default (consumer light
 *   migration, Phase 2): a first-time / no-JS visitor lands on the pale Daylight
 *   ground. Dark is fully preserved as an opt-in via the toggle (the `.dark`
 *   palette in globals.css is unchanged), so power users keep the terminal look.
 * - `enableSystem` makes the OS preference an available choice via the toggle.
 *
 * NOTE: the plan doc recommends `"system"` here once Phase 2 lands. We deliberately chose
 * hard `"light"` instead: light is the intended first impression for every new visitor,
 * including one whose OS is set to dark. `enableSystem` stays on so "system" remains
 * selectable from the toggle — it's just not the default. Because dark is now reachable only
 * by choice, the toggle has to be present on the signed-out surfaces too (TopNav on the
 * landing page and /login have their own headers rather than AppHeader's).
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
