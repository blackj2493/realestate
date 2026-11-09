/**
 * The card widget the assistant shows under its reply (MCP Apps, `text/html;profile=mcp-app`).
 *
 * One self-contained HTML page, no external scripts, no network calls: it receives the
 * tool's structuredContent (an AppCard, see cards.ts) from the host and draws it. Two
 * bridges, so it works in more than one assistant:
 *   - MCP Apps postMessage: ui/initialize → ui/notifications/initialized, then
 *     ui/notifications/tool-result; links open with ui/open-link.
 *   - ChatGPT's window.openai: toolOutput + the openai:set_globals event; openExternal.
 *
 * Colours: main series emerald #059669; comparison series #c2410c light / #ea580c dark
 * (the /house-not-selling pair, validated with the dataviz palette script). Text stays in
 * text colours; each bar row carries its value as text, so nothing is colour-only. HTML
 * bars, not SVG, so the text keeps its pixel size at every card width.
 */
export const WIDGET_URI = "ui://pureproperty/card-v1.html";

export const WIDGET_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root { --bg:#ffffff; --fg:#0f172a; --muted:#475569; --line:#e2e8f0; --a:#059669; --b:#c2410c; --btn:#047857; --btnfg:#ffffff; }
  :root[data-theme="dark"] { --bg:#0b1220; --fg:#e2e8f0; --muted:#94a3b8; --line:#1e293b; --a:#10b981; --b:#ea580c; --btn:#10b981; --btnfg:#04130d; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .card { padding:16px; }
  .brand { display:flex; align-items:center; gap:6px; font-size:12px; font-weight:600; color:var(--muted); }
  .dot { width:8px; height:8px; border-radius:50%; background:var(--a); }
  h1 { margin:6px 0 0; font-size:17px; line-height:1.3; }
  .upd { margin-top:2px; font-size:12px; color:var(--muted); }
  ul { margin:12px 0 0; padding:0; list-style:none; }
  li { display:flex; gap:8px; margin-top:6px; }
  li::before { content:""; flex:none; width:6px; height:6px; margin-top:8px; border-radius:50%; background:var(--a); }
  .chart { margin-top:14px; }
  .ct { font-size:12px; font-weight:600; }
  .cols { display:flex; align-items:flex-end; gap:4px; margin-top:8px; }
  .col { flex:1; min-width:0; display:flex; flex-direction:column; align-items:center; }
  .cb { width:100%; max-width:36px; border-radius:4px 4px 0 0; }
  .cv { font-size:12px; font-weight:600; white-space:nowrap; height:18px; }
  .cl { margin-top:4px; font-size:11px; color:var(--muted); }
  .hr { display:flex; align-items:center; gap:10px; margin-top:8px; }
  .hl { flex:none; width:88px; text-align:right; font-size:12px; color:var(--muted); }
  .ht { flex:1; min-width:0; display:flex; align-items:center; gap:8px; border-left:1px solid var(--line); padding-right:44px; }
  .hb { height:18px; border-radius:0 4px 4px 0; }
  .hv { font-size:13px; font-weight:600; white-space:nowrap; }
  .note { margin-top:10px; font-size:12px; color:var(--muted); }
  .links { margin-top:14px; display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .btn { display:inline-block; padding:9px 14px; border-radius:10px; background:var(--btn); color:var(--btnfg); font-weight:600; text-decoration:none; }
  .lnk { color:var(--fg); font-size:13px; }
  .src { margin-top:12px; padding-top:10px; border-top:1px solid var(--line); font-size:11px; color:var(--muted); }
  .empty { padding:16px; color:var(--muted); }
</style>
</head>
<body>
<div id="root" class="empty">Loading PureProperty data…</div>
<script>
(function () {
  var root = document.getElementById("root");
  var nextId = 1;
  var pending = {};
  var bridge = false;

  function post(msg) { try { window.parent.postMessage(msg, "*"); } catch (e) {} }
  function request(method, params) {
    var id = nextId++;
    post({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    return new Promise(function (res) { pending[id] = res; });
  }
  function notify(method, params) { post({ jsonrpc: "2.0", method: method, params: params || {} }); }

  function setTheme(t) { if (t === "dark" || t === "light") document.documentElement.setAttribute("data-theme", t); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

  function openLink(url) {
    if (window.openai && typeof window.openai.openExternal === "function") { window.openai.openExternal({ href: url }); return; }
    if (bridge) { request("ui/open-link", { url: url }); return; }
    window.open(url, "_blank", "noopener");
  }
  function link(cls, label, url) {
    var a = el("a", cls, label);
    a.href = url; a.target = "_blank"; a.rel = "noopener";
    a.addEventListener("click", function (e) { e.preventDefault(); openLink(url); });
    return a;
  }

  function chart(c) {
    // HTML bars (not SVG), so the text keeps its size at every card width.
    var wrap = el("div", "chart");
    wrap.setAttribute("role", "img");
    var bars = c.bars || [];
    wrap.setAttribute("aria-label", c.title + ": " + bars.map(function (b) { return b.label + " " + b.display; }).join(", "));
    wrap.appendChild(el("div", "ct", c.title));
    var max = 0;
    bars.forEach(function (b) { max = Math.max(max, Math.abs(b.value)); });
    if (bars.length > 4) {
      // Months: columns from a zero baseline; the first and last values are written.
      var cols = el("div", "cols");
      bars.forEach(function (b, i) {
        var col = el("div", "col");
        col.appendChild(el("div", "cv", i === 0 || i === bars.length - 1 ? b.display : ""));
        var bar = el("div", "cb");
        bar.style.height = (max > 0 ? Math.max(2, (Math.abs(b.value) / max) * 90) : 2) + "px";
        bar.style.background = "var(--" + b.tone + ")";
        col.appendChild(bar);
        col.appendChild(el("div", "cl", b.label));
        cols.appendChild(col);
      });
      wrap.appendChild(cols);
    } else {
      // Two or three rows: bars from a zero line, the value at the end.
      if (max < 5) max = 5;
      bars.forEach(function (b) {
        var row = el("div", "hr");
        row.appendChild(el("div", "hl", b.label));
        var track = el("div", "ht");
        var bar = el("div", "hb");
        bar.style.width = Math.max(1, (Math.abs(b.value) / max) * 100) + "%";
        bar.style.background = "var(--" + b.tone + ")";
        track.appendChild(bar);
        track.appendChild(el("span", "hv", b.display));
        row.appendChild(track);
        wrap.appendChild(row);
      });
    }
    return wrap;
  }

  function render(card) {
    if (!card || !card.title) return;
    root.className = "card";
    root.textContent = "";
    var brand = el("div", "brand"); brand.appendChild(el("span", "dot")); brand.appendChild(document.createTextNode("PureProperty"));
    root.appendChild(brand);
    root.appendChild(el("h1", null, card.title));
    if (card.updated) root.appendChild(el("div", "upd", "MLS® data · updated " + card.updated));
    var ul = el("ul");
    (card.facts || []).forEach(function (f) { ul.appendChild(el("li", null, f)); });
    root.appendChild(ul);
    if (card.chart && card.chart.bars && card.chart.bars.length) root.appendChild(chart(card.chart));
    if (card.note) root.appendChild(el("div", "note", card.note));
    var links = el("div", "links");
    if (card.cta) links.appendChild(link("btn", card.cta.label, card.cta.url));
    if (card.page) links.appendChild(link("lnk", card.page.label + " →", card.page.url));
    root.appendChild(links);
    if (card.source) root.appendChild(el("div", "src", card.source));
    if (bridge) notify("ui/notifications/size-changed", { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight });
  }

  window.addEventListener("message", function (ev) {
    var m = ev.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.id != null && pending[m.id]) { var r = pending[m.id]; delete pending[m.id]; r(m.result); return; }
    if (m.method === "ui/notifications/tool-result") render(m.params && m.params.structuredContent);
    if (m.method === "ui/notifications/host-context-changed" && m.params) setTheme(m.params.theme);
  });

  // ChatGPT bridge.
  function fromOpenai() {
    if (!window.openai) return;
    setTheme(window.openai.theme);
    if (window.openai.toolOutput) render(window.openai.toolOutput);
  }
  window.addEventListener("openai:set_globals", fromOpenai);
  fromOpenai();

  // MCP Apps bridge.
  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "PureProperty", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline"] }
  }).then(function (res) {
    bridge = true;
    if (res && res.hostContext) setTheme(res.hostContext.theme);
    notify("ui/notifications/initialized", {});
  });
  if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches && !document.documentElement.getAttribute("data-theme")) setTheme("dark");
})();
</script>
</body>
</html>`;
