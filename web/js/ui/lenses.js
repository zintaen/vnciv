// Lens dock: a quick row (Terrain + the 3 most recent lenses), a grouped lens picker, and a rich legend with a
// histogram of hex values whose ramp can be hovered or dragged to highlight a band of values on the map.
import { compact, dec, esc, fixed, int, money } from "../format.js";
import { lensScale } from "../world.js";
import { rampColor, parseHex } from "../color.js";
import { icon, glyph } from "./icon.js";
import { hasIcon } from "../icons.js";
import { norm } from "../app/search.js";
import { t } from "../i18n.js";
import { PRESETS } from "../app/api.js";

export { glyph };

// Whole numbers read as integers, but a real fractional value under 10 keeps 1–2 significant digits so a sparse
// cell (0.34 people/km²) never shows as "0".
const intish = (v) =>
  Number.isInteger(v) || Math.abs(v) >= 10 ? compact(v) : Math.abs(v) < 1 ? dec(+v.toPrecision(1)) : fixed(v, 1);

export function formatLensValue(lens, v) {
  if (v == null || !Number.isFinite(v)) return t("no data");
  switch (lens.format) {
    case "category": { const c = lens.categories?.[Math.round(v)]?.name; return c != null ? t(c) : t("no data"); }
    case "usd": return money(v);
    case "pct": return fixed(v * 100, v < 0.1 ? 1 : 0) + "%";
    case "int": return intish(v) + (lens.unit?.startsWith("people") ? " /km²" : lens.unit ? " " + t(lens.unit) : "");
    case "minutes": return t("{n} min", { n: fixed(v, 0) });
    case "years": return t("{n} yrs", { n: fixed(v, 1) });
    case "float": if (lens.domain?.[1] <= 1) return fixed(v, 3) + (lens.unit ? " " + t(lens.unit) : ""); // 0–1 index (HDI, Gini)
      return (v < 10 ? fixed(v, 1) : compact(v)) + (lens.unit ? " " + t(lens.unit) : "");
  }
  if (lens.unit?.includes("$")) return money(v);
  return (v < 10 ? fixed(v, 1) : compact(v)) + (lens.unit?.startsWith("people") ? " /km²" : "");
}

// A legend tick: the number alone (a long unit such as "adherents per 100 residents" is printed once on the legend's
// unit line instead, so five ticks never overprint), "0" rather than "≤ 0.0" when the scale starts at zero, and
// ≤ / ≥ on the ends because the ramp clamps values beyond its domain, except where the end is the value's natural
// bound (a share's 0% or 100%: nothing lies beyond it). With the unit on its own line, a count under 100,000 prints
// in full ("1.300", not "1,3K": no unit after it to carry the abbreviation).
export function formatLensTick(lens, pos, k = -1) {
  const raw = lensValueAt(lens, pos);
  const v = lens.format === "int" && Number.isFinite(raw) ? Math.round(raw) : raw; // a count never reads "4.5"
  // (density's "/km²" too: five "1,8K /km²" ticks overprint; the unit line under the scale names it)
  const short = (lens.format === "int" || lens.format === "float") && lens.unit && lens.unit.length > 4 ? { ...lens, unit: null } : lens;
  let s = short !== lens && lens.format === "int" && Math.abs(v) >= 10 && Math.abs(v) < 1e5 ? int(v) : formatLensValue(short, v);
  const zero = Number.isFinite(v) && Math.abs(v) < 1e-9;
  if (zero) s = s.replace(/^(\$?)0[.,]0+(?!\d)/, (_, d) => d + "0");
  if (k === 0 && !zero && !naturalEnd(lens, 0)) s = "≤ " + s;
  else if (k === 4 && !naturalEnd(lens, 1)) s = "≥ " + s;
  return s;
}

/** True when the ramp's end (0 = low, 1 = high) is the value's own bound, a share's 0% or 100%: no ≤ / ≥ there. */
export const naturalEnd = (lens, end) =>
  lens.format === "pct" && lens.domain[0] >= 0 && lens.domain[1] <= 1 && lens.domain[end] === end;

// Value at position t (0..1) along the lens ramp: the inverse of world.js lensScale().
export function lensValueAt(lens, pos) {
  const [d0, d1] = lens.domain;
  if (lens.scale === "log") return Math.exp(Math.log(d0) + pos * (Math.log(d1) - Math.log(d0)));
  return d0 + pos * (d1 - d0);
}

const TERRAIN = { id: null, icon: "terrain", emoji: "🗺️", name: "Terrain" };
const RECENT_KEY = "civusa.recentLenses";
const DEFAULT_RECENT = ["density", "income", "bachelors"];
const BINS = 40;
const HOVER_HALF = 0.08; // half-width of the hover band, in ramp units
const QUANT = 80; // band edges snap to 1/80 of the ramp so tiny mouse moves don't re-render the map
// "Show on the map" groups open by default; the rest start collapsed. The user's choice per group is remembered.
const OPEN_GROUPS = new Set(["display", "transport", "geography", "living"]);
const GROUPS_KEY = "vnciv.mapGroups";
const loadGroups = () => {
  try { const v = JSON.parse(localStorage.getItem(GROUPS_KEY) || "{}"); return v && typeof v === "object" ? v : {}; } catch { return {}; }
};

const loadRecent = () => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "null");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
};
const saveRecent = (ids) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(ids)); } catch { /* private mode: fine */ }
};

/**
 * opts: {lenses (lenses.json), sources (sources.json list), w (prepared world), onPick(lens|null), onBand(band|null)}
 */
export function initLensDock(opts) {
  const { lenses: lensFile, w } = opts;
  const lenses = lensFile?.lenses || [];
  const sources = opts.sources || [];
  // Live lookups: main fills `lenses` in place when lenses.json lands after the first paint.
  const byId = { get: (id) => lenses.find((l) => l.id === id), has: (id) => lenses.some((l) => l.id === id) };
  const quick = document.getElementById("lens-quick");
  const moreBtn = document.getElementById("btn-lenses");
  const picker = document.getElementById("lens-picker");
  const legend = document.getElementById("legend");
  let active = null;
  let band = null;
  let recent = (loadRecent() || DEFAULT_RECENT).filter((id) => byId.has(id));
  for (const l of lenses) if (recent.length < 3 && !recent.includes(l.id)) recent.push(l.id);
  recent = recent.slice(0, 3);
  let restoreFocus = null;
  const histCache = new Map();

  // ---- the "Map" panel: one dock button, one dialog with two sections ---------------------------------------------
  // "Colour by" picks one lens (a theme colouring every hex); "Show on the map" switches any number of layers
  // (app.ui.addMapToggle, app/api.js createMapToggles). A filter box narrows both. Esc / ✕ / a click outside close it
  // and give focus back to the button; Tab stays inside while it is open.
  let layers = null; // createMapToggles(): sections(), flip(id), count(), onList(fn)
  let tour = null; // () => start the camera tour, once ext/tour has installed
  let filter = "", filterRaw = "";
  const groupOpen = loadGroups(); // group id → open (only groups the user opened or closed)
  let filterShut = new Set(); // while filtering, matching groups show open unless closed again here
  const isOpen = (g) => (filter ? !filterShut.has(g) : groupOpen[g] ?? OPEN_GROUPS.has(g));
  const toggleGroup = (g) => {
    if (filter) { if (!filterShut.delete(g)) filterShut.add(g); }
    else {
      groupOpen[g] = !isOpen(g);
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify(groupOpen)); } catch { /* private mode: fine */ }
    }
    renderBody();
  };
  // CSS gradient stops: a smooth ramp, or hard-edged blocks for a categorical lens.
  const rampStops = (l) => (l.format === "category"
    ? l.ramp.map((c, k, a) => `${esc(c)} ${(k / a.length) * 100}% ${((k + 1) / a.length) * 100}%`).join(",")
    : l.ramp.map(esc).join(","));
  const isActive = (l) => (l.id ?? null) === (active?.id ?? null);
  const tglyph = (ic, size) => (ic ? (hasIcon(ic) ? icon(ic, "•", { size }) : `<span class="emoji" aria-hidden="true">${esc(ic)}</span>`) : "");

  // The dock shows one button naming the current lens: "🗺 Map: Terrain ▾" (and how many layers are on).
  function renderQuick() {
    quick.innerHTML = "";
    quick.hidden = true;
    const cur = active || TERRAIN;
    const n = layers?.count().on || 0;
    moreBtn.classList.toggle("active", !!active);
    moreBtn.innerHTML = `${icon("map", "🗺", { size: 15 })}<span class="bp-k">${esc(t("Map"))}:</span> <span class="bp-v">${esc(t(cur.name))}</span>`
      + (n ? `<b class="ml-count">${n}</b><span class="sr-only"> ${esc(t("layers on."))}</span>` : "")
      + `<span class="sr-only"> ${esc(t("Choose a theme and layers"))}</span><span class="caret" aria-hidden="true">▾</span>`;
    moreBtn.title = t("Choose what colours the map and which layers show (L cycles themes)");
    moreBtn.removeAttribute("aria-label"); // the name is the visible text (plus the hidden hints): WCAG label in name
    moreBtn.hidden = false;
  }

  const fold = (s) => norm(s);
  const matches = (...texts) => !filter || texts.some((x) => x && fold(x).includes(filter));

  function renderPicker() {
    picker.setAttribute("aria-labelledby", "bp-title");
    picker.removeAttribute("aria-label");
    picker.innerHTML = `<div class="lp-head"><h2 id="bp-title">${icon("map", "🗺", { size: 16 })}<span>${esc(t("Map"))}</span></h2>
        <input type="search" class="bp-filter" placeholder="${esc(t("Filter themes and layers"))}" aria-label="${esc(t("Filter themes and layers"))}"
          autocomplete="off" spellcheck="false" value="${esc(filterRaw)}">
        <button type="button" class="icon-btn lp-close" aria-label="${esc(t("Close the Map panel"))}">${icon("close", "✕", { size: 12 })}</button></div>
      ${tour ? `<button type="button" class="bp-tour"><span aria-hidden="true">▶</span> ${esc(t("Watch the journey (2 min)"))}<span class="bp-tour-sub">${esc(t("a camera tour, Lũng Cú to Cà Mau"))}</span></button>` : ""}
      <div class="bp-jump"><button type="button" data-jump="bp-h-lens">${esc(t("Colour by"))}</button><button type="button" data-jump="bp-h-layers">${esc(t("Show on map"))} ↓</button></div>
      <div class="bp-body"></div>`;
    renderBody();
  }

  function renderBody() {
    const body = picker.querySelector(".bp-body");
    if (!body) return;
    const ae = document.activeElement, ds = ae?.dataset || {};
    const focusKey = picker.contains(ae) && !ae.classList.contains("bp-filter")
      ? (ds.id != null ? `[data-id="${CSS.escape(ds.id)}"]`
        : ["toggle", "preset", "group"].filter((k) => ds[k] != null).map((k) => `[data-${k}="${CSS.escape(ds[k])}"]`)[0] || null) : null;
    const groups = [...(lensFile?.groups || [])];
    const known = new Set(groups.map((g) => g.id));
    if (lenses.some((l) => !known.has(l.group))) groups.push({ id: "__other", name: "Other" });
    const tile = (l) => `<button type="button" class="lp-tile ${isActive(l) ? "active" : ""}" data-id="${esc(l.id ?? "")}" aria-pressed="${isActive(l)}"
        title="${esc(l.description ? `${t(l.name)}: ${t(l.description)}` : t(l.name))}">
        <span class="lp-ic">${glyph(l, 20)}</span><span class="lp-nm">${esc(t(l.name))}</span>
        ${l.ramp ? `<i class="lp-ramp" style="background:linear-gradient(90deg, ${rampStops(l)})"></i>` : `<i class="lp-ramp terrain"></i>`}
      </button>`;
    const sec = (g, items) => {
      const shown = items.filter((l) => matches(t(l.name), l.name, l.description && t(l.description), t(g.name)));
      return !shown.length ? "" : `<section class="lp-group"><h4>${icon(g.icon || `g-${g.id}`, "", { size: 14 })}${esc(t(g.name))}</h4>
        <div class="lp-tiles">${shown.map(tile).join("")}</div></section>`;
    };
    const lensHtml = sec({ id: "base", name: "Base map", icon: "terrain" }, [TERRAIN])
      + groups.map((g) => sec(g, lenses.filter((l) => (g.id === "__other" ? !known.has(l.group) : l.group === g.id)))).join("");
    const row = (x) => `<button type="button" class="ml-row${x.on ? " on" : ""}" role="switch" aria-checked="${x.on}" data-toggle="${esc(x.id)}"
        ${x.title ? `title="${esc(x.title)}"` : ""}><span class="ml-ic">${tglyph(x.icon, 16)}</span><span class="ml-lbl">${esc(x.label)}</span>
        <span class="ml-switch" aria-hidden="true"></span></button>`;
    // A group with a label has a header button that opens and closes it ("3 on" and a chevron); ungrouped rows show as is.
    const layerHtml = (layers?.sections() || []).map((g) => {
      const items = g.items.filter((x) => matches(x.label, x.title, g.label));
      if (!items.length) return "";
      if (!g.label) return `<div class="ml-group" role="group">${items.map(row).join("")}</div>`;
      const open = isOpen(g.id), gid = `ml-g-${String(g.id).replace(/[^\w-]/g, "_")}`;
      const n = g.items.filter((x) => x.on).length;
      return `<div class="ml-group" role="group" aria-label="${esc(g.label)}">
        <button type="button" class="ml-sec" data-group="${esc(g.id)}" aria-expanded="${open}" aria-controls="${gid}">
          <span class="ml-sec-l">${esc(g.label)}</span><span class="ml-n">${esc(t("{n} on", { n }))}</span><span class="ml-chev" aria-hidden="true"></span></button>
        <div class="ml-items" id="${gid}"${open ? "" : " hidden"}>${items.map(row).join("")}</div></div>`;
    }).join("");
    const cur = layers?.preset?.() ?? null;
    const presetHtml = layers?.applyPreset ? `<div class="ml-presets" role="group" aria-label="${esc(t("Presets"))}">${PRESETS.map((p) =>
      `<button type="button" class="ml-preset" data-preset="${p.id}" aria-pressed="${cur === p.id}">${esc(t(p.label))}</button>`).join("")}</div>
      <p class="ml-custom"${cur ? " hidden" : ""}>${esc(t("Custom"))}</p>` : "";
    const head = (id, title, hint) => `<h3 class="bp-h" id="${id}">${esc(title)} <span class="bp-hint">${esc(hint)}</span></h3>`;
    body.innerHTML = `<section class="bp-col bp-lenses" aria-labelledby="bp-h-lens">${head("bp-h-lens", t("Colour by"), t("one theme at a time"))}
        ${lensHtml || `<p class="bp-none">${esc(t("No theme matches"))}</p>`}</section>
      <section class="bp-col bp-layers" aria-labelledby="bp-h-layers">${head("bp-h-layers", t("Show on map"), t("as many as you like"))}
        ${presetHtml}${layerHtml || `<p class="bp-none">${esc(layers ? t("No layer matches") : t("Loading…"))}</p>`}</section>`;
    if (focusKey) (body.querySelector(focusKey) || body.querySelector(".lp-tile, .ml-row"))?.focus();
  }

  function pick(id, fromPicker) {
    const lens = id ? byId.get(id) || null : null;
    if (lens && fromPicker && !recent.includes(lens.id)) {
      recent = [lens.id, ...recent].slice(0, 3);
      saveRecent(recent);
    }
    opts.onPick(lens);
  }

  quick.onclick = (e) => {
    const b = e.target.closest("button[data-id]");
    if (b) pick(b.dataset.id, false);
  };
  picker.onclick = (e) => {
    if (e.target.closest(".lp-close")) return closePicker();
    if (e.target.closest(".bp-tour")) { closePicker(false); return tour?.(); }
    const j = e.target.closest("[data-jump]"); // one-column panel: jump between the two sections
    if (j) return void picker.querySelector(`#${j.dataset.jump}`)?.scrollIntoView({ block: "start" });
    const pr = e.target.closest("[data-preset]");
    if (pr) return void layers?.applyPreset(pr.dataset.preset); // (onList re-renders and keeps focus on it)
    const gh = e.target.closest("[data-group]");
    if (gh) return toggleGroup(gh.dataset.group);
    const r = e.target.closest("[data-toggle]");
    if (r) return void layers?.flip(r.dataset.toggle); // (onList re-renders the rows and keeps focus on this one)
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    pick(b.dataset.id, true);
    closePicker();
  };
  picker.addEventListener("input", (e) => {
    if (!e.target.classList.contains("bp-filter")) return;
    filterRaw = e.target.value;
    filter = fold(filterRaw);
    filterShut = new Set();
    renderBody();
  });
  moreBtn.onclick = () => (picker.hidden ? openPicker() : closePicker());
  document.addEventListener("pointerdown", (e) => {
    if (!picker.hidden && !picker.contains(e.target) && !moreBtn.contains(e.target)) closePicker(false);
  });
  const focusables = () => [...picker.querySelectorAll("button, input")].filter((x) => !x.disabled && x.getClientRects().length);
  picker.addEventListener("keydown", (e) => {
    const inFilter = e.target.classList?.contains("bp-filter");
    if (e.key === "Escape" && inFilter && e.target.value) { // the first Esc clears the filter
      e.preventDefault();
      e.target.value = filterRaw = filter = "";
      return renderBody();
    }
    if (e.key === "Tab") { // keep focus inside the open panel
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    const items = [...picker.querySelectorAll(".lp-tile, .ml-preset, .ml-sec, .ml-row")].filter((x) => x.getClientRects().length);
    if (inFilter) {
      if (e.key === "ArrowDown" && items.length) { e.preventDefault(); items[0].focus(); }
      else if (e.key === "Enter" && filter) { // the first matching theme or layer (not a preset or a group header)
        const first = items.find((x) => x.matches(".lp-tile, .ml-row"));
        if (first) { e.preventDefault(); first.click(); }
      }
      return;
    }
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      items[(i + step + items.length) % items.length].focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      items[e.key === "Home" ? 0 : items.length - 1].focus();
    }
  });

  function openPicker() {
    filter = filterRaw = "";
    renderPicker();
    restoreFocus = document.activeElement;
    picker.hidden = false;
    legend.classList.add("behind");
    moreBtn.setAttribute("aria-expanded", "true");
    (picker.querySelector(".lp-tile.active") || picker.querySelector(".lp-tile"))?.focus({ preventScroll: true });
    picker.querySelector(".lp-tile.active")?.scrollIntoView({ block: "nearest" });
  }
  function closePicker(restore = true) {
    if (picker.hidden) return;
    picker.hidden = true;
    legend.classList.remove("behind");
    moreBtn.setAttribute("aria-expanded", "false");
    if (restore && restoreFocus && document.contains(restoreFocus) && restoreFocus !== document.body) restoreFocus.focus();
    else if (restore) moreBtn.focus();
  }

  // ---- legend ---------------------------------------------------------------------------------------------------
  function histogram(lens) {
    if (histCache.has(lens.id)) return histCache.get(lens.id);
    const counts = new Array(BINS).fill(0);
    const scale = lensScale(lens);
    const owner = w.raw.owner;
    let n = 0;
    for (let i = 0; i < lens.values.length; i++) {
      const v = lens.values[i];
      if (v == null || owner[i] < 0) continue;
      const tv = scale(v);
      if (!Number.isFinite(tv)) continue;
      counts[Math.max(0, Math.min(BINS - 1, Math.floor(tv * BINS)))]++;
      n++;
    }
    const h = { counts, n, max: Math.max(1, ...counts) };
    histCache.set(lens.id, h);
    return h;
  }

  function sourceLine(lens) {
    const src = sources.find((s) => s.id === lens.source);
    const name = src ? src.publisher && src.title.length > 44 ? src.publisher : src.title : lens.source;
    const vintage = src?.vintage ? t(src.vintage) : "";
    const label = name ? t(name) : "";
    return [label, !label.includes(vintage) && vintage].filter(Boolean).map(esc).join(" · "); // "ETOPO1 …" names its vintage
  }

  // Categorical lenses (format "category"): values are indices into lens.categories, whose colours are the ramp
  // stops (domain [0, n-1], linear), so world.js colours them exactly. The legend is a row of swatches; clicking
  // one shows only that category (the same band mechanism as the histogram).
  const isCategorical = (l) => l?.format === "category" && Array.isArray(l.categories) && l.categories.length > 0;
  const catBand = (l, k) => {
    const n = l.categories.length;
    if (n < 2) return [-Infinity, Infinity];
    const h = 0.5 / (n - 1);
    return [k === 0 ? -Infinity : k / (n - 1) - h, k === n - 1 ? Infinity : k / (n - 1) + h];
  };
  const catCounts = (l) => {
    const key = `cat:${l.id}`;
    if (histCache.has(key)) return histCache.get(key);
    const counts = new Array(l.categories.length).fill(0);
    const owner = w.raw.owner;
    for (let i = 0; i < l.values.length; i++) {
      const v = l.values[i];
      if (v == null || owner[i] < 0) continue;
      const k = Math.round(v);
      if (k >= 0 && k < counts.length) counts[k]++;
    }
    histCache.set(key, counts);
    return counts;
  };
  const noteHtml = (l) => (l.note ? `<div class="lg-note">${esc(t(l.note))}</div>` : "");

  function renderCategoricalLegend(l) {
    const counts = catCounts(l);
    const sw = l.categories.map((c, k) => `<button type="button" class="lg-cat" data-k="${k}" aria-pressed="false"
        title="${esc(t("{name} ({n} hexes)", { name: t(c.description || c.name), n: counts[k] }))}"><i style="background:${esc(c.color || l.ramp[k] || "#888")}"></i><span>${esc(t(c.name))}</span></button>`).join("");
    legend.hidden = false;
    legend.innerHTML = `
      <div class="lg-head"><span class="lg-ic">${glyph(l, 18)}</span><span class="title">${esc(t(l.name))}</span>
        <button class="icon-btn lg-more" aria-expanded="${legendExpanded}" aria-label="${t("Show the full legend")}" title="${t("Details")}">${legendExpanded ? "−" : "+"}</button>
        <button class="icon-btn lg-close" aria-label="${t("Turn the lens off (back to terrain)")}" title="${t("Back to terrain")}">${icon("close", "✕", { size: 11 })}</button></div>
      <div class="desc">${esc(t(l.description || l.unit || ""))}</div>
      ${noteHtml(l)}
      <div class="lg-cats" role="group" aria-label="${esc(t("{name} categories: click one to show only it", { name: t(l.name) }))}">${sw}</div>
      <div class="lg-meta"><span class="src">${sourceLine(l)}</span></div>
      <div class="lg-hint" aria-live="polite">${t("Click a category to show only it")}</div>`;
    legend.querySelector(".lg-close").onclick = () => opts.onPick(null);
    legend.classList.toggle("expanded", legendExpanded);
    legend.querySelector(".lg-more").onclick = () => {
      legendExpanded = !legendExpanded;
      renderLegend();
    };
    legend.querySelector(".lg-cats").onclick = (e) => {
      const b = e.target.closest(".lg-cat");
      if (!b) return;
      const nb = catBand(l, +b.dataset.k);
      setBand(same(nb, band) ? null : nb);
    };
  }

  function showCategoricalBand() {
    const l = active;
    const hint = legend.querySelector(".lg-hint");
    let picked = -1;
    legend.querySelectorAll(".lg-cat").forEach((b) => {
      const on = !!band && same(catBand(l, +b.dataset.k), band);
      if (on) picked = +b.dataset.k;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    });
    legend.querySelector(".lg-cats")?.classList.toggle("filtered", !!band);
    if (hint) {
      hint.textContent = picked >= 0 ? t("Showing only {what}", { what: t(l.categories[picked].name) }) : t("Click a category to show only it");
      hint.classList.toggle("on", picked >= 0);
    }
  }

  let legendExpanded = false;
  function renderLegend() {
    if (!active) {
      legend.hidden = true;
      legend.innerHTML = "";
      return;
    }
    const l = active;
    if (isCategorical(l)) return renderCategoricalLegend(l);
    const ticks = [0, 0.25, 0.5, 0.75, 1]
      .map((p, k) => `<span style="left:${p * 100}%;transform:translateX(-${p * 100}%)">${esc(formatLensTick(l, p, k))}</span>`)
      .join("");
    const hib = l.higher_is === "good" ? `<span class="hib good">▲ ${t("Higher is better")}</span>`
      : l.higher_is === "bad" ? `<span class="hib bad">▲ ${t("Higher is worse")}</span>` : "";
    legend.hidden = false;
    legend.innerHTML = `
      <div class="lg-head"><span class="lg-ic">${glyph(l, 18)}</span><span class="title">${esc(t(l.name))}</span>
        <button class="icon-btn lg-more" aria-expanded="${legendExpanded}" aria-label="${t("Show the full legend")}" title="${t("Details")}">${legendExpanded ? "−" : "+"}</button>
        <button class="icon-btn lg-close" aria-label="${t("Turn the lens off (back to terrain)")}" title="${t("Back to terrain")}">${icon("close", "✕", { size: 11 })}</button></div>
      <div class="desc">${esc(t(l.description || l.unit || ""))}</div>
      ${noteHtml(l)}
      <div class="lg-scale" role="slider" tabindex="0" aria-label="${esc(t("Highlight a range of {name} values. Hover or drag; arrow keys move the highlight, Escape clears it.", { name: t(l.name) }))}"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
        <canvas class="lg-hist" aria-hidden="true"></canvas>
        <div class="ramp" style="background:linear-gradient(90deg, ${l.ramp.map(esc).join(",")})"><div class="band-mark" hidden></div></div>
      </div>
      <div class="ticks">${ticks}</div>
      ${l.unit ? `<div class="lg-unit">${esc(t(l.unit))}</div>` : ""}
      <div class="lg-meta">${hib}<span class="src">${l.unit ? esc(t(l.unit)) + " · " : ""}${sourceLine(l)}</span></div>
      <div class="lg-hint" aria-live="polite">${t("Hover or drag the scale to show only that range")}</div>`;
    legend.querySelector(".lg-close").onclick = () => opts.onPick(null);
    legend.classList.toggle("expanded", legendExpanded);
    legend.querySelector(".lg-more").onclick = () => {
      // Beside a docked dashboard the legend is a compact strip; this expands it (and remembers it for the session).
      legendExpanded = !legendExpanded;
      renderLegend();
    };
    wireScale(legend.querySelector(".lg-scale"));
    drawHist();
  }

  function drawHist() {
    const cv = legend.querySelector(".lg-hist");
    if (!cv || !active) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth || 256, cssH = cv.clientHeight || 38;
    if (cv.width !== Math.round(cssW * dpr)) cv.width = Math.round(cssW * dpr);
    if (cv.height !== Math.round(cssH * dpr)) cv.height = Math.round(cssH * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!active.ramp) return;
    ctx.clearRect(0, 0, cssW, cssH);
    const h = histogram(active);
    const stops = active.ramp.map(parseHex);
    const bw = cssW / BINS;
    for (let b = 0; b < BINS; b++) {
      const c = h.counts[b];
      if (!c) continue;
      const tc = (b + 0.5) / BINS;
      const hh = Math.max(1.5, Math.sqrt(c / h.max) * (cssH - 2));
      const inBand = !band || (tc >= band[0] && tc <= band[1]);
      const [r, g, bl] = rampColor(stops, tc);
      ctx.fillStyle = `rgba(${r | 0},${g | 0},${bl | 0},${inBand ? 1 : 0.22})`;
      ctx.fillRect(b * bw + 0.5, cssH - hh, Math.max(1, bw - 1), hh);
    }
    ctx.fillStyle = "rgba(201,164,92,.45)";
    ctx.fillRect(0, cssH - 1, cssW, 1);
  }

  function showBand() {
    if (isCategorical(active)) return showCategoricalBand();
    const mark = legend.querySelector(".band-mark");
    const hint = legend.querySelector(".lg-hint");
    const scale = legend.querySelector(".lg-scale");
    if (!mark || !active) return;
    if (!band) {
      mark.hidden = true;
      hint.textContent = t("Hover or drag the scale to show only that range");
      hint.classList.remove("on");
    } else {
      const a = Math.max(0, band[0]), b = Math.min(1, band[1]);
      mark.hidden = false;
      mark.style.left = a * 100 + "%";
      mark.style.width = Math.max(0.5, (b - a) * 100) + "%";
      const lo = band[0] <= 0 ? "≤ " + formatLensValue(active, lensValueAt(active, b)) : null;
      const hi = band[1] >= 1 ? "≥ " + formatLensValue(active, lensValueAt(active, a)) : null;
      const txt = band[0] <= 0 && band[1] >= 1 ? t("all values")
        : lo || hi || `${formatLensValue(active, lensValueAt(active, a))} – ${formatLensValue(active, lensValueAt(active, b))}`;
      hint.textContent = t("Showing only {what}", { what: txt });
      hint.classList.add("on");
      scale.setAttribute("aria-valuenow", String(Math.round(((a + b) / 2) * 100)));
    }
    drawHist();
  }

  // Normalise a raw [t0, t1] into a quantised band that reaches past the ends of the ramp when it touches them
  // (so "the top" includes values above the domain).
  function normBand(t0, t1) {
    let a = Math.min(t0, t1), b = Math.max(t0, t1);
    a = Math.round(a * QUANT) / QUANT;
    b = Math.round(b * QUANT) / QUANT;
    if (b - a < 1 / QUANT) b = a + 1 / QUANT;
    return [a <= 0 ? -Infinity : a, b >= 1 ? Infinity : b];
  }
  const same = (p, q) => (p === q) || (p && q && p[0] === q[0] && p[1] === q[1]);
  function setBand(b) {
    if (same(b, band)) return;
    band = b;
    showBand();
    opts.onBand(b);
  }

  function wireScale(el) {
    let dragFrom = null;
    let center = 0.5;
    const tAt = (e) => {
      const r = el.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
    };
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      dragFrom = tAt(e);
      setBand(normBand(dragFrom - HOVER_HALF / 2, dragFrom + HOVER_HALF / 2));
    });
    el.addEventListener("pointermove", (e) => {
      const p = tAt(e);
      center = p;
      if (dragFrom != null) {
        if (Math.abs(p - dragFrom) > 0.01) setBand(normBand(dragFrom, p));
      } else if (e.pointerType === "mouse") {
        // Near either end the band runs off the ramp, so "the top" includes values above the domain.
        let a = p - HOVER_HALF, b = p + HOVER_HALF;
        if (b > 0.96) b = 1;
        if (a < 0.04) a = 0;
        setBand(normBand(a, b));
      }
    });
    const end = (e) => {
      if (dragFrom == null) return;
      const wasTap = Math.abs(tAt(e) - dragFrom) <= 0.01;
      dragFrom = null;
      // Touch: a tap with no drag clears the highlight; a drag keeps it until the next tap.
      if (e.pointerType !== "mouse" && wasTap) setBand(null);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", () => (dragFrom = null));
    el.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && dragFrom == null) setBand(null);
    });
    el.addEventListener("keydown", (e) => {
      const step = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key];
      if (step) {
        e.preventDefault();
        center = Math.max(0, Math.min(1, center + step));
        setBand(normBand(center - HOVER_HALF, center + HOVER_HALF));
      } else if (e.key === "Escape" && band) {
        e.stopPropagation();
        setBand(null);
      }
    });
    el.addEventListener("blur", () => band && dragFrom == null && setBand(null));
  }

  window.addEventListener("resize", () => drawHist());

  return {
    // Called by main whenever the lens changes (band is reset by main at the same time).
    render(lens, b = null) {
      active = lens;
      band = b;
      renderQuick();
      if (!picker.hidden) renderBody();
      renderLegend();
      showBand();
    },
    remember(id) {
      if (!byId.has(id) || recent.includes(id)) return;
      recent = [id, ...recent].slice(0, 3);
      saveRecent(recent);
      renderQuick();
    },
    openPicker,
    closePicker,
    /** The layer switches (app/api.js createMapToggles) shown under "Show on the map". */
    setLayers(l) {
      layers = l;
      l.onList(() => { renderQuick(); if (!picker.hidden) renderBody(); });
      renderQuick();
    },
    /** Show "▶ Watch the journey" at the top of the panel; fn starts the tour. */
    setTour(fn) { tour = typeof fn === "function" ? fn : null; },
    clearBand() { setBand(null); },
    get pickerOpen() { return !picker.hidden; },
    get band() { return band; },
  };
}
