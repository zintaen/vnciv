// Historical boundaries (stream borders): the province map at each change from 1976 to 2026, from
// data/borders_history.json (lazy; pipeline/build/ext_borders.py, docs/DATA_CONTRACTS.md "borders_history.json").
// A mode ("borders", in the More menu, hash `borders=<frame id | year>`) with a right dock: a year slider
// 1976 → 2026 (a year shows the last change dated in or before it), ◀ ▶ to step change by change, a caption that is
// announced (aria-live), the legal basis and one card per change with its source link, the approximations of the
// frame and its province list. The frame's outlines, band colours and names replace the map's own (world.js
// adminBorders on the frame's hex array) while the mode is on; the previous borders come back when it ends.
// The outlines are also stroked on top (app.motion item, redrawn only when the map draws) so they read from afar.
// Stepping animates on app.motion: the hexes whose province changed glow and fade to a faint tint, the old border
// lines fade out (Effects off / reduced motion: the tint only). Debug and link handle: app.borders.
import { t, lang } from "../../i18n.js";
import { esc, int } from "../../format.js";
import { adminBorders } from "../../world.js";

const MODE = "borders";
const STEP_MS = 1400;
const TINT = 0.14; // the changed hexes' tint once the transition is over (and with Effects off)
const VI = lang === "vi";
const yearOf = (f) => +String(f.date).slice(0, 4);
const tx = (o, k = "text") => (VI ? o[`${k}_vi`] || o[k] : o[k]);
const KIND = { city: "Centrally governed city", zone: "Special zone" };
// "Province" is already in the dictionary as "Tỉnh/thành" (a province or a city); here it means a tỉnh only
const kindName = (k) => (k === "province" ? (VI ? "Tỉnh" : "Province") : t(KIND[k] || k));
const abbrOf = (name) => name.replace(/^TP\.\s*/, "").split(/[\s–-]+/).filter(Boolean).map((s) => s[0].toUpperCase()).join("");

const CSS = `
.bd-root { padding: 10px 14px 16px; font-size: 13px; line-height: 1.45; }
.bd-head { display: flex; align-items: center; gap: 8px; }
.bd-head h2 { flex: 1; margin: 0; font: 600 17px var(--serif); color: var(--gold-bright); }
.bd-step { display: flex; align-items: center; gap: 6px; margin: 10px 0 4px; }
.bd-step input { flex: 1; min-width: 0; accent-color: #c9a45c; }
.bd-step button { min-width: 34px; }
.bd-ticks { position: relative; height: 10px; margin: 0 40px 6px; }
.bd-ticks i { position: absolute; top: 0; width: 2px; height: 8px; margin-left: -1px; background: rgba(201,164,92,.7); }
.bd-cap { border-top: 1px solid var(--line); padding-top: 8px; }
.bd-cap .bd-year { font: 600 26px var(--serif); color: var(--gold-bright); margin-right: 8px; }
.bd-cap .bd-count { color: var(--ink); }
.bd-cap .bd-title { font: 600 14px var(--serif); margin-top: 2px; }
.bd-muted { color: var(--ink-dim); font-size: 12px; }
.bd-legal { margin: 8px 0; padding: 6px 8px; border-left: 3px solid #c9a45c; background: rgba(201,164,92,.08); }
.bd-cards { list-style: none; margin: 6px 0; padding: 0; display: grid; gap: 6px; }
.bd-cards li { padding: 6px 8px; border: 1px solid rgba(201,164,92,.35); border-radius: 6px; }
.bd-cards li.bd-status { border-style: dashed; }
.bd-root a { color: var(--gold-bright); }
.bd-root details { margin-top: 8px; }
.bd-root summary { cursor: pointer; color: var(--gold); }
.bd-provs { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 3px; max-height: 260px; overflow: auto; font-size: 12px; }
.bd-provs b { color: var(--ink); }
`;

export async function install(app) {
  const w = app.w, grid = w.grid, raw = w.raw, M = app.motion;
  if (!grid || !Array.isArray(raw?.owner)) return;
  if (!document.getElementById("bd-style")) {
    const st = document.createElement("style");
    st.id = "bd-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  // adminBorders caches the map's own (34) borders on its first call, from whatever w holds then: seed it now, before
  // this mode ever swaps its frames in (else a later "34" from the timeline would hand back one of ours)
  adminBorders(w, "34");
  const land = [];
  for (let i = 0; i < grid.size; i++) if (raw.owner[i] >= 0) land.push(i);

  let D = null, loading = null;
  const model = new Map(); // frame index → {cells: Array, borders, sig: [], label: []}
  let cur = -1, saved = null, dock = null, opener = null;
  let fx = null; // {fill: Path2D, old: Path2D, p, tween}

  function load() {
    loading ??= app.loadData("borders_history").then((d) => {
      if (!d?.frames?.length || d.n_land !== land.length) { console.warn("borders_history.json missing or out of step with world.json"); return null; }
      D = d;
      return d;
    });
    return loading;
  }
  function frameModel(k) {
    if (model.has(k)) return model.get(k);
    const f = D.frames[k];
    const cells = Array.from(raw.owner, (o) => (o < 0 ? o : -1));
    let j = 0;
    for (let r = 0; r < f.cells.length; r += 2) for (let n = 0; n < f.cells[r + 1]; n++) cells[land[j++]] = f.cells[r];
    const units = f.provinces.map((p) => ({ name: p.name, abbr: abbrOf(p.name) }));
    // world.js computes outlines, band colours and labels for any hex → region array (the "63" path, on a stand-in w)
    const borders = adminBorders({ grid, raw: { county: cells, counties: units } }, "63");
    // a province's identity across frames: its hex set (count + index sum) and its name and kind
    const cnt = new Array(units.length).fill(0), sum = new Array(units.length).fill(0);
    for (const i of land) { cnt[cells[i]]++; sum[cells[i]] += i; }
    const sig = units.map((_, p) => `${cnt[p]}:${sum[p]}`);
    const label = f.provinces.map((p) => `${p.name}|${p.kind}`);
    const lines = new Path2D(), L = borders.stateLines;
    for (let k = 0; k < L.length; k += 4) { lines.moveTo(L[k], L[k + 1]); lines.lineTo(L[k + 2], L[k + 3]); }
    const m = { cells, borders, sig, label, lines };
    model.set(k, m);
    return m;
  }

  // --- map: borders, tooltip, transition ---------------------------------------------------------------------------
  const keep = () => ({ bands: w.bands, stateLines: w.stateLines, bandColor: w.bandColor, stateLabels: w.stateLabels });
  function applyBorders(b) {
    w.bands = b.bands; w.stateLines = b.stateLines; w.bandColor = b.bandColor; w.stateLabels = b.stateLabels;
    app.refreshLens(); // also re-renders the cached map (borders, names)
  }
  app.on?.("year", () => { // the timeline swapped the 34/63 borders under us: keep its choice for later, show ours
    if (app.mode !== MODE || cur < 0) return;
    saved = keep();
    applyBorders(frameModel(cur).borders);
  });

  function transition(from, to) {
    fx?.tween?.();
    fx = null;
    if (from < 0 || from === to) return;
    const a = frameModel(from), b = frameModel(to);
    const fill = new Path2D();
    let n = 0;
    for (const i of land) {
      const pa = a.cells[i], pb = b.cells[i];
      if (a.sig[pa] === b.sig[pb] && a.label[pa] === b.label[pb]) continue;
      const cx = grid.cx(i), cy = grid.cy(i);
      fill.moveTo(cx + grid.corners[0][0], cy + grid.corners[0][1]);
      for (let d = 1; d < 6; d++) fill.lineTo(cx + grid.corners[d][0], cy + grid.corners[d][1]);
      fill.closePath();
      n++;
    }
    fx = { fill, old: a.lines, n, p: 0, tween: null };
    const me = fx;
    let done = !M?.tween;
    // (with Effects off the tween ends synchronously, before it returns its cancel function)
    const cancel = M?.tween?.({ from: 0, to: 1, ms: STEP_MS, ease: "out", onUpdate: (v) => { me.p = v; },
      onDone: () => { done = true; me.tween = null; me.p = 1; app.requestDraw(); } });
    me.tween = done ? null : cancel;
    if (done) me.p = 1;
  }
  M?.register?.({
    id: "borders-step", z: 95, ambient: false,
    active: () => !!fx?.tween,
    draw(ctx, cam, a, f) {
      if (app.mode !== MODE || cur < 0) return;
      ctx.save();
      // the frame's province outlines, legible at every zoom (the base map's own borders are thin from afar)
      ctx.lineJoin = "round";
      ctx.lineWidth = 1.6 / cam.scale;
      ctx.strokeStyle = "rgba(255,226,160,0.75)";
      ctx.stroke(frameModel(cur).lines);
      if (!fx?.n) { ctx.restore(); return; }
      const p = f.still ? 1 : fx.p;
      ctx.fillStyle = `rgba(255,214,120,${(0.5 * (1 - p) + TINT * p).toFixed(3)})`;
      ctx.fill(fx.fill);
      if (p < 1) {
        ctx.lineWidth = 2.5 / cam.scale;
        ctx.strokeStyle = `rgba(255,236,190,${(0.9 * (1 - p)).toFixed(3)})`;
        ctx.setLineDash([6 / cam.scale, 4 / cam.scale]);
        ctx.stroke(fx.old);
      }
      ctx.restore();
    },
  });

  app.registerStaticLayer?.({
    id: "borders-history", z: 89, snapshot: false,
    visible: () => app.mode === MODE && cur >= 0,
    sig: () => String(cur),
    draw() {},
    hit(x, y) {
      const i = grid.cellAt(x, y);
      if (i < 0 || cur < 0) return null;
      const p = frameModel(cur).cells[i];
      return p >= 0 ? { p } : null;
    },
    tooltip({ p }) {
      const f = D.frames[cur], pr = f.provinces[p];
      return `<b>${esc(pr.name)}</b><br><span class="muted">${esc(kindName(pr.kind))} · ${esc(String(yearOf(f)))}</span>`;
    },
  });

  // --- the dock -----------------------------------------------------------------------------------------------------
  const q = (s) => dock?.querySelector(s);
  function render() {
    const f = D.frames[cur];
    const kinds = f.kinds || {};
    const parts = [];
    if (kinds.province) parts.push(t("{n} provinces", { n: int(kinds.province) }));
    if (kinds.city) parts.push(t("{n} centrally governed cities", { n: int(kinds.city) }));
    if (kinds.zone) parts.push(t("{n} special zone", { n: int(kinds.zone) }));
    const range = q(".bd-range");
    range.value = String(yearOf(f));
    range.setAttribute("aria-valuetext", `${yearOf(f)}: ${tx(f, "title")}`);
    q(".bd-prev").disabled = cur === 0;
    q(".bd-next").disabled = cur === D.frames.length - 1;
    const date = new Date(f.date + "T00:00:00Z").toLocaleDateString(VI ? "vi-VN" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    q(".bd-cap").innerHTML = `<span class="bd-year">${esc(String(yearOf(f)))}</span><span class="bd-count">${esc(t("{n} province-level units", { n: int(f.count) }))}</span>
      <div class="bd-muted">${esc(parts.join(", "))}${f.count_note === "derived" ? ` · ${esc(t("count derived from the resolution"))}` : ""}</div>
      <div class="bd-title">${esc(tx(f, "title"))}</div><div class="bd-muted">${esc(date)}${f.adopted ? ` (${esc(t("in force; adopted {d}", { d: f.adopted }))})` : ""}</div>`;
    q(".bd-legal").innerHTML = `<div class="bd-muted">${esc(t("Legal basis"))}</div>` + f.legal.map((l) =>
      `<div>${esc(tx(l))} · <a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(t("source"))}</a></div>`).join("");
    q(".bd-cards").innerHTML = f.changes.map((c) => `<li class="${c.status ? "bd-status" : ""}">${c.status ? `<span class="bd-muted">${esc(t("Status only, same boundaries"))}</span><br>` : ""}${esc(tx(c))}
      <div class="bd-muted"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(t("Source text"))}</a></div></li>`).join("");
    const ap = q(".bd-approx");
    ap.hidden = !f.approx?.length;
    ap.querySelector("ul").innerHTML = (f.approx || []).map((a) => `<li>${esc(tx(a))}</li>`).join("");
    const pl = q(".bd-plist");
    pl.querySelector("summary").textContent = t("Provinces and cities in this frame ({n})", { n: int(f.count) });
    const fmt = (p) => {
      const bits = [];
      if (p.from?.length) bits.push(p.from.join(", "));
      if (p.plus?.length) bits.push(`+ ${p.plus.join(", ")}`);
      if (p.minus?.length) bits.push(`− ${p.minus.join(", ")}`);
      return `<li><b>${esc(p.name)}</b> <span class="bd-muted">${esc(kindName(p.kind))}</span><br><span class="bd-muted">${esc(t("2020 units"))}: ${esc(bits.join("; "))}</span></li>`;
    };
    pl.querySelector("ul").innerHTML = f.provinces.map(fmt).join("");
  }
  function show(k, { animate = true } = {}) {
    if (!D || k < 0 || k >= D.frames.length) return;
    const from = cur;
    cur = k;
    applyBorders(frameModel(k).borders);
    if (animate) transition(from, k); else { fx?.tween?.(); fx = null; }
    if (dock) render();
    (app.hash.soon || app.hash.update)?.();
    app.requestDraw();
  }
  const byYear = (y) => { let k = 0; D.frames.forEach((f, i) => { if (yearOf(f) <= y) k = i; }); return k; };
  const resolve = (v) => {
    const s = String(v ?? "");
    const byId = D.frames.findIndex((f) => f.id === s);
    if (byId >= 0) return byId;
    const y = parseInt(s, 10);
    return Number.isFinite(y) ? byYear(Math.max(yearOf(D.frames[0]), y)) : D.frames.length - 1;
  };

  function buildDock() {
    dock = app.ui.dock("right", { width: 340, label: t("Historical boundaries") });
    dock.classList.add("bd-dock");
    const y0 = yearOf(D.frames[0]), y1 = yearOf(D.frames.at(-1));
    const ticks = [...new Set(D.frames.map(yearOf))].map((y) => `<i style="left:${(((y - y0) / (y1 - y0)) * 100).toFixed(2)}%"></i>`).join("");
    dock.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div><div class="bd-root">
      <div class="bd-head"><h2>${esc(t("Historical boundaries"))}</h2><button type="button" class="icon-btn bd-close" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <p class="bd-muted">${esc(t("How the provinces split and merged since reunification. Use the slider or the arrow keys; ◀ ▶ step one change at a time."))}</p>
      <div class="bd-step"><button type="button" class="tl-btn bd-prev" aria-label="${esc(t("Previous change"))}" title="${esc(t("Previous change"))}">◀</button>
        <input type="range" class="bd-range" min="${y0}" max="${y1}" step="1" aria-label="${esc(t("Year"))}">
        <button type="button" class="tl-btn bd-next" aria-label="${esc(t("Next change"))}" title="${esc(t("Next change"))}">▶</button></div>
      <div class="bd-ticks" aria-hidden="true">${ticks}</div>
      <div class="bd-cap" aria-live="polite" aria-atomic="true"></div>
      <div class="bd-legal"></div>
      <ul class="bd-cards"></ul>
      <details class="bd-approx"><summary>${esc(t("Approximations on this map"))}</summary><ul></ul></details>
      <details class="bd-plist"><summary></summary><ul class="bd-provs"></ul></details>
      <p class="bd-muted">${esc((VI && D.rules_vi ? D.rules_vi : D.rules).districts)}</p>
    </div>`;
    q(".bd-close").addEventListener("click", () => app.setMode(null));
    q(".bd-prev").addEventListener("click", () => show(cur - 1));
    q(".bd-next").addEventListener("click", () => show(cur + 1));
    q(".bd-range").addEventListener("input", (e) => { const k = byYear(+e.target.value); if (k !== cur) show(k); });
  }

  app.registerMode(MODE, {
    enter(p) {
      app.timeline?.replay?.close?.();
      saved = keep();
      const go = () => { buildDock(); show(p?.frame ?? D.frames.length - 1, { animate: false }); };
      if (D) go();
      else load().then((d) => { if (d && app.mode === MODE && !dock) go(); });
    },
    exit() {
      const hadFocus = !!dock?.contains(document.activeElement);
      fx?.tween?.(); fx = null;
      cur = -1;
      if (saved) { applyBorders(saved); saved = null; }
      if (dock) { dock.classList.remove("bd-dock"); dock.innerHTML = ""; dock = null; app.ui.undock("right"); }
      if (hadFocus) (opener?.isConnected ? opener : btn)?.focus?.();
    },
  });

  async function open(v, { focus = true } = {}) {
    if (!(await load())) return false;
    const k = resolve(v);
    if (app.mode !== MODE) {
      opener = document.activeElement;
      app.setMode(MODE, { frame: k });
    } else if (k !== cur) show(k);
    if (focus) q(".bd-range")?.focus({ preventScroll: true });
    return true;
  }
  const btn = app.ui.addTopButton?.({ id: "btn-borders", menu: true, icon: "📜", label: t("Historical boundaries"),
    title: t("Province boundaries from 1976 to 2026: how the provinces split and merged"),
    onClick: () => (app.mode === MODE ? app.setMode(null) : open(null)) });
  app.on?.("mode", ({ name }) => btn?.setAttribute("aria-pressed", String(name === MODE)));

  app.hash.register("borders", {
    get: () => (app.mode === MODE && D && cur >= 0 ? D.frames[cur].id : null),
    set(v) {
      if (!v) { if (app.mode === MODE) app.setMode(null); return; }
      open(v, { focus: false });
    },
  });

  app.borders = {
    /** Open the mode at a frame id ("1991-08") or a year (the last change dated in or before it). */
    show: (v) => open(v),
    close: () => { if (app.mode === MODE) app.setMode(null); },
    get frame() { return D && cur >= 0 ? D.frames[cur].id : null; },
    get changed() { return fx?.n || 0; }, // hexes lit by the last step (debugging)
    frames: async () => ((await load())?.frames || []).map((f) => ({ id: f.id, date: f.date, count: f.count })),
  };
}
