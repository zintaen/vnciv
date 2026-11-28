// "Kể chuyện" (story): step-by-step chapters that drive the camera, lens, year, layers and replays (chapters.js), a
// split-screen compare of two lenses / years (split.js) and a side-by-side compare of two provinces (pair.js).
// Entry: a top-bar button (a chapter picker dialog), and a "Split screen" switch in the Layers menu. Everything runs
// as the app mode "story" in the right dock (a bottom sheet on phones).
// Hash: story=<chapter id>&step=n | story=split&cmp=<lens|terrain>~<year|now> | story=pair&pp=<abbr>,<abbr>.
// A link is applied synchronously in the hash key's set() (all data is loaded before the key registers), so opening
// one corrects its own history entry instead of pushing another; each step the user takes pushes one (Back = the
// previous step). Esc / ✕ close and put back the lens, year and layers the chapter changed, and focus returns.
import { t } from "../../i18n.js";
import { esc, viOrder } from "../../format.js";
import { stateIndex } from "../../world.js";
import { formatLensValue } from "../../ui/lenses.js";
import { buildChapters } from "./chapters.js";
import { createSplit } from "./split.js";
import { pairRows } from "./pair.js";

const MODE = "story";
const HL = "#f2d27a";

export async function install(app) {
  const [T, history, merger, disasters, sealevel] = await Promise.all(["timeline", "history", "merger", "disasters", "sealevel"].map((n) => app.loadData(n)));
  const D = app.data;
  const chapters = buildChapters({ T, N: D.nation, states: D.states, raw: app.w.raw, grid: app.w.grid, lenses: D.lenses, cities: D.cities, history, merger, disasters, sealevel });
  const byId = new Map(chapters.map((c) => [c.id, c]));
  const states = D.states || [];
  const sorted = [...states].sort((a, b) => viOrder(a.name, b.name));
  const nso = (D.sources || []).find((s) => s.id === "nso_yearbook");
  const split = createSplit(app, T);

  let view = null; // {kind: "chapter", ch, i} | {kind: "split"} | {kind: "pair", a, b}
  let saved = null; // the lens / year / layers before a chapter, put back when it is closed
  let opener = null;
  let dock = null;

  // --- the picker (modal) -----------------------------------------------------------------------------------------
  const pick = document.createElement("div");
  pick.className = "story-pick-bg";
  pick.hidden = true;
  pick.innerHTML = `<div class="panel story-pick" role="dialog" aria-modal="true" aria-labelledby="story-pick-h">
    <div class="story-head"><h2 id="story-pick-h">${esc(t("Stories"))}</h2>
      <button type="button" class="icon-btn story-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
    <ul class="story-list">${chapters.map((c) => `<li><button type="button" class="story-ch" data-ch="${esc(c.id)}"><b>${esc(c.title)}</b>
      <span>${esc(c.blurb)} · ${esc(t("{n} steps", { n: c.steps.length }))}</span></button></li>`).join("")}</ul>
    <h3>${esc(t("Compare"))}</h3>
    <ul class="story-list"><li><button type="button" class="story-ch" data-go="split"><b>${esc(t("Split screen"))}</b><span>${esc(t("Two lenses or two years side by side, with a divider"))}</span></button></li>
      <li><button type="button" class="story-ch" data-go="pair"><b>${esc(t("Two provinces"))}</b><span>${esc(t("Key figures of two provinces side by side"))}</span></button></li></ul>
    <p class="story-foot">${esc(t("Figures come from this map's data and the sources each step names."))}</p></div>`;
  document.body.appendChild(pick);
  const pickBox = pick.querySelector(".story-pick");
  const focusables = (root) => [...root.querySelectorAll("button, select, input, a[href], [tabindex]:not([tabindex='-1'])")].filter((e) => !e.disabled && e.getClientRects().length);
  function openPicker() {
    if (!pick.hidden) return;
    opener = document.activeElement;
    pick.hidden = false;
    pickBox.querySelector(".story-ch")?.focus();
  }
  function closePicker(back = true) {
    if (pick.hidden) return;
    pick.hidden = true;
    if (back && opener?.isConnected) opener.focus();
  }
  pick.addEventListener("click", (e) => {
    if (e.target === pick || e.target.closest(".story-x")) return closePicker();
    const b = e.target.closest(".story-ch");
    if (!b) return;
    closePicker(false);
    if (b.dataset.ch) open({ kind: "chapter", ch: b.dataset.ch, i: 0 });
    else if (b.dataset.go === "split") open(defaultSplit());
    else open({ kind: "pair", ...defaultPair() });
  });
  pick.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closePicker(); return; }
    if (e.key !== "Tab") return;
    const f = focusables(pickBox), first = f[0], last = f.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  const btn = app.ui.addTopButton({ id: "btn-story", icon: "🎞", label: t("Stories"), title: t("Stories: guided chapters and compare tools"),
    onClick: () => (app.mode === MODE ? close() : openPicker()) });
  btn?.setAttribute("aria-haspopup", "dialog");
  app.on("mode", ({ name }) => btn?.setAttribute("aria-pressed", String(name === MODE)));

  // --- open / close -----------------------------------------------------------------------------------------------
  const toggleIds = () => new Set(chapters.flatMap((c) => c.steps.flatMap((s) => s.layers)));
  function remember() {
    const on = new Map(app.ui.mapToggles?.().map((x) => [x.id, x.on]) || []);
    saved = { lens: app.state.lens?.id || null, year: app.timeline?.year ?? null, layers: [...toggleIds()].map((id) => [id, !!on.get(id)]) };
  }
  function restore() {
    const s = saved;
    saved = null;
    if (!s) return;
    for (const [id, v] of s.layers) app.ui.setMapToggle?.(id, v);
    app.setLens(s.lens);
    app.timeline?.setYear(s.year);
    app.setHighlight(null);
  }
  /** v = {kind, ...}; fromHash: a link / Back / Forward (no push, no replay of a merger it did not cross). */
  function open(v, { fromHash = false } = {}) {
    if (v.kind === "chapter" && !byId.has(v.ch)) return;
    if (!fromHash && !saved && v.kind === "chapter") remember();
    if (app.mode !== MODE) {
      if (!fromHash) opener = opener?.isConnected && opener !== document.body ? opener : btn;
      app.setMode(MODE, { story: true });
    }
    show(v, { fromHash });
    if (!fromHash) {
      app.hash.update();
      const r = root();
      if (r && !r.contains(document.activeElement)) r.querySelector("select, .story-next, button")?.focus({ preventScroll: true });
    }
  }
  function close({ put = true } = {}) {
    if (put && view?.kind === "chapter") restore();
    else if (view?.kind === "pair") app.setHighlight(null);
    saved = null;
    if (app.mode === MODE) app.setMode(null);
  }

  app.registerMode(MODE, {
    enter() {
      dock = app.ui.dock("right", { width: 340, label: t("Stories") });
      dock.classList.add("story-dock");
      dock.innerHTML = `<div class="sheet-grip" aria-hidden="true"></div><div class="story-root"></div>`;
    },
    exit() {
      const hadFocus = !!dock?.contains(document.activeElement);
      if (view?.kind === "split") split.close();
      if (view?.kind !== "chapter") app.setHighlight(null);
      view = null;
      const d = dock;
      dock = null;
      if (d) { d.classList.remove("story-dock"); d.innerHTML = ""; app.ui.undock("right"); }
      if (hadFocus) (opener?.isConnected && opener.getClientRects().length ? opener : btn)?.focus();
    },
    onEscape() {
      if (view?.kind === "chapter") restore();
      saved = null;
      return false; // the mode ends
    },
  });
  const root = () => dock?.querySelector(".story-root");

  // --- views ------------------------------------------------------------------------------------------------------
  function show(v, { fromHash = false } = {}) {
    const prev = view;
    if (prev?.kind === "split" && v.kind !== "split") split.close();
    if (v.kind === "chapter") {
      const ch = byId.get(v.ch);
      const i = Math.max(0, Math.min(ch.steps.length - 1, v.i | 0));
      const same = prev?.kind === "chapter" && prev.ch === ch && prev.i === i;
      view = { kind: "chapter", ch, i };
      renderChapter(same);
      if (!same) applyStep(ch.steps[i], { fromHash });
    } else if (v.kind === "split") {
      view = { kind: "split" };
      if (v.left) { app.setLens(v.left.lens); app.timeline?.setYear(v.left.year); }
      if (prev?.kind === "split") split.setRight(v.right); else split.open(v.right);
      app.setHighlight(null);
      renderSplit();
    } else {
      view = { kind: "pair", a: v.a, b: v.b };
      renderPair();
      const idx = [v.a, v.b].map((a) => stateIndex(app.w, a)).filter((i) => i >= 0);
      const h = idx.length ? { states: new Set(idx), color: HL } : null;
      app.setHighlight(h);
      const bb = h && app.highlightBounds(h);
      if (bb) app.fitBounds(bb.x0, bb.y0, bb.x1, bb.y1, { ms: 700 });
    }
  }

  // A chapter step: layers, lens, year (and the replays it starts), outline, camera. Synchronous.
  function applyStep(s, { fromHash }) {
    const on = new Set(s.layers);
    for (const id of toggleIds()) app.ui.setMapToggle?.(id, on.has(id));
    app.setLens(s.lens);
    const tl = app.timeline;
    if (tl) {
      // the merger replay plays when the year crosses into 2025 (ext/timeline): start the step from 2024
      if (s.replay === "merger" && !fromHash && (tl.year == null || tl.year >= s.year)) tl.setYear(s.year - 1);
      tl.setYear(s.year);
    }
    const idx = (s.hl || []).map((a) => stateIndex(app.w, a)).filter((i) => i >= 0);
    app.setHighlight(idx.length ? { states: new Set(idx), color: HL } : null);
    const fit = (s.fit || []).map((a) => stateIndex(app.w, a)).filter((i) => i >= 0);
    const bb = fit.length ? app.highlightBounds({ states: new Set(fit) }) : null;
    if (bb) app.fitBounds(bb.x0, bb.y0, bb.x1, bb.y1, { ms: 900 });
    else if (s.cam?.x == null) app.home(900);
    else app.flyTo(s.cam.x, s.cam.y, (app.cam.fitScale || app.cam.scale) * 2 ** s.cam.z, 900);
    if (s.replay === "storm" && s.storm >= 0) replayStorm(s.storm, s.year);
  }
  // ext/timeline's storm replay: its API if the timeline exposes it, else the ▶ of the storms card it shows for a
  // typhoon-lens year (the same handler).
  function replayStorm(k, year) {
    const rp = app.timeline?.replay;
    if (rp?.storms) return void rp.storms([k], year);
    document.querySelector(`.tl-card .rp-go[data-i="${k}"]`)?.click();
  }

  function renderChapter(keepFocus) {
    const { ch, i } = view, s = ch.steps[i], n = ch.steps.length, r = root();
    if (!r) return;
    const had = r.contains(document.activeElement) ? document.activeElement.dataset.act : null;
    r.innerHTML = `<div class="story-head"><span class="story-kick">${esc(t("Stories"))} · ${esc(t("{n} of {m}", { n: i + 1, m: n }))}</span>
        <button type="button" class="icon-btn story-x" data-act="close" aria-label="${esc(t("Close the story (Esc)"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <h2 class="story-ch-title">${esc(ch.title)}</h2>
      <div class="story-prog" aria-hidden="true"><i style="width:${((100 * (i + 1)) / n).toFixed(1)}%"></i></div>
      <div class="story-body" aria-live="polite" aria-atomic="true"><h3 class="story-title" tabindex="-1">${esc(s.title)}</h3>
        <ul class="story-facts">${s.facts.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>
      <p class="story-cite">${esc(t("Source"))}: ${s.cite.map((c) => `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.label)}</a>`).join(" · ")}</p>
      <div class="story-ctl"><button type="button" class="btn" data-act="prev" ${i === 0 ? "disabled" : ""} aria-label="${esc(t("Previous step (←)"))}">‹ ${esc(t("Back"))}</button>
        ${i < n - 1 ? `<button type="button" class="btn story-next" data-act="next" aria-label="${esc(t("Next step (→)"))}">${esc(t("Next"))} ›</button>`
          : `<button type="button" class="btn story-next" data-act="chapters">${esc(t("Other stories"))}</button>`}</div>
      <p class="story-keys">${esc(t("Keys: ← → step, Esc closes"))}</p>`;
    const target = had && r.querySelector(`[data-act="${had}"]:not(:disabled)`);
    if (target) target.focus();
    else if (had || !keepFocus) (r.querySelector(".story-next") || r.querySelector(".story-title")).focus({ preventScroll: true });
  }

  function lensOptions(sel) {
    const L = D.lenses?.lenses || [], groups = D.lenses?.groups || [];
    const opt = (id, name) => `<option value="${esc(id)}"${id === sel ? " selected" : ""}>${esc(name)}</option>`;
    return opt("", t("Terrain")) + groups.map((g) => {
      const ls = L.filter((l) => l.group === g.id);
      return ls.length ? `<optgroup label="${esc(t(g.name))}">${ls.map((l) => opt(l.id, t(l.name))).join("")}</optgroup>` : "";
    }).join("");
  }
  const yearOptions = (lensId, sel) => [`<option value=""${sel == null ? " selected" : ""}>${esc(t("Now"))}</option>`]
    .concat(split.yearsFor(lensId).reverse().map((y) => `<option value="${y}"${y === sel ? " selected" : ""}>${y}</option>`)).join("");
  function legend(lensId, year) {
    const { lens, note } = split.viewOf(lensId, year);
    if (!lens) return `<p class="muted">${esc(t("Terrain"))}</p>`;
    if (lens.format === "category") return `<p class="muted">${esc(t(lens.name))}</p>`;
    const g = `linear-gradient(90deg, ${lens.ramp.join(", ")})`;
    return `<div class="story-ramp" style="background:${g}"></div><div class="story-ramp-ends"><span>${esc(formatLensValue(lens, lens.domain[0]))}</span><span>${esc(formatLensValue(lens, lens.domain[1]))}</span></div>
      ${note ? `<p class="story-note">${esc(note)}</p>` : ""}`;
  }
  function renderSplit() {
    const r = root();
    if (!r) return;
    const L = app.state.lens?.id || "", Y = app.timeline?.year ?? null, R = split.right;
    r.innerHTML = `<div class="story-head"><h2>${esc(t("Split screen"))}</h2>
        <button type="button" class="icon-btn story-x" data-act="close" aria-label="${esc(t("Close the compare view (Esc)"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <p class="muted story-small">${esc(t("Left: the map as it is. Right: another lens or year. Drag the divider, or focus it and use the arrow keys."))}</p>
      <fieldset><legend>${esc(t("Left side"))}</legend>
        <label>${esc(t("Lens"))} <select data-side="l" data-k="lens">${lensOptions(L)}</select></label>
        <label>${esc(t("Year"))} <select data-side="l" data-k="year">${yearOptions(L, Y)}</select></label></fieldset>
      <fieldset><legend>${esc(t("Right side"))}</legend>
        <label>${esc(t("Lens"))} <select data-side="r" data-k="lens">${lensOptions(R.lens || "")}</select></label>
        <label>${esc(t("Year"))} <select data-side="r" data-k="year">${yearOptions(R.lens, R.year)}</select></label>
        ${legend(R.lens, R.year)}</fieldset>
      <div class="story-ctl"><button type="button" class="btn" data-act="swap">⇄ ${esc(t("Swap sides"))}</button>
        <button type="button" class="btn" data-act="divider">${esc(t("Move the divider"))}</button></div>
      <p class="story-note">${esc(t("The legend at the bottom and the hover tips describe the left side."))}</p>`;
  }
  function renderPair() {
    const r = root();
    if (!r) return;
    const A = states.find((s) => s.abbr === view.a), B = states.find((s) => s.abbr === view.b);
    const sel = (k, v) => `<select data-pair="${k}" aria-label="${esc(k === "a" ? t("First province") : t("Second province"))}">${sorted.map((s) => `<option value="${esc(s.abbr)}"${s.abbr === v ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select>`;
    const rows = A && B ? pairRows(A, B) : [];
    const bar = (side, cls) => `<span class="story-bar ${cls}" style="width:${(side.w * 100).toFixed(1)}%"></span>`;
    r.innerHTML = `<div class="story-head"><h2>${esc(t("Two provinces"))}</h2>
        <button type="button" class="icon-btn story-x" data-act="close" aria-label="${esc(t("Close the compare view (Esc)"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
      <div class="story-pair-pick"><span class="story-dot a" aria-hidden="true"></span>${sel("a", view.a)}
        <button type="button" class="icon-btn" data-act="pswap" aria-label="${esc(t("Swap sides"))}" title="${esc(t("Swap sides"))}">⇄</button>
        <span class="story-dot b" aria-hidden="true"></span>${sel("b", view.b)}</div>
      <table class="story-pair"><caption class="sr-only">${esc(t("{a} and {b}: key figures", { a: A?.name || "", b: B?.name || "" }))}</caption>
        <thead><tr><th scope="col">${esc(t("Indicator"))}</th><th scope="col">${esc(A?.name || "")}</th><th scope="col">${esc(B?.name || "")}</th></tr></thead>
        <tbody>${rows.map((x) => `<tr><th scope="row">${esc(x.label)}${x.year ? ` <span class="story-yr">${esc(String(x.year))}</span>` : ""}
            <span class="story-bars" aria-hidden="true">${bar(x.a, "a")}${bar(x.b, "b")}</span></th>
          <td${x.better === "a" ? ' class="better"' : ""}>${esc(x.a.text)}</td><td${x.better === "b" ? ' class="better"' : ""}>${esc(x.b.text)}</td></tr>`).join("")}</tbody></table>
      <p class="story-cite">${esc(t("Source"))}: ${nso ? `<a href="${esc(nso.homepage)}" target="_blank" rel="noopener noreferrer">${esc(t(nso.title))}</a>` : "NSO"}. ${esc(t("Each row shows its year; bold = the better of the two where higher or lower is clearly better."))}</p>`;
  }

  function defaultSplit() {
    const L = app.state.lens?.id || "poverty";
    const sv = T?.series && Object.values(T.series).some((s) => s.lens === L);
    const y = app.timeline?.year ?? null;
    return { kind: "split", left: { lens: L, year: y }, right: { lens: L, year: sv ? (y === T.years[0] ? null : T.years[0]) : null } };
  }
  function defaultPair() {
    const s = app.state.selectedState != null ? states[stateIndex(app.w, app.state.selectedState)]?.abbr : null;
    const a = s || "HN";
    return { a, b: a === "HCM" ? "HN" : "HCM" };
  }

  // --- events ----------------------------------------------------------------------------------------------------
  document.addEventListener("click", (e) => {
    const r = root();
    const b = r && e.target.closest?.("[data-act]");
    if (!b || !r.contains(b)) return;
    const act = b.dataset.act;
    if (act === "close") close();
    else if (act === "prev" || act === "next") step(act === "next" ? 1 : -1);
    else if (act === "chapters") { opener = btn; close(); openPicker(); }
    else if (act === "swap") {
      const L = { lens: app.state.lens?.id || null, year: app.timeline?.year ?? null }, R = split.right;
      open({ kind: "split", left: R, right: L });
      r.querySelector('[data-act="swap"]')?.focus();
    } else if (act === "divider") split.knob.focus();
    else if (act === "pswap") { open({ kind: "pair", a: view.b, b: view.a }); root()?.querySelector('[data-act="pswap"]')?.focus(); }
  });
  document.addEventListener("change", (e) => {
    const r = root(), el = e.target;
    if (!r || !r.contains(el) || el.tagName !== "SELECT") return;
    if (el.dataset.pair) {
      const nv = { ...view, [el.dataset.pair]: el.value };
      open({ kind: "pair", a: nv.a, b: nv.b });
      root()?.querySelector(`select[data-pair="${el.dataset.pair}"]`)?.focus();
      return;
    }
    const val = el.value === "" ? null : el.dataset.k === "year" ? +el.value : el.value;
    const side = el.dataset.side, key = el.dataset.k;
    if (side === "l") {
      if (key === "lens") app.setLens(val); else app.timeline?.setYear(val);
      renderSplit();
    } else {
      const R = { ...split.right, [key]: val };
      if (key === "lens" && R.year != null && !split.yearsFor(val).includes(R.year)) R.year = null;
      split.setRight(R);
      renderSplit();
      app.hash.update();
    }
    root()?.querySelector(`select[data-side="${side}"][data-k="${key}"]`)?.focus();
  });
  // the left side is the app's own lens / year: keep the selects in step when they change elsewhere
  app.on("lens", () => { if (view?.kind === "split" && !root()?.contains(document.activeElement)) renderSplit(); });
  app.on("year", () => { if (view?.kind === "split" && !root()?.contains(document.activeElement)) renderSplit(); });

  function step(d) {
    if (view?.kind !== "chapter") return;
    const i = view.i + d;
    if (i < 0 || i >= view.ch.steps.length) return;
    open({ kind: "chapter", ch: view.ch.id, i });
  }
  // ← → step through a chapter (while focus is in the story dock or on the page itself); capture phase, before
  // main.js pans the map with the arrows.
  addEventListener("keydown", (e) => {
    if (view?.kind !== "chapter" || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const a = document.activeElement;
    if (!(a === document.body || a == null || dock?.contains(a)) || /^(INPUT|SELECT|TEXTAREA)$/.test(a?.tagName || "")) return;
    e.preventDefault();
    step(e.key === "ArrowRight" ? 1 : -1);
  }, true);

  // --- the Layers menu switch for the split screen --------------------------------------------------------------
  app.ui.addMapToggle?.({
    id: "split", label: t("Split screen"), icon: "⇔", group: "display", default: false, hash: false,
    title: t("Two lenses or two years side by side, with a divider"),
    get: () => view?.kind === "split",
    set: (v) => { if (v && view?.kind !== "split") open(defaultSplit()); else if (!v && view?.kind === "split") close(); },
  });

  // --- hash ------------------------------------------------------------------------------------------------------
  const parseSide = (s) => {
    const [l, y] = String(s || "").split("~");
    const lens = l && l !== "terrain" && D.lenses?.lenses?.some((x) => x.id === l) ? l : null;
    return { lens, year: /^\d{4}$/.test(y || "") ? +y : null };
  };
  app.hash.register("story", {
    get: () => (view?.kind === "chapter" ? view.ch.id : view?.kind || null),
    set(v) {
      if (!v) { if (app.mode === MODE) close({ put: false }); return; }
      if (byId.has(v)) {
        const n = parseInt(app.hash.value("step") || "1", 10);
        open({ kind: "chapter", ch: v, i: Number.isFinite(n) ? n - 1 : 0 }, { fromHash: true });
      } else if (v === "split") {
        const r = parseSide(app.hash.value("cmp"));
        if (view?.kind === "split" && r.lens === split.right.lens && r.year === split.right.year) return;
        open({ kind: "split", right: r }, { fromHash: true });
      } else if (v === "pair") {
        const [a, b] = String(app.hash.value("pp") || "").split(",");
        const ok = (x) => states.some((s) => s.abbr === x);
        const d = defaultPair();
        open({ kind: "pair", a: ok(a) ? a : d.a, b: ok(b) ? b : d.b }, { fromHash: true });
      } else if (app.mode === MODE) close({ put: false });
    },
  });
  app.hash.register("step", { get: () => (view?.kind === "chapter" ? String(view.i + 1) : null), set() {} });
  app.hash.register("cmp", { get: () => (view?.kind === "split" ? `${split.right.lens || "terrain"}~${split.right.year ?? "now"}` : null), set() {} });
  app.hash.register("pp", { get: () => (view?.kind === "pair" ? `${view.a},${view.b}` : null), set() {} });

  injectStyle();
  app.story = { chapters, open, close, openPicker, get view() { return view; }, split };
}

function injectStyle() {
  const css = `
.story-pick-bg { position: fixed; inset: 0; z-index: 40; background: rgba(4,8,14,.55); display: grid; place-items: center; padding: 16px; }
.story-pick-bg[hidden] { display: none; }
.story-pick { width: min(460px, 100%); max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow: auto; padding: 12px 14px; box-sizing: border-box; color: var(--ink); font-size: 13px; }
.story-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.story-head h2, .story-pick h2 { margin: 0; font: 600 18px var(--serif); color: var(--gold-bright); }
.story-pick h3 { margin: 12px 0 6px; font: 600 14px var(--serif); color: var(--gold-bright); }
.story-list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; }
.story-ch { display: grid; gap: 2px; width: 100%; text-align: left; padding: 8px 10px; cursor: pointer; font: inherit; color: var(--ink);
  background: rgba(0,0,0,.25); border: 1px solid rgba(201,164,92,.4); border-radius: 5px; }
.story-ch b { font: 600 14px var(--serif); color: var(--gold-bright); }
.story-ch span { color: var(--ink-dim); font-size: 12px; }
.story-ch:hover, .story-ch:focus-visible { background: rgba(201,164,92,.16); outline: 2px solid var(--gold-bright); outline-offset: 1px; }
.story-foot { margin: 10px 0 0; color: var(--ink-dim); font-size: 11px; }
.story-dock .story-root { padding: 10px 14px 14px; font-size: 13px; color: var(--ink); }
.story-kick { color: var(--ink-dim); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.story-ch-title { margin: 4px 0 6px; font: 600 17px var(--serif); color: var(--gold-bright); }
.story-prog { height: 3px; background: rgba(201,164,92,.18); margin-bottom: 8px; }
.story-prog i { display: block; height: 100%; background: var(--gold-bright); }
.story-title { margin: 0 0 6px; font: 600 16px var(--serif); color: #f2d27a; }
.story-title:focus { outline: none; }
.story-facts { margin: 0; padding-left: 18px; line-height: 1.45; }
.story-facts li + li { margin-top: 4px; }
.story-cite { margin: 8px 0 0; color: var(--ink-dim); font-size: 11px; line-height: 1.4; }
.story-cite a { color: var(--gold-bright); }
.story-ctl { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.story-ctl .btn:disabled { opacity: .4; cursor: default; }
.story-keys, .story-note, .story-small { margin: 8px 0 0; color: var(--ink-dim); font-size: 11px; line-height: 1.35; }
.story-dock fieldset { border: 1px solid rgba(201,164,92,.35); border-radius: 5px; margin: 10px 0 0; padding: 6px 8px 8px; display: grid; gap: 6px; }
.story-dock legend { color: var(--gold-bright); font: 600 13px var(--serif); padding: 0 4px; }
.story-dock label { display: grid; grid-template-columns: 52px 1fr; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-dim); }
.story-dock select { min-width: 0; width: 100%; font: inherit; font-size: 13px; color: var(--ink); background: #18232f; border: 1px solid rgba(201,164,92,.45); border-radius: 4px; padding: 3px 4px; }
.story-ramp { height: 10px; border-radius: 3px; margin-top: 4px; }
.story-ramp-ends { display: flex; justify-content: space-between; font-size: 11px; color: var(--ink-dim); }
.story-pair-pick { display: grid; grid-template-columns: 10px 1fr auto 10px 1fr; align-items: center; gap: 6px; margin: 8px 0; }
.story-dot { width: 10px; height: 10px; border-radius: 50%; }
.story-dot.a, .story-bar.a { background: #e0b75a; } .story-dot.b, .story-bar.b { background: #6fc3c9; }
.story-pair { width: 100%; border-collapse: collapse; font-size: 12px; }
.story-pair th, .story-pair td { padding: 4px 3px; border-bottom: 1px solid rgba(201,164,92,.18); vertical-align: top; }
.story-pair thead th { color: var(--gold-bright); font: 600 12px var(--serif); text-align: right; }
.story-pair thead th:first-child, .story-pair tbody th { text-align: left; font-weight: 400; }
.story-pair td { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.story-pair td.better { font-weight: 700; color: #f2d27a; }
.story-yr { color: var(--ink-dim); font-size: 10.5px; }
.story-bars { display: grid; gap: 2px; margin-top: 3px; }
.story-bar { display: block; height: 4px; border-radius: 2px; min-width: 1px; }
.story-split { position: fixed; z-index: 11; width: 0; pointer-events: none; }
.story-split[hidden] { display: none; }
.story-split-line { position: absolute; top: 0; bottom: 0; left: -1px; width: 2px; background: #f2d27a; box-shadow: 0 0 0 1px rgba(0,0,0,.55); }
.story-split-knob { position: absolute; top: 50%; left: 0; transform: translate(-50%, -50%); width: 36px; height: 36px; border-radius: 50%; pointer-events: auto;
  cursor: ew-resize; touch-action: none; background: #223244; color: #f2d27a; border: 2px solid #f2d27a; font-size: 16px; padding: 0; }
.story-split-knob:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.story-split-tag { position: absolute; top: 8px; white-space: nowrap; padding: 2px 7px; font-size: 12px; color: var(--ink); background: rgba(16,25,35,.88);
  border: 1px solid var(--line); border-radius: 4px; }
.story-split-l { right: 10px; } .story-split-r { left: 10px; }
@media (max-width: 700px) { .story-dock .story-root { padding: 14px 12px 12px; } .story-keys { display: none; } .story-split-tag { top: auto; bottom: 8px; font-size: 11px; } .story-split-knob { top: 78%; } }`;
  const el = document.createElement("style");
  el.id = "story-style";
  el.textContent = css;
  document.head.appendChild(el);
}
