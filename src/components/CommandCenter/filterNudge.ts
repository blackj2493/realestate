/**
 * The terminal renders at most 100 listings (TRREB cap). When the true total
 * exceeds what is shown, prompt the user to refine rather than paginate.
 */
export interface ResultNudge {
  text: string;
  overflowing: boolean;
}

export function formatResultNudge(shown: number, total: number): ResultNudge {
  if (total <= shown) {
    return { text: `${total} match${total === 1 ? "" : "es"}`, overflowing: false };
  }
  return { text: `${shown} of ${total.toLocaleString("en-US")} — narrow`, overflowing: true };
}
