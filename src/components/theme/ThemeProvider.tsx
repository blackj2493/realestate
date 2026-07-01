"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * App-wide light/dark provider (see LIGHT_DARK_THEME_PLAN_2026-07-01.md).
 *
 * - `attribute="class"` pairs with Tailwind `darkMode:["class"]` and the CSS tokens
 *   (light on `:root`, dark under `.dark`) in globals.css.
 * - `defaultTheme="dark"` keeps the app visually UNCHANGED for everyone until they
 *   opt into light. Flip to "system" once the consumer light migration (Phase 2) is
 *   complete so light-preferring users get light automatically.
 * - `enableSystem` makes the OS preference an available choice via the toggle.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
