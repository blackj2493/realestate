/**
 * Browser-side scripts injected into every recorded page.
 *
 *  • CURSOR_INIT — a visible cursor dot + click ripple. Playwright's synthetic
 *    mouse has no visual presence in headless video, but demo clips must show
 *    real cursor → real button → real result, so we render one that tracks the
 *    (trusted) pointer events the harness dispatches.
 *  • discoverySeedInit — pre-seeds localStorage `pp_discovery` so first-run
 *    tours / nudges / coach dots don't pop over the flow being recorded. Seeded
 *    once per origin (guard flag) so a scene's own state changes survive
 *    in-scene navigations.
 */

export const CURSOR_INIT = `(() => {
  if (window !== window.top) return;
  const install = () => {
    if (!document.body || document.getElementById("pp-demo-cursor")) return;
    const style = document.createElement("style");
    style.textContent = [
      "#pp-demo-cursor{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;",
      "border-radius:50%;background:rgba(34,211,238,.22);border:2px solid rgba(34,211,238,.95);",
      "box-shadow:0 0 14px rgba(34,211,238,.55),0 2px 6px rgba(0,0,0,.35);pointer-events:none;",
      "z-index:2147483647;transform:translate(-200px,-200px);will-change:transform;",
      "transition:width .1s,height .1s,margin .1s,background .1s}",
      "#pp-demo-cursor.pp-down{width:18px;height:18px;margin:-9px 0 0 -9px;background:rgba(34,211,238,.6)}",
      ".pp-demo-ripple{position:fixed;left:0;top:0;width:12px;height:12px;margin:-6px 0 0 -6px;",
      "border-radius:50%;border:2px solid rgba(34,211,238,.85);pointer-events:none;",
      "z-index:2147483646;animation:pp-ripple .55s ease-out forwards}",
      "@keyframes pp-ripple{from{opacity:.9;transform:scale(1)}to{opacity:0;transform:scale(5.5)}}",
      // Next.js dev-overlay indicator (issue badge / build spinner) must never
      // appear in a recording when clips are captured off a local dev server.
      "nextjs-portal{display:none!important}",
    ].join("");
    document.head.appendChild(style);
    const dot = document.createElement("div");
    dot.id = "pp-demo-cursor";
    document.body.appendChild(dot);
    window.addEventListener("pointermove", (e) => {
      dot.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
    }, { capture: true, passive: true });
    window.addEventListener("pointerdown", (e) => {
      dot.classList.add("pp-down");
      const r = document.createElement("div");
      r.className = "pp-demo-ripple";
      // transform is consumed by the ripple animation's scale, so position via left/top
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 700);
    }, { capture: true });
    window.addEventListener("pointerup", () => dot.classList.remove("pp-down"), { capture: true });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})();`;

/** Coach-dot feature ids (mirror of COACH_IDS in featureRegistry.ts). */
const COACH_IDS = [
  "rail-commute",
  "rail-schools",
  "rail-color",
  "rail-draw",
  "rail-compare",
  "rail-saved",
  "rail-timeline",
  "command-palette",
  "dashboard-persona",
  "dashboard-config",
];

const TOUR_SURFACES = ["terminal", "listing", "dashboard", "analytics", "home", "compare"];

export interface SeedOptions {
  /** Leave the ambient coach dots visible (e.g. when the clip demos discovery itself). */
  keepCoachDots?: boolean;
}

export function discoverySeedInit(opts: SeedOptions = {}): string {
  const used: Record<string, number> = {};
  if (!opts.keepCoachDots) for (const id of COACH_IDS) used[id] = 1;
  const done: Record<string, number> = {};
  for (const s of TOUR_SURFACES) done[s] = 1;
  const payload = JSON.stringify({ seen: {}, used, toursDone: done, nudgesDone: done });
  return `(() => {
  try {
    if (window !== window.top) return;
    if (localStorage.getItem("__pp_demo_seeded")) return;
    localStorage.setItem("pp_discovery", ${JSON.stringify(payload)});
    localStorage.setItem("__pp_demo_seeded", "1");
  } catch {}
})();`;
}
