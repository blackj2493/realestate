/**
 * Seller internet-display opt-out — the ONLY lawful lever for a removal request.
 *
 * When an owner asks us to take their listing down, we cannot honour it by hand:
 * IDX/VOW §6.3(f) forbids altering an individual listing's content, and the §6.3(h)
 * 24-hour refresh would undo any manual delete on the next sync. The board gives the
 * seller two switches instead, and the feed carries them on every payload:
 *
 *   InternetEntireListingDisplayYN  "Distribute to Internet"      → hide the listing
 *   InternetAddressDisplayYN        "Display Address on Internet" → hide the address
 *
 * Set to No, they instruct EVERY member site to stop displaying. Honouring them is
 * not a content modification — it is the mechanism the rules provide.
 *
 * ── The one semantic that matters ──────────────────────────────────────────────
 * ONLY an explicit false means "opted out". `undefined` (the feed never sent the
 * field) and `null` are NOT an opt-out, and must never be treated as one: the great
 * majority of payloads omit the field entirely, so coercing absent→false would hide
 * most of the book. This is why every check below tests for an explicit falsehood
 * rather than the falsiness of the value.
 *
 * The feed types these as booleans, but historical and hand-entered payloads also
 * carry 'N' / 'No' / 'false' as strings, so accept those spellings too.
 */

export const INTERNET_DISPLAY_FIELD = "InternetEntireListingDisplayYN";
export const INTERNET_ADDRESS_FIELD = "InternetAddressDisplayYN";

/** True only for an explicit No. Absent, null and every Yes spelling return false. */
function isExplicitNo(value: unknown): boolean {
  if (value === false) return true;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    return s === "false" || s === "n" || s === "no";
  }
  return false;
}

/** Read a field off a raw feed payload / stored full_payload, tolerating null. */
function field(payload: unknown, name: string): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  return (payload as Record<string, unknown>)[name];
}

/**
 * The seller opted the whole listing out of internet display ("Distribute to
 * Internet" = No). Suppress the listing everywhere: search index, listing page,
 * address page, emails.
 */
export function isListingDisplayOptedOut(payload: unknown): boolean {
  return isExplicitNo(field(payload, INTERNET_DISPLAY_FIELD));
}

/**
 * The seller opted the ADDRESS out ("Display Address on Internet" = No) while the
 * listing itself may still be displayable. Suppress the address page and never
 * print the street address.
 */
export function isAddressDisplayOptedOut(payload: unknown): boolean {
  return isExplicitNo(field(payload, INTERNET_ADDRESS_FIELD));
}

/**
 * Either switch is off. The address page keys off this: it exists only to publish an
 * address, so an address opt-out and a whole-listing opt-out both remove it.
 */
export function isAnyInternetDisplayOptedOut(payload: unknown): boolean {
  return isListingDisplayOptedOut(payload) || isAddressDisplayOptedOut(payload);
}

/**
 * Same decision from a pre-extracted column value (e.g. a PostgREST
 * `flag:raw_payload->>InternetEntireListingDisplayYN` alias, which arrives as the
 * string 'false' rather than a boolean). Kept separate so callers cannot pass a
 * payload here by mistake and silently get `false`.
 */
export function isOptedOutValue(value: unknown): boolean {
  return isExplicitNo(value);
}
