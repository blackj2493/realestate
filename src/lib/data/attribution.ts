/**
 * Attribution label for tracker tables — the text burned into every screenshot.
 *
 * Deliberately NOT in TrackerAttribution.tsx. That file is `"use client"`, and a
 * function exported from a client module cannot be called by a server component:
 * TrackerShell computes this label during render, so importing it from there fails
 * the build with "Attempted to call attributionLabel() from the server". Typecheck
 * and unit tests both pass in that arrangement — only `next build` catches it — so
 * the split lives here with a note rather than being rediscovered later.
 */

/**
 * Strip the protocol and any leading www so the label reads as a citation rather
 * than a pasted URL, and never emit a double slash (which breaks the link when
 * somebody retypes it from the image).
 */
export function attributionLabel(siteUrl: string, slug: string): string {
  const host = siteUrl.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  return `${host}/data/${slug}`;
}
