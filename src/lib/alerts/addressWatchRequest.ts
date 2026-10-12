/**
 * The pure pieces of POST /api/address-watches ("Track this home"), kept apart from the
 * route so they can be tested without a request or a database.
 */

/**
 * The visitor's answer to the monthly Street Recap tick-box.
 *
 *   true   ticked
 *   false  shown and left unticked: a decline
 *   null   not asked: the card shows the box only while the stream is live (streams.ts),
 *          so the row stays NULL ("never asked") and is never mailed a recap
 */
export function parseRecapChoice(body: unknown): boolean | null {
  const v = (body as { recap?: unknown } | null)?.recap;
  return typeof v === "boolean" ? v : null;
}

/**
 * True when a PostgREST error is the `recap` column not existing yet, i.e. migration 155 is
 * not applied. The route then saves the watch WITHOUT the answer rather than failing it: the
 * listing alert is what the visitor came for, and it must not depend on the recap column.
 */
export function isMissingRecapColumn(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  if (!message.includes("recap")) return false;
  // PGRST204: column not in PostgREST's schema cache. 42703: undefined_column from Postgres.
  return error.code === "PGRST204" || error.code === "42703" || message.includes("column");
}

/** Plain-text confirmation. Mentions the monthly note only when they chose it. */
export function watchConfirmationText(i: { where: string; recap: boolean; unsubscribeUrl: string }): string {
  return (
    `You're tracking ${i.where} on PureProperty.\n\n` +
    `We'll email you if this home is listed.` +
    (i.recap ? ` You'll also get a short monthly note on what sells near it.` : "") +
    `\n\nDidn't sign up? Ignore this email, or unsubscribe: ${i.unsubscribeUrl}`
  );
}
