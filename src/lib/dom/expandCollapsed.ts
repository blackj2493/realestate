/**
 * Open every CSS peer-checkbox collapse that hides `el`, so a jump to it lands on
 * visible content. The listing page collapses sections on phones with a hidden
 * checkbox: a wrapper with id `X` holds an `<input id="X-toggle">` whose `:checked`
 * state shows the content (History, All details, The area). A target can sit
 * inside a collapse whose wrapper is not its nearest id (#rooms inside
 * #home-details), so walk every ancestor, not just the closest one.
 */
export function expandCollapsedAncestors(el: HTMLElement | null): void {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (!node.id) continue;
    const toggle = document.getElementById(`${node.id}-toggle`);
    if (toggle instanceof HTMLInputElement && toggle.type === "checkbox") toggle.checked = true;
  }
}
