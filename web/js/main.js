import { EMBED } from "./app/embed.js"; // first: embed mode swaps localStorage before any module reads it
import { watchApp } from "./app/telemetry.js"; // early: it reports uncaught errors (anonymous; off on localhost)
import { Camera } from "./camera.js";
import { prepareWorld, applyLens, stateIndex } from "./world.js";
import * as mapRender from "./render/map.js";
import { drawBanners } from "./render/banners.js";
import { renderTopbar } from "./ui/topbar.js";
import { showCellTooltip, showCityTooltip, showHtmlTooltip, hideTooltip } from "./ui/tooltip.js";
import { initLensDock, formatLensValue, lensValueAt } from "./ui/lenses.js";
import { openCityPanel, closeCityPanel } from "./ui/cityPanel.js";
import { openStatePanel } from "./ui/statePanel.js";
import { installSheetSwipe } from "./ui/infoPanel.js";
import { initPedia } from "./ui/pedia.js";
import { initYieldReports } from "./ui/yieldReport.js";
import { Minimap } from "./ui/minimap.js";
import { icon } from "./ui/icon.js";
import { initSearch, norm as normName } from "./app/search.js";
import { createEmitter, createHashState, createModes, createUi, createMapToggles } from "./app/api.js";
import { parseHash } from "./app/urlstate.js";
import { drawHighlight, drawOverlays, invalidateHighlight, highlightBounds } from "./render/overlays.js";
import { resourceFilterSig, layerActive, layerError, Z as LAYER_Z } from "./render/map.js";
import { installExtensions } from "./ext/index.js";
import { initShare } from "./app/share.js";
import { initHelp } from "./app/help.js";
import { initDonate } from "./app/donate.js";
import { createMotion } from "./app/motion.js";
import { createSearchHighlight } from "./app/highlight.js";
import { maybeWelcome } from "./app/welcome.js";
import { initEmbed, openEmbedDialog } from "./app/embedui.js";
import { cyberskillUrl, REPO_URL, GITHUB_SVG } from "./app/brand.js";
import { t, lang, setLang } from "./i18n.js";
import { esc, setAirportNames } from "./format.js";

// Static text in index.html (titles, aria-labels, placeholders, the loading line, <title>, meta description) goes
// through t() once, before anything else touches the DOM.
{
  document.title = t(document.title);
  const desc = document.querySelector('meta[name="description"]');
  if (desc) desc.content = t(desc.content);
  for (const el of document.querySelectorAll("body [title], body [aria-label], body [placeholder]")) {
    for (const a of ["title", "aria-label", "placeholder"]) if (el.hasAttribute(a)) el.setAttribute(a, t(el.getAttribute(a)));
  }
  const ld = document.getElementById("loading");
  if (ld) ld.textContent = t("Surveying the land…"); // index.html holds the Vietnamese default, shown while modules load
  // Map attribution: OpenStreetMap's credit links to its copyright page (ODbL).
  const OSM = `<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">${esc(t("© OpenStreetMap contributors"))}</a>`;
  const at = document.getElementById("map-attrib");
  if (at) at.innerHTML = `${OSM} · Natural Earth · OCHA COD-AB · <a href="${cyberskillUrl("attribution")}" target="_blank" rel="noopener">${esc(t("Made by CyberSkill"))}</a> · <a href="${REPO_URL}" target="_blank" rel="noopener">${esc(t("Open source"))} · ${GITHUB_SVG}GitHub</a>`;
  // The small "© OpenStreetMap" link stands in while the minimap (and the line above) is hidden: phones, open docks / panels.
  const mini = document.getElementById("attrib-mini"), wrap = document.getElementById("minimap-wrap");
  if (mini && wrap) {
    mini.title = t("© OpenStreetMap contributors") + " · Natural Earth · OCHA COD-AB";
    const sync = () => { mini.hidden = wrap.offsetWidth > 0; }; // (offsetParent is null for a fixed element)
    if (typeof ResizeObserver === "function") new ResizeObserver(sync).observe(wrap); // fires on display: none too
    sync();
  }
}

const { drawStatic, drawOverlay, OCEAN_BG } = mapRender;

// Data colours end up in style="color:…" and canvas fills: keep only hex colours (anything else could add CSS
// declarations), replaced by a neutral grey. Covers "color", "dark", "*_color" strings and "ramp" / "colors" lists.
const HEX = /^#[0-9a-f]{3,8}$/i;
const COLOR_KEY = /^(colou?rs?|dark|ramp|.*_colou?r)$/i;
function safeColors(o, colorKey = false) {
  if (Array.isArray(o)) {
    if (!o.length || typeof o[0] === "number") return o; // the big numeric grids
    for (let i = 0; i < o.length; i++) {
      if (colorKey && typeof o[i] === "string") { if (!HEX.test(o[i])) o[i] = "#888888"; } else safeColors(o[i], colorKey);
    }
  } else if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      const v = o[k], ck = COLOR_KEY.test(k);
      if (ck && typeof v === "string") { if (!HEX.test(v)) o[k] = "#888888"; } else if (v && typeof v === "object") safeColors(v, ck);
    }
  }
  return o;
}

async function loadJSON(name, optional = false) {
  try {
    const r = await fetch(`data/${name}.json`);
    if (!r.ok) throw new Error(`data/${name}.json: HTTP ${r.status}`);
    return safeColors(await r.json());
  } catch (err) {
    if (optional) return null;
    throw err;
  }
}

// Optional data files (docs/DATA_CONTRACTS.md). Small map-layer files are fetched right after the first frame; the
// others only when something asks for them (app.loadData(name)). A missing file (404) loads as null.
const EAGER_DATA = ["infrastructure", "military", "wonders", "trade", "places"];
const DATA_NAME = /^[a-z0-9_-]+$/;

// render/snapshot.js draws a whole view into any canvas; optional, with a local fallback.
const snapshotModule = import("./render/snapshot.js").catch(() => null);

const PANEL_W = 394; // city panel width + margins (css #city-panel)
// The top bar's height: 40 px, two rows (74 px) on narrow desktops and tablets (style.css).
let topH = 0; // cached; re-read after a resize
if (typeof addEventListener === "function") addEventListener("resize", () => { topH = 0; });
const topbarH = () => topH || (topH = document.getElementById("topbar")?.offsetHeight || 40);
const CACHE_MARGIN = 160; // css px of map rendered beyond each edge of the viewport, so short pans are a blit
const PAN_LEAD = 0.6; // a pan that runs off the cache re-renders it shifted this share of the margin ahead
const DOUBLE_MS = 260;
const SELECT_ANIM_MS = 33; // ~30 fps while a state's border highlight animates
const isMobile = () => matchMedia("(max-width: 700px)").matches;

async function main() {
  // Lenses: lenses_index.json (every lens without its per-hex values, ~35 kB) loads beside the core files and fills
  // lensFile / lensById in place (everything holds these same objects); a lens's values (data/lens/<id>.json) load
  // only when something needs them (lensValues; setLens waits for them). A plain visit paints the map without
  // waiting for the index; a deep link (#lens=…, #advisor=…) waits for it and for its lens's values, which start
  // downloading now, as its first frame may need a lens. (pipeline/build/pack.py makes the split files.)
  const deep = location.hash.length > 1;
  const lensLoads = new Map(); // lens id → Promise<values | null>
  const fetchLensValues = (id) => {
    if (!lensLoads.has(id)) lensLoads.set(id, loadJSON(`lens/${id}`, true).then((v) => (Array.isArray(v) ? v : (lensLoads.delete(id), null))));
    return lensLoads.get(id);
  };
  const hashLens = parseHash(location.hash).lens;
  if (hashLens && /^[a-z0-9_]+$/.test(hashLens)) fetchLensValues(hashLens);
  const lensesP = loadJSON("lenses_index", true);
  const [world, cities, nation, sources, resources, statesData] = await Promise.all([
    loadJSON("world"), loadJSON("cities"), loadJSON("nation"),
    loadJSON("sources", true), loadJSON("resources", true), loadJSON("states", true),
  ]);
  const lensFile = { vintage: "", groups: [], lenses: [] };
  const lensById = new Map();
  const fillLenses = (f) => {
    if (!f || !Array.isArray(f.lenses) || lensFile.lenses.length) return;
    lensFile.vintage = f.vintage || "";
    lensFile.groups.push(...(f.groups || []));
    lensFile.lenses.push(...f.lenses);
    for (const l of f.lenses) lensById.set(l.id, l);
  };
  const lensesReady = lensesP.then(fillLenses);
  /** A lens's per-hex values (a lens object or id), fetched once and kept on the lens object; null if unavailable. */
  async function lensValues(ref) {
    if (typeof ref === "string") { await lensesReady; ref = lensById.get(ref); }
    if (!ref?.id) return null;
    if (!ref.values && lensById.get(ref.id) === ref) { const v = await fetchLensValues(ref.id); if (v && !ref.values) ref.values = v; }
    return ref.values || null;
  }
  if (deep) { await lensesReady; if (hashLens) await lensValues(hashLens); }
  const w = prepareWorld(world, cities, { resources });
  const state = {
    cities, lens: null, band: null, hoverCell: -1, selectedCity: null, selectedState: null, showResources: false, // power plants: off by default (a switch in the Map panel, R)
    highlight: null, // {cells?, cities?, states?, resources?, dimOthers?, color?} (render/overlays.js)
    resourceFilter: null, // {types?: Set<typeId>, minValue?: number}
  };
  const states = Array.isArray(statesData) ? statesData : null;
  const cityById = new Map(cities.map((c) => [c.id, c]));
  const overlays = []; // app.registerOverlay(), sorted by z
  const staticLayers = []; // app.registerStaticLayer(), sorted by z (stable): drawn inside the cached static map
  const events = createEmitter();
  const motion = createMotion({ requestDraw }); // app.motion (app/motion.js): tweens + animated items on this loop
  let welcome = null; // the first-visit card (app/welcome.js), while it is up
  const panelEl = document.getElementById("city-panel");
  // The extension API object; filled in under "extension API" below, before anything can run against it.
  const app = {};
  const modes = createModes(app);
  events.on("mode", () => hideTooltip()); // a stale tooltip must not float over a mode's panels
  let ui = null;
  const snapshot = await snapshotModule;

  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");
  const cam = new Camera(world.width, world.height);
  {
    // prefers-reduced-motion or the Effects switch off: flights (up to 2.4 s of zooming out and back in) land on the
    // next frame instead.
    const fly = cam.flyTo.bind(cam), reduce = matchMedia("(prefers-reduced-motion: reduce)");
    cam.flyTo = (...args) => { fly(...args); if ((reduce.matches || !motion.userEnabled) && cam.flight) cam.flight.ms = 1; };
  }
  let dpr = 1;
  let hits = [];
  let queued = false;
  let userMoved = false;
  let gestureZoom = false; // a two-finger pinch is in progress: keep blitting the scaled cache, render at the end
  let dockFramed = false; // the camera was framed for open docks (onDocksChanged) and the user has not moved it since
  let lastFrame = 0;
  let animTimer = 0;
  let lastCamSig = "";
  let lastUrlCamSig = "";
  const perf = { static: [], frame: [], warm: [] }; // ms per static render / frame / idle warm-up strip

  const minimap = new Minimap(document.getElementById("minimap"), w, cam, (x, y) => {
    userMoved = true;
    dockFramed = false;
    // The clicked point goes to the middle of the map left free by docks and panels, not of the whole canvas.
    const a = visibleArea(), s = cam.scale;
    cam.centerOn(x - ((a.x0 + a.x1) / 2 - cam.w / 2) / s, y - ((a.y0 + a.y1) / 2 - cam.h / 2) / s);
    requestDraw();
    url.schedule();
  });
  const pedia = initPedia({ world, nation, lenses: lensFile, sources: sources || [], w, resources, states });
  const help = initHelp();
  const donate = initDonate();

  // --- static layer cache ----------------------------------------------------------------------------------------
  // Tiles, glyphs, rivers, borders, labels and resources are rendered into an offscreen canvas covering the view
  // plus a margin. Panning blits it; zooming blits it scaled and re-renders once the camera settles.
  const cache = { cv: document.createElement("canvas"), key: null, vp: null, hits: { resources: [] } };
  let cctx = cache.cv.getContext("2d");
  // Lens recolour: the old cache is kept (canvases swapped, not copied) and drawn over the new one while it fades
  // out, as a ripple from the middle of the view (a picked lens) or a crossfade (a year step). Freed afterwards.
  const spare = { cv: document.createElement("canvas") };
  spare.ctx = spare.cv.getContext("2d");
  const fade = { vp: null, p: 1, ripple: false, stop: null };
  function lensFade(ripple) {
    fade.stop?.();
    fade.stop = null;
    if (!motion.enabled || !cache.vp || !cache.cv.width) return endFade();
    if (fade.vp !== cache.vp) { // (a second change before the cache re-rendered keeps the first "before" picture)
      [cache.cv, spare.cv] = [spare.cv, cache.cv];
      [cctx, spare.ctx] = [spare.ctx, cctx];
      fade.vp = cache.vp;
    }
    fade.ripple = ripple;
    fade.p = 0;
    cache.key = null;
    fade.stop = motion.tween({ from: 0, to: 1, ms: ripple ? 480 : 380, ease: ripple ? "inOut" : "out", onUpdate: (p) => { fade.p = p; }, onDone: endFade });
  }
  function endFade() {
    fade.p = 1;
    fade.stop = null;
    if (!fade.vp) return;
    fade.vp = null;
    spare.cv.width = spare.cv.height = 0; // the spare canvas is as big as the cache: free it between fades
  }
  function drawFade() {
    const fv = fade.vp, p = fade.p;
    const fk = cam.scale / fv.s, [fx, fy] = cam.toScreen(fv.x0, fv.y0);
    ctx.save();
    let cx = 0, cy = 0, r = 0;
    if (fade.ripple) {
      const a = visibleArea();
      cx = (a.x0 + a.x1) / 2;
      cy = (a.y0 + a.y1) / 2;
      r = p * Math.hypot(Math.max(cx, cam.w - cx), Math.max(cy, cam.h - cy));
      ctx.beginPath();
      ctx.rect(0, 0, cam.w, cam.h);
      ctx.arc(cx, cy, r, 0, Math.PI * 2, true);
      ctx.clip("evenodd");
      ctx.globalAlpha = 1 - 0.35 * p;
    } else ctx.globalAlpha = 1 - p;
    ctx.drawImage(spare.cv, fx, fy, fv.cssW * fk, fv.cssH * fk);
    ctx.restore();
    if (fade.ripple && r > 1) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,214,120,${0.22 * (1 - p)})`;
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,236,180,${0.55 * (1 - p)})`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  // Each registered layer's id, visibility and own sig() are part of the key, so toggling or restyling a layer
  // re-renders the cache (and nothing else does).
  const layersSig = () => staticLayers.map((l) => {
    let vis = 1, sig = "";
    try {
      vis = typeof l.visible !== "function" || l.visible() !== false ? 1 : 0;
      sig = vis && typeof l.sig === "function" ? String(l.sig() ?? "") : "";
    } catch (err) {
      layerError(l, "sig", err);
    }
    return `${l.id}:${vis}:${sig}`;
  }).join(";");
  const cacheKey = () =>
    `${state.lens?.id ?? "terrain"}|${state.band ? state.band.join(",") : ""}|${state.showResources ? 1 : 0}|${dpr}|${cam.w}x${cam.h}` +
    `|${state.selectedCity?.id ?? ""}|${resourceFilterSig(state.resourceFilter)}|${layersSig()}`;

  // lead: [-1|0|1, -1|0|1], the direction a pan ran off the cache; the new cache reaches further that way (and less
  // the other way, same size), so a steady pan re-renders less often.
  function renderStatic(lead = null) {
    const t0 = performance.now();
    const s = cam.scale;
    const v = cam.view();
    const m = CACHE_MARGIN / s;
    const ox = lead ? lead[0] * PAN_LEAD * m : 0, oy = lead ? lead[1] * PAN_LEAD * m : 0;
    const vp = {
      x0: v.x0 - m + ox, y0: v.y0 - m + oy, x1: v.x1 + m + ox, y1: v.y1 + m + oy, s, dpr,
      cssW: cam.w + 2 * CACHE_MARGIN, cssH: cam.h + 2 * CACHE_MARGIN,
    };
    const W = Math.ceil(vp.cssW * dpr), H = Math.ceil(vp.cssH * dpr);
    if (cache.cv.width !== W || cache.cv.height !== H) {
      cache.cv.width = W;
      cache.cv.height = H;
    }
    const hitsOut = {};
    drawStatic(cctx, vp, w, {
      lens: state.lens, showResources: state.showResources, resourceFilter: state.resourceFilter, selectedCity: state.selectedCity, hits: hitsOut,
      layers: staticLayers, app,
    });
    cache.hits = { resources: hitsOut.resources || [] };
    cache.vp = vp;
    cache.key = cacheKey();
    record(perf.static, performance.now() - t0);
  }

  // --- sprite warm-up ----------------------------------------------------------------------------------------
  // The first render at a new zoom paints that zoom's terrain and city sprites (150-300 ms when zoomed in). Once the
  // view settles, idle time paints them for the next zoom step in and out, a strip at a time, so a wheel notch or a
  // +/- key lands on warm caches. Any camera move, lens or toggle change abandons the remaining work.
  const WARM_STEPS = [1.25, 0.8]; // ~one wheel notch (e^±0.22) and one sprite bucket (2^±0.25) in, then out
  const WARM_STRIPS = 6;
  const warm = { cv: null, ctx: null, handle: 0, jobs: [], sig: "" };
  const idle = typeof requestIdleCallback === "function"
    ? (fn) => requestIdleCallback(fn, { timeout: 2000 })
    : (fn) => setTimeout(() => fn({ timeRemaining: () => 12, didTimeout: false }), 250);
  const cancelIdle = typeof cancelIdleCallback === "function" ? cancelIdleCallback : clearTimeout;
  const warmSig = () => `${cam.x},${cam.y},${cam.scale}|${cacheKey()}`;
  function scheduleWarm() {
    if (typeof mapRender.warmSprites !== "function") return;
    if (warm.handle) cancelIdle(warm.handle);
    warm.handle = 0;
    warm.jobs = [];
    warm.sig = warmSig();
    const v = cam.view();
    const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2;
    for (const f of WARM_STEPS) {
      const s = cam.clampScale(cam.scale * f);
      if (Math.abs(s / cam.scale - 1) < 0.05) continue; // at a zoom limit
      const hw = (cam.w / 2 + CACHE_MARGIN) / s, hh = (cam.h / 2 + CACHE_MARGIN) / s;
      const y0 = cy - hh, sh = (2 * hh) / WARM_STRIPS;
      for (let k = 0; k < WARM_STRIPS; k++) {
        warm.jobs.push({ x0: cx - hw, x1: cx + hw, y0: y0 + k * sh, y1: y0 + (k + 1) * sh, s, dpr });
      }
    }
    if (warm.jobs.length) warm.handle = idle(runWarm);
  }
  function runWarm(deadline) {
    warm.handle = 0;
    if (document.hidden || cam.moving || gestureZoom || warm.sig !== warmSig()) { warm.jobs = []; return; }
    if (!warm.cv) {
      warm.cv = document.createElement("canvas");
      warm.cv.width = warm.cv.height = 8; // stamps land off-canvas; only the sprite caches get painted
      warm.ctx = warm.cv.getContext("2d");
    }
    do {
      const vp = warm.jobs.shift();
      try {
        const t0 = performance.now();
        mapRender.warmSprites(warm.ctx, vp, w, { lens: state.lens, selectedCity: state.selectedCity, layers: staticLayers, app });
        record(perf.warm, performance.now() - t0);
      } catch (err) {
        console.warn("sprite warm-up failed", err);
        warm.jobs = [];
      }
    } while (warm.jobs.length && deadline.timeRemaining() > 6);
    if (warm.jobs.length) warm.handle = idle(runWarm);
  }

  function record(list, ms) {
    list.push(ms);
    if (list.length > 60) list.shift();
  }

  function draw(moving) {
    const t0 = performance.now();
    const v = cam.view();
    const c = cache.vp;
    const sameKey = c && cache.key === cacheKey();
    const covers = sameKey && v.x0 >= c.x0 && v.y0 >= c.y0 && v.x1 <= c.x1 && v.y1 <= c.y1;
    const ratio = c ? cam.scale / c.s : 1;
    // Re-render when the cache misses the view, when the zoom has settled, or when a zoom-in gets too blurry.
    // A pinch counts as moving: the scale changes every pointer event, and re-rendering each one would stall.
    const settling = moving || gestureZoom;
    if (!covers || (!settling && Math.abs(ratio - 1) > 1e-3) || ratio > 2) {
      // A pure pan (same layer, same zoom) that ran off an edge: lead the new cache in that direction.
      const pan = sameKey && cam.scale === c.s && !gestureZoom
        ? [v.x0 < c.x0 ? -1 : v.x1 > c.x1 ? 1 : 0, v.y0 < c.y0 ? -1 : v.y1 > c.y1 ? 1 : 0] : null;
      renderStatic(pan);
      if (!settling) scheduleWarm();
    }

    const vp = cache.vp;
    const k = cam.scale / vp.s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = OCEAN_BG;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const [dx, dy] = cam.toScreen(vp.x0, vp.y0);
    ctx.drawImage(cache.cv, dx, dy, vp.cssW * k, vp.cssH * k);
    if (fade.vp && fade.p < 1) drawFade();

    const s = cam.scale;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.w / 2 - cam.x * s), dpr * (cam.h / 2 - cam.y * s));
    drawOverlay(ctx, cam, w, state, motion.enabled ? performance.now() : 0); // 0 = the still selection frame
    if (state.highlight) drawHighlight(ctx, cam, w, state, { resourceHits: cache.hits.resources, items: resources?.items, cityById });
    if (overlays.length) drawOverlays(ctx, cam, overlays, app, { dpr, zMax: 100 });
    motion._draw(ctx, cam, app, { dpr, zMax: 100, moving: settling });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Plates of cities beside an open dock stay clear of it (desktop docks only; phones use a bottom sheet).
    const d = isMobile() ? null : dockState();
    state.bannerBounds = d && d.open ? { x0: d.l, x1: cam.w - d.r } : null;
    hits = drawYearBanners(ctx, cam, state);
    if (overlays.length) drawOverlays(ctx, cam, overlays, app, { dpr, zMin: 100 });
    motion._draw(ctx, cam, app, { dpr, zMin: 100, moving: settling });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    minimap.draw();
    record(perf.frame, performance.now() - t0);
  }

  function frame(now) {
    queued = false;
    motion._step(now);
    const dt = lastFrame ? (now - lastFrame) / 1000 : 1 / 60;
    const moving = cam.step(dt);
    draw(moving);
    lastFrame = moving ? now : 0;
    const camSig = `${cam.x},${cam.y},${cam.scale}`;
    if (camSig !== lastCamSig) {
      lastCamSig = camSig;
      emitCamera();
    }
    // The link follows a flight's destination (written right away), and otherwise the camera itself, debounced so
    // it catches up once a pan or zoom settles. Re-scheduling on every flight frame would hold it back until landing.
    const f = cam.flight;
    const urlCamSig = f ? `f${f.x1},${f.y1},${f.s1}` : camSig;
    if (urlCamSig !== lastUrlCamSig) {
      lastUrlCamSig = urlCamSig;
      url.schedule();
    }
    // Keep going while the camera moves, the selection's border sweep runs or app.motion has something to animate
    // (ambient-only motion at half rate when this device is over its frame budget: motion.lowPower).
    const want = moving || selectionAnimates() ? 1 : motion._wants();
    if (want === 1) requestDraw();
    else if (want === 2) {
      if (!motion.lowPower) requestDraw();
      else if (!animTimer) animTimer = setTimeout(() => { animTimer = 0; requestDraw(); }, SELECT_ANIM_MS);
    }
  }
  // render/map.js says whether the selected state's border sweep runs (off with reduced motion / the Effects switch).
  function selectionAnimates() {
    if (!motion.enabled) return false;
    if (typeof mapRender.isAnimating === "function") return !!mapRender.isAnimating(state);
    return false;
  }
  function requestDraw() {
    if (!queued) {
      queued = true;
      requestAnimationFrame(frame);
    }
  }

  // --- view ----------------------------------------------------------------------------------------------------
  // Home view: the land's bounding box framed in the visible area (below the top bar, above the mobile dock), with
  // extra room left and right so the coastal city banners (~120 px, centred on the city) are not clipped.
  const HOME_M = 190; // fallback frame if the world has no owned cells: world.json margin is 200 map units
  const HOME_PAD_X = 92;
  const HOME_PAD_Y = 26;
  const LEGEND_W = 324; // #legend: 300 px wide, 12 px from the right edge, plus a gap
  const ownedBox = (withRemote) => {
    const g = w.grid, own = w.raw.owner, remote = new Set(withRemote ? [] : w.raw.remote || []);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < g.size; i++) {
      if (!(own[i] >= 0) || remote.has(i)) continue;
      const x = g.cx(i), y = g.cy(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (!Number.isFinite(x0)) return { x0: HOME_M, y0: HOME_M, x1: world.width - HOME_M, y1: world.height - HOME_M };
    return { x0: x0 - g.R, y0: y0 - g.R, x1: x1 + g.R, y1: y1 + g.R };
  };
  // The zoom fits the mainland (far-offshore islands, world.remote, do not shrink it); the centre takes in Hoàng Sa,
  // Trường Sa and the slogan between them whenever they fit beside the mainland at that zoom (desktop), else
  // (portrait phones) it stays on the mainland and the archipelagos are a pan to the east.
  const landBox = ownedBox(false);
  const westByRow = new Map(); // row y → westernmost mainland x (keeps the Mekong delta clear of the minimap)
  for (let i = 0, remote = new Set(w.raw.remote || []); i < w.grid.size; i++) {
    if (!(w.raw.owner[i] >= 0) || remote.has(i)) continue;
    const y = w.grid.cy(i), x = w.grid.cx(i);
    if (!(westByRow.get(y) <= x)) westByRow.set(y, x);
  }
  const territoryBox = ownedBox(true);
  // Portrait phones: the whole country would be a thin strip between big bands of fog, so start closer in.
  const isPortraitPhone = () => cam.w <= 700 && cam.h > cam.w * 1.15;
  const PORTRAIT_ZOOM = 1.0; // a tall country already fills a portrait screen
  // The scale that frames the whole land in the visible area (URL zoom levels are relative to it).
  const fitIn = (a, padFrac = 0.1) => {
    const padX = Math.min(HOME_PAD_X, (a.x1 - a.x0) * padFrac);
    const s = Math.min((a.x1 - a.x0 - 2 * padX) / (landBox.x1 - landBox.x0), (a.y1 - a.y0 - 2 * HOME_PAD_Y) / (landBox.y1 - landBox.y0));
    return s > 0 && Number.isFinite(s) ? s : cam.scale || 1;
  };
  const fitScale = () => fitIn(visibleArea(false, false));
  // The furthest zoom-out allowed: a bit beyond the home view, and always far enough that the whole country fits
  // beside open docks (an advisor dashboard at 1024 px leaves only ~560 px of map).
  function updateMinScale(fs = fitScale()) {
    const base = fs * (isPortraitPhone() ? 0.9 : 0.6);
    const d = dockState();
    const docked = d.open ? fitIn(visibleArea(false, d), 0.08) * 0.9 : Infinity;
    cam.minScale = Math.min(base, docked);
  }
  // Centre and scale of the home view; with an area and a scale (open docks), the same framing inside that area.
  // legendW: what the lens legend takes off the right edge (beside open docks it is a strip at the top right).
  function homeView(a = visibleArea(false, false), s = null, legendW = LEGEND_W) {
    const fs = fitScale();
    if (s == null) s = isPortraitPhone() ? fs * PORTRAIT_ZOOM : fs;
    const tb = territoryBox, fits = (tb.x1 - tb.x0) * s <= a.x1 - a.x0 - 2 * Math.min(HOME_PAD_X, (a.x1 - a.x0) * 0.1);
    let cx = fits ? (tb.x0 + tb.x1) / 2 : (landBox.x0 + landBox.x1) / 2;
    const cy = (landBox.y0 + landBox.y1) / 2;
    if (fits && !isMobile()) {
      // Desktop: the easternmost islands, and the slogan (24 px at this zoom, it overhangs them by up to ~60 px),
      // stay left of the lens legend (bottom right) while the mainland stays on screen and the Mekong delta clear
      // of the minimap (bottom left). Narrow windows (~1024 px) zoom out up to 15% to make room; past that the
      // slogan wins over the delta.
      const mid = (a.x0 + a.x1) / 2, R = w.grid.R;
      const mm = document.getElementById("minimap-wrap")?.getBoundingClientRect();
      const bounds = (sc) => {
        const lo = tb.x1 - (a.x1 - legendW - 60 - mid) / sc; // cx at least this: islands + slogan clear the legend
        const edge = landBox.x0 - (a.x0 + HOME_PAD_Y - mid) / sc; // cx at most this: the mainland on screen
        let hi = edge;
        if (mm?.width) {
          for (const [y, x] of westByRow) {
            if ((a.y0 + a.y1) / 2 + (y + R - cy) * sc > mm.top) hi = Math.min(hi, x - R - (mm.right + 8 - mid) / sc);
          }
        }
        return { lo, hi, edge };
      };
      let b = bounds(s);
      for (let k = 0; k < 3 && b.lo > b.hi; k++) b = bounds((s *= 0.95));
      cx = Math.max(cx, b.lo);
      cx = Math.min(cx, b.lo <= b.hi ? b.hi : b.edge);
    }
    // Put the land's centre in the middle of the visible area, not of the whole canvas.
    return { x: cx - ((a.x0 + a.x1) / 2 - cam.w / 2) / s, y: cy - ((a.y0 + a.y1) / 2 - cam.h / 2) / s, s, fs };
  }
  function home() {
    if (!(cam.w > 160 && cam.h > 160)) return false; // hidden or still being laid out
    const h = homeView();
    cam.stop();
    cam.scale = h.s;
    cam.fitScale = h.fs;
    updateMinScale(h.fs);
    cam.x = h.x;
    cam.y = h.y;
    return true;
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, innerWidth), ch = Math.max(1, innerHeight);
    // A rotation or window resize (not a phone's URL bar, which changes only the height) can push the selected
    // city or province under the bottom sheet or the panel: if it was on screen before, bring it back into view.
    const sel = cw !== cam.w && userMoved && cam.scale > 0 ? selectionPoint() : null;
    const selShown = sel && (([sx, sy]) => sx >= 0 && sx <= cam.w && sy >= 0 && sy <= cam.h)(cam.toScreen(sel[0], sel[1]));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    cam.resize(cw, ch);
    // Keep refitting until the user has moved the map (the first layout may be tiny or hidden).
    if (!userMoved || !(cam.scale > 0)) home();
    else {
      updateMinScale();
      if (selShown) {
        const a = visibleArea(), [sx, sy] = cam.toScreen(sel[0], sel[1]);
        if (sx < a.x0 || sx > a.x1 || sy < a.y0 || sy > a.y1) {
          cam.stop(); // a flight started for the old layout (a dock turning into the sheet) would land it there again
          cam.x = sel[0] - ((a.x0 + a.x1) / 2 - cam.w / 2) / cam.scale;
          cam.y = sel[1] - ((a.y0 + a.y1) / 2 - cam.h / 2) / cam.scale;
          cam.clamp();
          url.schedule();
        }
      }
    }
    requestDraw();
    events.emit("resize", { w: cam.w, h: cam.h, dpr });
  }

  function moved() {
    linkAt = null;
    userMoved = true;
    dockFramed = false;
    hideTooltip();
    url.schedule();
  }

  // The part of the screen not covered by the top bar, the docks (app.ui.dock) and an open panel / bottom sheet
  // (css px). Open docks always count (an extension's dashboard covers the map whether or not a panel is open);
  // only the home fit calls visibleArea(false, false), so URL zoom levels stay comparable.
  const panelShown = () => !!panelEl && !panelEl.hidden;
  const NO_DOCKS = { l: 0, r: 0, open: false };
  const dockState = () => (ui
    ? { l: ui.dockWidth("left") || 0, r: ui.dockWidth("right") || 0, open: !!(ui.isDockOpen("left") || ui.isDockOpen("right")) }
    : NO_DOCKS);

  // Docks opening, closing or changing width change the usable map area. Unless something is already flying the
  // camera (an extension framing its own view right after docking), keep the map readable:
  //  * from the home view (or a view this function framed), fit the whole land into what is left, and go back home
  //    when the last dock closes;
  //  * otherwise keep whatever was in the middle of the usable area in the middle (on phones this lifts the map
  //    above the bottom sheet).
  let lastDocks = NO_DOCKS;
  function onDocksChanged() {
    const prevD = lastDocks, now = dockState();
    lastDocks = now;
    if (prevD.l === now.l && prevD.r === now.r && prevD.open === now.open) return;
    updateMinScale();
    // A Back / Forward link's camera (at=) was aimed before the link's advisor / City view opened its dock: re-aim
    // that flight at the new usable area, or the place lands under the dock.
    if (linkFlight && cam.flight === linkFlight.f) return flyLinkAt(linkFlight.at, cam.flight.ms);
    // Likewise a page opened from a link: its at= was placed beside the panel, which a City View then swaps for its
    // dock (a different width). Re-place it in the new usable area, or every reload shifts the view by half a panel.
    // (only while the camera is still where the link put it: a search pick, minimap click or flyTo since then moved it)
    const at = linkAt && cam.x === linkAt.x && cam.y === linkAt.y && cam.scale === linkAt.s ? linkAt.at : null;
    linkAt = null;
    if (at && !cam.moving && cam.scale > 0) {
      const a = visibleArea(), s = cam.scale;
      cam.x = at[0] - ((a.x0 + a.x1) / 2 - cam.w / 2) / s;
      cam.y = at[1] - ((a.y0 + a.y1) / 2 - cam.h / 2) / s;
      cam.clamp();
      return requestDraw();
    }
    // Likewise a home flight started just before the docks changed (an advisor closing calls app.home()).
    if (homeFlight && cam.flight === homeFlight) return goHome(cam.flight.ms);
    if (cam.moving || !(cam.w > 160 && cam.h > 160) || !(cam.scale > 0)) return;
    const panel = panelShown();
    const a = visibleArea(panel, now);
    const acx = (a.x0 + a.x1) / 2, acy = (a.y0 + a.y1) / 2;
    if (!userMoved || dockFramed) {
      if (now.open) {
        goHome(450);
      } else if (dockFramed) {
        goHome(450);
      }
    } else {
      const p = visibleArea(panel, prevD);
      const [wx, wy] = cam.toWorld((p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2);
      const s = cam.scale;
      cam.flyTo(wx - (acx - cam.w / 2) / s, wy - (acy - cam.h / 2) / s, s, 350);
    }
    requestDraw();
  }
  // Fly to the home view; with docks open, the same framing (archipelagos and slogan in view when they fit) inside
  // what the docks leave, zoomed out on desktop (down to the docked minimum) until the whole territory fits.
  let homeFlight = null;
  function goHome(ms = 750) {
    let h = homeView();
    const d = dockState();
    if (d.open) {
      updateMinScale();
      const a = visibleArea(panelShown(), d), tb = territoryBox, fit = Math.min(h.s, fitIn(a, 0.08));
      if (isMobile()) {
        // Phones: the mainland above the sheet (the slogan is wider than the screen at this zoom).
        const sc = cam.clampScale(fit);
        h = { x: (landBox.x0 + landBox.x1) / 2 - ((a.x0 + a.x1) / 2 - cam.w / 2) / sc, y: (landBox.y0 + landBox.y1) / 2 - ((a.y0 + a.y1) / 2 - cam.h / 2) / sc, s: sc };
      } else {
        const tfit = (a.x1 - a.x0 - 2 * Math.min(HOME_PAD_X, (a.x1 - a.x0) * 0.1) - 60) / (tb.x1 - tb.x0);
        h = homeView(a, cam.clampScale(Math.min(fit, tfit)), 24);
      }
    }
    hideTooltip();
    cam.flyTo(h.x, h.y, h.s, ms);
    homeFlight = cam.flight;
    userMoved = d.open;
    dockFramed = d.open;
    requestDraw();
  }
  // `docks`: true = the docks as they are now, false = none, or a dockState()-shaped object.
  function visibleArea(panelOpen = panelShown(), docks = true) {
    const d = docks === true ? dockState() : docks || NO_DOCKS;
    if (isMobile()) {
      const sheet = panelOpen || d.open;
      return { x0: 0, y0: topbarH(), x1: cam.w, y1: sheet ? cam.h * 0.45 : cam.h - (EMBED ? 26 : 56) }; // (embed: no dock, only the maker badge)
    }
    const dl = d.l, dr = d.r;
    const x1 = cam.w - dr - (panelOpen && cam.w > 760 ? PANEL_W : 0);
    return { x0: Math.min(dl, x1 - 100), y0: topbarH(), x1, y1: cam.h - (EMBED ? 26 : 52) }; // above the lens dock (embed: the maker badge)
  }

  // Fly so that world point (x, y) lands in the middle of the visible area at scale s.
  function flyToVisible(x, y, s, ms = 750) {
    updateMinScale();
    s = cam.clampScale(s);
    hideTooltip();
    const a = visibleArea();
    const vx = (a.x0 + a.x1) / 2, vy = (a.y0 + a.y1) / 2;
    cam.flyTo(x - (vx - cam.w / 2) / s, y - (vy - cam.h / 2) / s, s, ms);
    userMoved = true;
    dockFramed = false;
    requestDraw();
  }

  // World point of the selection: the selected city's hex, or the middle of the selected province (null if none).
  function selectionPoint() {
    const c = state.selectedCity;
    if (c?.cell != null) return [w.grid.cx(c.cell), w.grid.cy(c.cell)];
    const b = state.selectedState != null ? stateBox(state.selectedState) : null;
    return b ? [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] : null;
  }

  function focusCity(city) {
    const s = Math.min(cam.maxScale, Math.max(cam.scale, 0.8));
    flyToVisible(w.grid.cx(city.cell), w.grid.cy(city.cell), s);
  }

  const stateBoxes = new Map();
  function stateBox(idx) {
    if (stateBoxes.has(idx)) return stateBoxes.get(idx);
    const g = w.grid, remote = new Set(w.raw.remote || []);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < g.size; i++) {
      if (w.raw.owner[i] !== idx || remote.has(i)) continue;
      const x = g.cx(i), y = g.cy(i);
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    const box = Number.isFinite(x0) ? { x0: x0 - g.R, y0: y0 - g.R, x1: x1 + g.R, y1: y1 + g.R } : null;
    stateBoxes.set(idx, box);
    return box;
  }

  // Frame a km rectangle in the visible area, with extra css-px padding on each side. Returns the target scale.
  function fitBounds(x0, y0, x1, y1, { padLeft = 24, padRight = 24, padTop = 24, padBottom = 24, maxScale = cam.maxScale, ms = 750 } = {}) {
    hideTooltip();
    updateMinScale();
    const a = visibleArea();
    const ax0 = a.x0 + padLeft, ax1 = a.x1 - padRight, ay0 = a.y0 + padTop, ay1 = a.y1 - padBottom;
    const bw = Math.max(1e-6, x1 - x0), bh = Math.max(1e-6, y1 - y0);
    let s = Math.min(Math.max(20, ax1 - ax0) / bw, Math.max(20, ay1 - ay0) / bh);
    s = cam.clampScale(Math.min(maxScale, s));
    const vx = (ax0 + ax1) / 2, vy = (ay0 + ay1) / 2;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    cam.flyTo(cx - (vx - cam.w / 2) / s, cy - (vy - cam.h / 2) / s, s, ms);
    userMoved = true;
    dockFramed = false;
    requestDraw();
    return s;
  }

  function focusState(idx) {
    const b = stateBox(idx);
    if (!b) return;
    const a = visibleArea(true);
    const pad = 36;
    const s = Math.min((a.x1 - a.x0 - 2 * pad) / (b.x1 - b.x0), (a.y1 - a.y0 - 2 * pad) / (b.y1 - b.y0));
    flyToVisible((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, Math.min(2.2, Math.max(fitScale(), s * 0.85))); // a little context around it
  }

  // --- lens ------------------------------------------------------------------------------------------------------
  const dock = initLensDock({
    lenses: lensFile, sources: sources || [], w,
    onPick: (lens) => setLens(lens),
    onBand: (band) => setBand(band),
  });

  let minimapQueued = false;
  const rebuildMinimap = () => {
    if (minimapQueued) return;
    minimapQueued = true;
    requestAnimationFrame(() => { minimapQueued = false; minimap.rebuild(); });
  };

  // app.setLensView(fn): fn(lens) → a lens-shaped object to colour, legend and tooltip with instead of `lens` (e.g.
  // the timeline's values for one year; give it its own id so the legend's histogram cache keeps them apart), or
  // null for the lens itself. state.lens (and the hash, the picker) stay on the real lens. fn must be cheap (cached).
  let lensView = null;
  let lastShown = null; // the lens object last coloured (a change fades the map: lensFade)
  const shownLens = () => (state.lens && lensView ? lensView(state.lens) || state.lens : state.lens);

  // A lens whose values are still downloading: setLens(lens) applies it when they land, unless another lens (or
  // none) was picked meanwhile. curLens() is the lens the user asked for last.
  let wantLens = null;
  const curLens = () => wantLens || state.lens;
  function setLens(lens) {
    if (lens && !lens.values) {
      wantLens = lens;
      lensValues(lens).then((v) => { if (wantLens === lens) { wantLens = null; if (v) setLens(lens); else url.schedule(); } });
      url.schedule();
      return;
    }
    wantLens = null;
    const changed = lens !== state.lens;
    state.lens = lens;
    state.band = null;
    if (changed) lensFade(true);
    lastShown = shownLens();
    applyLens(w, shownLens(), null);
    dock.render(shownLens(), null);
    rebuildMinimap();
    describeCanvas();
    requestDraw();
    url.schedule();
    if (changed) events.emit("lens", lens);
  }

  function setBand(band) {
    if (!state.lens) return;
    state.band = band;
    applyLens(w, shownLens(), band);
    rebuildMinimap();
    requestDraw(); // the cache key includes the band, so the static layer re-renders
  }

  // --- selection -------------------------------------------------------------------------------------------------
  const announceEl = document.getElementById("announce");
  const announce = (text) => {
    announceEl.textContent = "";
    setTimeout(() => (announceEl.textContent = text), 30);
  };
  const stateName = (idx) => states?.[idx]?.name || w.raw.states[idx]?.name || t("State");

  function describeCanvas() {
    const parts = [t("Hex map of Vietnam"), state.lens ? t("coloured by the {lens} lens", { lens: t(state.lens.name) }) : t("showing terrain")];
    if (state.selectedCity) parts.push(t("{name} selected", { name: state.selectedCity.name }));
    else if (state.selectedState != null) parts.push(t("{name} selected", { name: stateName(state.selectedState) }));
    canvas.setAttribute("aria-label", parts.join(", "));
  }

  const panelCtx = () => ({
    w, nation, states, cities,
    onClose: () => clearSelection(),
    onPedia: () => pedia.open("Yields"),
    onState: (idx) => selectState(idx, { fly: true }),
    onCity: (city) => selectCity(city, { fly: true }),
  });

  let bannerPop = null;
  function selectCity(city, { fly = true } = {}) {
    if (!city) return clearSelection();
    if (city !== state.selectedCity) {
      // The selected banner pops gently (state.bannerPop: its scale, render/banners.js).
      bannerPop?.();
      bannerPop = motion.tween({ from: 0, to: 1, ms: 340, ease: "out", onUpdate: (p) => { state.bannerPop = 1 + 0.12 * Math.sin(Math.PI * p); } });
    }
    state.selectedCity = city;
    state.selectedState = null;
    app.panels.city(city, panelCtx());
    if (fly && city.cell != null) focusCity(city);
    announce(`${t("{name} selected.", { name: city.name })} ${String(city.full || "").replace("(former province)", t("(former province)"))}`);
    afterSelect();
  }

  function selectState(idx, { fly = false } = {}) {
    if (idx == null || !w.raw.states[idx]) return clearSelection();
    state.selectedCity = null;
    state.selectedState = idx;
    app.panels.state(idx, panelCtx());
    if (fly) focusState(idx);
    announce(t("{name} selected.", { name: stateName(idx) }));
    afterSelect();
  }

  function clearSelection() {
    const had = state.selectedCity || state.selectedState != null;
    state.selectedCity = null;
    state.selectedState = null;
    app.panels.close();
    if (had) announce(t("Selection closed."));
    afterSelect();
  }

  let lastSelSig = "";
  function afterSelect() {
    hideTooltip();
    describeCanvas();
    requestDraw();
    url.schedule();
    const sig = state.selectedCity ? `c${state.selectedCity.id}` : state.selectedState != null ? `s${state.selectedState}` : "";
    if (sig !== lastSelSig) {
      lastSelSig = sig;
      events.emit("select", state.selectedCity ? { kind: "city", city: state.selectedCity }
        : state.selectedState != null ? { kind: "state", index: state.selectedState, state: states?.[state.selectedState] ?? null, info: w.raw.states[state.selectedState] }
          : null);
    }
  }

  installSheetSwipe(() => clearSelection());

  // --- URL state -------------------------------------------------------------------------------------------------
  // #state= accepts a code ("01", "1"), an abbreviation ("HN", "hn") or a name ("Hà Nội", "ha noi"). Links keep the form
  // they were opened with; the app itself writes the code.
  function stateFromHash(ref) {
    const t = String(ref ?? "").trim();
    if (!t) return -1;
    if (/^\d{1,2}$/.test(t)) return stateIndex(w, t.padStart(2, "0"));
    const k = stateIndex(w, t.toUpperCase());
    if (k >= 0) return k;
    // A name, with or without diacritics, as the search box matches it: "Hà Nội", "ha noi", "ha-noi", "Ha_Noi".
    const name = normName(t);
    return w.raw.states.findIndex((st, i) => normName(states?.[i]?.name || st.name) === name);
  }
  function viewAt() {
    const f = cam.flight, cx = f ? f.x1 : cam.x, cy = f ? f.y1 : cam.y, s = f ? f.s1 : cam.scale;
    const a = visibleArea();
    return [cx + ((a.x0 + a.x1) / 2 - cam.w / 2) / s, cy + ((a.y0 + a.y1) / 2 - cam.h / 2) / s, Math.log2(s / fitScale())];
  }
  // The flight a link's at= started (Back / Forward), so onDocksChanged can re-aim it: {f: cam.flight, at}.
  let linkFlight = null;
  let linkAt = null; // {at, x, y, s}: the at= the page was opened with and where it put the camera, until the user moves or a dock changes (onDocksChanged)
  function flyLinkAt(at, ms) {
    const [vx, vy, z] = at;
    const s = cam.clampScale(fitScale() * 2 ** z);
    const a = visibleArea();
    cam.flyTo(vx - ((a.x0 + a.x1) / 2 - cam.w / 2) / s, vy - ((a.y0 + a.y1) / 2 - cam.h / 2) / s, s, ms);
    linkFlight = { f: cam.flight, at };
    requestDraw();
  }
  let stateHashRef = null; // {idx, raw}: the form of the #state value the current selection came from
  const url = createHashState({
    replaceOnly: EMBED,
    // A flight is not "busy": read() reports its destination. Pans and wheel zooms are, until they settle.
    busy: () => cam.moving && !cam.flight && !held.size,
    read() {
      const sel = state.selectedCity ? { city: state.selectedCity.id }
        : state.selectedState != null ? {
          state: stateHashRef && stateHashRef.idx === state.selectedState ? stateHashRef.raw : w.raw.states[state.selectedState]?.fips,
        } : {};
      return {
        // While lenses.json is still downloading, a link's lens cannot be applied yet: keep it in the URL, where
        // url.applyCurrent() picks it up once the lenses land.
        lens: curLens()?.id || (!lensFile.lenses.length ? parseHash(location.hash).lens : null),
        ...sel,
        // at = [x km, y km, log2(scale / home-fit scale)]; during a flight, where it will land. x, y is the world point
        // in the middle of visibleArea() (not of the canvas), so a link frames the same place beside a desktop
        // panel and above a phone's bottom sheet.
        at: userMoved ? viewAt() : null,
      };
    },
    apply(p, { initial }) {
      const lens = p.lens ? lensById.get(p.lens) || null : null;
      if (lens !== curLens() || state.band) setLens(lens);
      if (lens) dock.remember(lens.id);
      const city = p.city ? cities.find((c) => c.id === p.city) : null;
      const sIdx = p.state ? stateFromHash(p.state) : -1;
      stateHashRef = sIdx >= 0 ? { idx: sIdx, raw: p.state } : null;
      if (city) {
        if (city !== state.selectedCity) selectCity(city, { fly: !p.at });
      } else if (sIdx >= 0) {
        if (sIdx !== state.selectedState) selectState(sIdx, { fly: !p.at });
      } else if (state.selectedCity || state.selectedState != null) clearSelection();
      if (p.at) {
        const [vx, vy, z] = p.at;
        const s = cam.clampScale(fitScale() * 2 ** z);
        const a = visibleArea(); // after the selection above opened its panel / sheet
        const x = vx - ((a.x0 + a.x1) / 2 - cam.w / 2) / s, y = vy - ((a.y0 + a.y1) / 2 - cam.h / 2) / s;
        if (initial) {
          cam.stop();
          cam.x = x;
          cam.y = y;
          cam.scale = s;
          cam.clamp();
          linkAt = { at: p.at, x: cam.x, y: cam.y, s: cam.scale };
        } else flyLinkAt(p.at, 650);
        userMoved = true;
      } else if (!initial && !city && sIdx < 0) {
        const h = homeView();
        cam.flyTo(h.x, h.y, h.s, 650);
        userMoved = false;
      }
      requestDraw();
    },
  });

  // --- top bar, search, share, help ------------------------------------------------------------------------------
  const setBtn = (id, html) => {
    const b = document.getElementById(id);
    if (b) b.innerHTML = html;
    return b;
  };
  setBtn("btn-share", `${icon("share", "🔗", { size: 15 })}<span class="lbl">${t("Share")}</span>`);
  setBtn("btn-help", `${icon("help", "?", { size: 15 })}<span class="lbl">${t("Help")}</span>`);
  {
    // Language switch: shows the other language; switching reloads with the same view (i18n.js).
    const b = document.getElementById("btn-lang");
    const other = lang === "vi" ? "en" : "vi";
    if (b) {
      b.textContent = other === "en" ? "EN" : "VI";
      b.title = other === "en" ? "Switch to English" : "Chuyển sang tiếng Việt";
      b.setAttribute("aria-label", `${b.textContent} · ${b.title}`); // the visible code first (WCAG label in name)
      b.onclick = () => { url.flush(); setLang(other); };
    }
  }
  setBtn("btn-pedia", `${icon("pedia", "📖", { size: 16 })}<span class="lbl">${t("Almanac")}</span>`);
  const searchIc = document.querySelector(".search-ic");
  if (searchIc) searchIc.innerHTML = icon("search", "🔍", { size: 14 });
  document.querySelector(".search-kbd")?.setAttribute("title", t("Press / or Ctrl K to search"));

  // A search pick's marker: pin, pulsing ring, floating name; a province's outline glows (app/highlight.js).
  const searchHl = createSearchHighlight({
    motion, cam, w, isMobile, requestDraw,
    bannerShown: (city) => hits.some((h) => h.city === city), // a city's banner already names it
  });
  const search = initSearch({
    cities,
    states: w.raw.states.map((s, i) => ({ name: states?.[i]?.name || s.name, abbr: s.abbr, population: states?.[i]?.population, former: states?.[i]?.former })),
    onPick(r) {
      if (r.kind === "city") selectCity(r.city, { fly: true });
      else selectState(r.index, { fly: true });
      searchHl.set(r.kind === "city" ? { city: r.city, label: r.city.name } : { state: r.index, label: stateName(r.index) });
      focusPanel(); // keyboard focus follows the pick into its panel (as from a report), not back to <body>
    },
    // An extension's entry was picked (its pick() ran): mark the place unless pick() marked it itself (app.highlight).
    // Its geometry is entry.line, entry.at or entry.box; else where pick() is flying the camera to.
    onPicked(e, marksBefore) {
      if (searchHl.marks !== marksBefore) return;
      const p = (v) => (Array.isArray(v) ? { x: +v[0], y: +v[1] } : v && { x: +v.x, y: +v.y });
      const box = e.box && (Array.isArray(e.box) ? { x: (e.box[0] + e.box[2]) / 2, y: (e.box[1] + e.box[3]) / 2 } : null);
      const at = e.line ? null : p(e.at) || box || (cam.flight ? (([x, y]) => ({ x, y }))(viewAt()) : null);
      if (e.line || (at && Number.isFinite(at.x) && Number.isFinite(at.y))) searchHl.set({ ...(e.line ? { line: e.line } : at), label: e.label || e.name });
    },
    marks: () => searchHl.marks,
  });

  const toastEl = document.getElementById("toast");
  let toastTimer = 0;
  const toast = (msg) => {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastEl.hidden = true), 1800);
  };
  ui = createUi(app, {
    toast,
    // A dock opened, closed or changed width: the usable map area changed.
    onLayout: () => { onDocksChanged(); requestDraw(); events.emit("resize", { w: cam.w, h: cam.h, dpr, docks: true }); },
  });

  // app.bannerPopulation(city) → a number to show on the banner instead of city.population (the timeline's year),
  // or null; swapped in for this draw only (the screen and the share image alike).
  function drawYearBanners(c, camera, st) {
    const swapped = [];
    if (typeof app.bannerPopulation === "function") {
      for (const city of cities) {
        const v = app.bannerPopulation(city);
        if (Number.isFinite(v) && v !== city.population) { swapped.push([city, city.population]); city.population = v; }
      }
    }
    try {
      return drawBanners(c, camera, w, st, nation.yields, nation);
    } finally {
      for (const [city, v] of swapped) city.population = v;
    }
  }

  // Renders the current view (minus panels) into an offscreen canvas for the share image.
  function renderShareMap(target, W, H) {
    const a = visibleArea();
    const [cx, cy] = cam.toWorld((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
    const vw = (a.x1 - a.x0) / cam.scale, vh = (a.y1 - a.y0) / cam.scale;
    // Lay the frame out at about the on-screen size and render it at a higher pixel ratio, so banners and labels
    // keep the proportions they have on screen instead of shrinking on a 1600 px canvas.
    const k = Math.min(2, Math.max(1, W / Math.max(1, a.x1 - a.x0)));
    const cssW = W / k, cssH = H / k;
    const snap = new Camera(world.width, world.height);
    snap.resize(cssW, cssH);
    snap.minScale = 1e-6;
    snap.maxScale = 1e6;
    // The image (about 2:1) is wider than most screens. "Contain" framing would pad it with wide bands of
    // off-world fog, "cover" would crop a lot of the view: zoom in from contain until the frame is no wider than
    // the world plus a little (the whole country still fits at home; the vignette sinks the rest into deep
    // water), but never past cover.
    const sContain = Math.min(cssW / vw, cssH / vh), sCover = Math.max(cssW / vw, cssH / vh);
    // ...and, zoomed out, keep the whole height of the land (with the northern banners) in the frame.
    const sNoFog = Math.min(cssW / (world.width * 1.2), (cssH - 16) / (landBox.y1 - landBox.y0));
    // (A view zoomed out past the world is mostly fog: then sCover < sNoFog and sNoFog wins.)
    snap.scale = Math.max(sNoFog, Math.min(sCover, Math.max(sContain, sNoFog)));
    // Keep the frame (nearly) inside the world rectangle: it may overhang by a tenth of its size, which the
    // vignette turns into open water, so a coastal selection is not shoved against the image edge.
    const fw = cssW / snap.scale, fh = cssH / snap.scale;
    const inside = (c, f, W) => {
      const m = f * 0.1;
      return f >= W + 2 * m ? W / 2 : Math.min(W - f / 2 + m, Math.max(f / 2 - m, c));
    };
    snap.x = inside(cx, fw, world.width);
    snap.y = inside(cy - 14 / snap.scale, fh, world.height); // nudged up: banners stand above their cities
    const shot = { ...state, hoverCell: -1 };
    const c = target.getContext("2d");
    c.fillStyle = OCEAN_BG;
    c.fillRect(0, 0, W, H);
    // Map first, then a vignette that sinks any off-world fog at the frame edges into deep water, then banners.
    const s = snap.scale;
    if (typeof snapshot?.renderToCanvas === "function") {
      snapshot.renderToCanvas(target, snap, w, shot, nation, {
        banners: false, dpr: k, scale: s, x: snap.x, y: snap.y, app, overlays: overlays.filter((o) => o.snapshot && (o.z ?? 0) < 100),
        staticLayers: staticLayers.filter((l) => l.snapshot !== false),
      });
    } else {
      const v = snap.view();
      drawStatic(c, { x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1, s, dpr: k, cssW, cssH }, w, {
        lens: state.lens, showResources: state.showResources, layers: staticLayers.filter((l) => l.snapshot !== false), app, snapshot: true,
      });
      c.setTransform(k * s, 0, 0, k * s, k * (cssW / 2 - snap.x * s), k * (cssH / 2 - snap.y * s));
      drawOverlay(c, snap, w, shot, 0);
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    shareVignette(c, W, H, snap, k);
    c.setTransform(k, 0, 0, k, 0, 0);
    drawYearBanners(c, snap, shot);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return true;
  }

  // Edge treatment for the share image (device px). Where the frame reaches past the world rectangle, the flat
  // off-world fog fades into deep water; elsewhere a light vignette frames the picture.
  function shareVignette(c, W, H, snap, k) {
    const deep = (a) => `rgba(9,24,42,${a})`;
    const [wx0, wy0] = snap.toScreen(0, 0).map((v) => v * k);
    const [wx1, wy1] = snap.toScreen(world.width, world.height).map((v) => v * k);
    const fade = 70; // px the fade reaches into the world
    const band = (x0, y0, x1, y1, rx, ry, rw, rh) => {
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, deep(0.92));
      g.addColorStop(1, deep(0));
      c.fillStyle = g;
      c.fillRect(rx, ry, rw, rh);
    };
    if (wx0 > -fade) band(0, 0, wx0 + fade, 0, 0, 0, Math.max(0, wx0 + fade), H);
    if (wx1 < W + fade) band(W, 0, wx1 - fade, 0, wx1 - fade, 0, W - (wx1 - fade), H);
    if (wy0 > -fade) band(0, 0, 0, wy0 + fade, 0, 0, W, Math.max(0, wy0 + fade));
    if (wy1 < H + fade) band(0, H, 0, wy1 - fade, 0, wy1 - fade, W, H - (wy1 - fade));
    const r = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.55, W / 2, H / 2, Math.hypot(W, H) / 2);
    r.addColorStop(0, deep(0));
    r.addColorStop(1, deep(0.38));
    c.fillStyle = r;
    c.fillRect(0, 0, W, H);
  }

  const shareInfo = () => ({
    renderMap: renderShareMap,
    lens: shownLens(),
    year: shownLens()?.year ?? app.timeline?.year ?? null,
    note: (typeof app.shareNote === "function" && app.shareNote()) || null, // an extension's key to what it draws (sea level)
    lensSource: (sources || []).find((x) => x.id === state.lens?.source) || null,
    formatValue: (lens, t) => formatLensValue(lens, lensValueAt(lens, t)),
    selection: state.selectedCity ? { kind: "city", name: state.selectedCity.name }
      : state.selectedState != null ? { kind: "state", name: stateName(state.selectedState), abbr: w.raw.states[state.selectedState]?.abbr } : null,
  });
  const slug = (s) => String(s).replace(/[đĐ]/g, "d").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const share = initShare({
    button: document.getElementById("btn-share"),
    getInfo: shareInfo,
    beforeCopy: () => url.flush(),
    fileName: () => {
      const sel = shareInfo().selection;
      return `vietnam-${state.lens?.id || "terrain"}${sel ? "-" + slug(sel.name) : ""}.png`;
    },
    onToast: toast,
    onEmbed: () => { url.flush(); openEmbedDialog({ lens: shownLens(), restore: document.getElementById("btn-more") }); },
  });

  function focusPanel() {
    const p = document.getElementById("city-panel");
    if (!p || p.hidden) return;
    if (!p.hasAttribute("tabindex")) p.tabIndex = -1;
    p.focus({ preventScroll: true });
  }

  // National reports under the top-bar stats.
  const reports = initYieldReports({
    nation, states, cities, lenses: lensFile.lenses, lensVintage: (sources || []).find((s) => s.id === "nso_yearbook")?.vintage || "",
    // A row picked from a report opens the place's panel; keyboard focus follows it there.
    onState: (idx) => { selectState(idx, { fly: true }); focusPanel(); },
    onCity: (city) => { selectCity(city, { fly: true }); focusPanel(); },
    onLens: (id) => {
      const lens = lensById.get(id);
      if (!lens) return;
      if (lens !== curLens()) setLens(lens);
      dock.remember(lens.id);
    },
  });

  document.getElementById("btn-help").onclick = () => help.toggle();
  document.getElementById("btn-pedia").onclick = () => pedia.open();

  // --- resources toggle + minimap toggle -------------------------------------------------------------------------
  const resBtn = document.getElementById("btn-res");
  if (resBtn) {
    resBtn.hidden = !w.resources;
    resBtn.innerHTML = `${icon("resources", "⛏️", { size: 15 })}<span>${t("Power plants")}</span>`;
    resBtn.setAttribute("aria-label", t("Power plants (R)"));
    resBtn.title = t("Show or hide power plants (R)");
    const sync = () => {
      resBtn.classList.toggle("active", state.showResources);
      resBtn.setAttribute("aria-pressed", String(state.showResources));
    };
    resBtn.onclick = () => {
      state.showResources = !state.showResources;
      sync();
      requestDraw();
    };
    sync();
  }
  // --bottom-ui on <body>: how far the bottom row (Map button + year bar) reaches up from the bottom edge, so bars
  // that float above it (a replay) never cover it.
  {
    const row = document.getElementById("dock-row");
    const setH = () => row && document.body.style.setProperty("--bottom-ui", `${Math.max(0, Math.round(innerHeight - row.getBoundingClientRect().top))}px`);
    if (row && typeof ResizeObserver === "function") new ResizeObserver(setH).observe(row);
    addEventListener("resize", setH);
  }
  const mmBtn = document.getElementById("btn-minimap");
  if (mmBtn) {
    mmBtn.innerHTML = icon("terrain", "🗺️", { size: 18 });
    mmBtn.onclick = () => {
      const on = !document.body.classList.contains("minimap-on");
      document.body.classList.toggle("minimap-on", on);
      mmBtn.setAttribute("aria-pressed", String(on));
      mmBtn.setAttribute("aria-label", t(on ? "Hide the minimap" : "Show the minimap"));
      minimap.draw();
    };
  }

  // Map layer switches (app.ui.addMapToggle), in the Layers menu; kept in the hash (layers=).
  const mapToggles = createMapToggles({
    hash: { register: url.register, update: url.schedule, value: url.value },
    onChange: () => requestDraw(),
  });
  dock.setLayers(mapToggles); // "Show on the map", in the same "Map" panel as the themes
  ui.addMapToggle = mapToggles.add;
  ui.mapToggles = mapToggles.list;
  ui.setMapToggle = mapToggles.set;
  // Power plants (id "resources") are a switch in the Layers menu (the R key and old links still go through the hidden button).
  if (resBtn && w.resources) {
    resBtn.hidden = true;
    ui.addMapToggle({
      id: "resources", group: "energy", label: t("Power plants"), icon: "resources", title: t("Show or hide power plants (R)"), default: false,
      get: () => state.showResources,
      set: (v) => { if (!!v !== state.showResources) resBtn.click(); },
    });
  }

  // Effects switch (app.motion.setEnabled): a per-browser preference, so it stays out of the layers= hash.
  ui.addMapToggle({
    id: "motion", group: "display", label: t("Effects"), icon: "✨", hash: false,
    title: t("Animations and map effects. When off (or when the system asks for reduced motion) the map stays still and shows the same information."),
    get: () => motion.userEnabled,
    set: (v) => motion.setEnabled(v),
  });

  // --- input -----------------------------------------------------------------------------------------------------
  const hitCity = (mx, my) => hits.find((h) => mx >= h.x && mx <= h.x + h.w && my >= h.y && my <= h.y + h.h)?.city;
  const cellAt = (mx, my) => w.grid.cellAt(...cam.toWorld(mx, my));
  // The resource icon under a screen point (css px), from where the cached static layer placed the icons.
  function hitResource(mx, my) {
    if (!state.showResources || !cache.vp) return null;
    const k = cam.scale / cache.vp.s; // the cache is blitted scaled while a zoom settles
    for (const p of cache.hits.resources) {
      const [sx, sy] = cam.toScreen(p.x, p.y);
      const r = p.r * k + 1;
      if ((mx - sx) ** 2 + (my - sy) ** 2 <= r * r) return p.item;
    }
    return null;
  }
  // The topmost registered static layer item under a screen point (css px): {layer, item} or null. Layers are asked
  // from the highest z down, only when drawn at the current zoom, with the pointer in world km.
  function hitLayer(mx, my) {
    if (!staticLayers.length) return null;
    const Rpx = w.grid.R * cam.scale;
    let xy = null;
    for (let k = staticLayers.length - 1; k >= 0; k--) {
      const l = staticLayers[k];
      if (typeof l.hit !== "function" || !layerActive(l, Rpx)) continue;
      xy ??= cam.toWorld(mx, my);
      let item = null;
      try {
        item = l.hit(xy[0], xy[1], Rpx);
      } catch (err) {
        layerError(l, "hit", err);
      }
      if (item != null) return { layer: l, item };
    }
    return null;
  }
  let lastHover = { cell: -1, city: null, resource: null, layer: null, item: null };
  function emitHover(cell, city, resource, x = null, y = null, lh = null) {
    const layer = lh?.layer.id ?? null, item = lh?.item ?? null;
    if (cell === lastHover.cell && city === lastHover.city && resource === lastHover.resource && layer === lastHover.layer && item === lastHover.item) return;
    // x, y: screen css px of the pointer (null when it left the map); layer / item: a static layer's hit, or null
    lastHover = { cell, city, resource, x, y, layer, item };
    events.emit("hover", lastHover);
  }
  // "camera" events: at most every 100 ms while moving, plus once when the camera settles.
  let camEmitAt = 0, camTimer = 0;
  function emitCamera() {
    const now = performance.now();
    const fire = () => {
      camEmitAt = performance.now();
      camTimer = 0;
      events.emit("camera", { x: cam.x, y: cam.y, scale: cam.scale, Rpx: w.grid.R * cam.scale, moving: cam.moving });
    };
    if (now - camEmitAt >= 100) {
      clearTimeout(camTimer);
      fire();
    } else if (!camTimer) camTimer = setTimeout(fire, 100 - (now - camEmitAt));
    if (!cam.moving) {
      clearTimeout(camTimer);
      camTimer = setTimeout(fire, 120); // trailing event with the settled view
    }
  }
  const pointers = new Map(); // pointerId -> {x, y}
  let drag = null; // {moved}
  let pinch = null; // {dist, cx, cy}
  let lastTap = null; // {t, x, y}
  let pendingTap = 0;

  let hoverFade = null; // the hovered hex's highlight fades in (state.hoverFade 0..1, render/map.js)
  function hover(mx, my) {
    const city = hitCity(mx, my);
    const cell = cellAt(mx, my);
    if (cell !== state.hoverCell) {
      state.hoverCell = cell;
      hoverFade?.();
      hoverFade = motion.tween({ from: 0, to: 1, ms: 140, ease: "out", onUpdate: (v) => { state.hoverFade = v; } });
      requestDraw();
    }
    const lh = city ? null : hitLayer(mx, my);
    let tip = null;
    if (lh && typeof lh.layer.tooltip === "function") {
      try {
        tip = lh.layer.tooltip(lh.item);
      } catch (err) {
        layerError(lh.layer, "tooltip", err);
      }
    }
    if (city) showCityTooltip(mx, my, city);
    else if (tip != null && tip !== "") showHtmlTooltip(mx, my, tip);
    else if (cell >= 0) showCellTooltip(mx, my, w, cell, shownLens(), state.showResources);
    else hideTooltip();
    if (events.has("hover")) emitHover(cell, city || w.cityByCell.get(cell) || null, hitResource(mx, my), mx, my, lh);
  }

  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    cam.stop();
    if (pointers.size === 1) drag = { moved: 0 };
    else if (pointers.size === 2) {
      drag = { moved: 99 }; // a two-finger gesture is never a tap
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      hideTooltip();
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === "mouse") hover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pinch && pointers.size >= 2) {
      // Two pointers: zoom about their midpoint and pan with it.
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (pinch.dist > 0 && dist > 0) cam.zoomAt(cx, cy, dist / pinch.dist);
      gestureZoom = true;
      cam.panBy(cx - pinch.cx, cy - pinch.cy);
      pinch = { dist, cx, cy };
      moved();
      requestDraw();
      return;
    }
    if (drag) {
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved > 4) {
        canvas.classList.add("dragging");
        cam.panBy(dx, dy);
        moved();
        requestDraw();
      }
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (gestureZoom && pointers.size < 2) { gestureZoom = false; requestDraw(); } // render the settled zoom
    if (pointers.size > 0) return;
    canvas.classList.remove("dragging");
    const wasTap = drag && drag.moved <= 4;
    drag = null;
    if (!wasTap) return;
    const mx = e.clientX, my = e.clientY;
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_MS && Math.hypot(mx - lastTap.x, my - lastTap.y) < 12) {
      // Double click / double tap: zoom in, never select.
      clearTimeout(pendingTap);
      lastTap = null;
      cam.zoomBy(mx, my, 2);
      moved();
      requestDraw();
      return;
    }
    lastTap = { t: now, x: mx, y: my };
    // Resolve the target from the release position now; act once we know it was not a double click.
    const cell = cellAt(mx, my);
    const banner = hitCity(mx, my);
    const lh = banner ? null : hitLayer(mx, my); // a layer's site wins over the city tile under it, not its banner
    const city = banner || w.cityByCell.get(cell);
    const owner = cell >= 0 ? w.raw.owner[cell] : -1;
    const resource = hitResource(mx, my);
    clearTimeout(pendingTap);
    pendingTap = setTimeout(() => {
      searchHl.clear(); // a click on the map puts away a search pick's marker
      // Extensions (e.g. a mode) may take the click: a "mapclick" handler that returns true consumes it.
      const ev = {
        cell, city: city || null, resource, state: owner >= 0 ? owner : null, x: mx, y: my, pointerType: e.pointerType,
        layer: lh?.layer.id ?? null, item: lh?.item ?? null,
      };
      // A static layer's click(item, ev) returning true consumes the click (e.g. opening its own card). It goes
      // before the "mapclick" handlers, except while a mode (City View, advisors) is active: the mode owns clicks.
      const layerClick = () => {
        if (!lh || typeof lh.layer.click !== "function") return false;
        try {
          return lh.layer.click(lh.item, ev) === true;
        } catch (err) {
          layerError(lh.layer, "click", err);
          return false;
        }
      };
      if (!modes.mode && layerClick()) return;
      if (events.emit("mapclick", ev)) return;
      if (modes.mode && layerClick()) return;
      if (city) selectCity(city);
      else if (owner >= 0) {
        // On phones the bottom sheet would hide the state, so bring it into the visible part of the map; not for a
        // Hoàng Sa / Trường Sa hex, which the province's frame leaves out (it would fly away from the tapped island).
        if (owner !== state.selectedState) selectState(owner, { fly: isMobile() && !(w.raw.remote || []).includes(cell) });
        // Touch has no hover: a tap inside the province already open shows the hex's tooltip (terrain, lens value, site).
        else if (e.pointerType !== "mouse") hover(mx, my);
      } else if (state.selectedCity || state.selectedState != null) clearSelection();
    }, DOUBLE_MS);
    // A click changes what is on screen (a panel, a mode, a flight), so drop the tooltip until the pointer moves again.
    hideTooltip();
  });
  canvas.addEventListener("pointercancel", (e) => {
    pointers.delete(e.pointerId);
    pinch = null;
    if (gestureZoom) { gestureZoom = false; requestDraw(); }
    drag = null;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("pointerleave", () => {
    if (pointers.size) return;
    state.hoverCell = -1;
    hideTooltip();
    requestDraw();
    if (events.has("hover")) emitHover(-1, null, null);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    cam.zoomBy(e.clientX, e.clientY, Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.0022));
    moved();
    requestDraw();
  }, { passive: false });
  canvas.addEventListener("dblclick", (e) => e.preventDefault()); // handled in pointerup

  // Keyboard: held arrows / WASD pan smoothly; +/- zoom with easing.
  const PAN_SPEED = 750; // px per second
  const PAN_KEYS = {
    ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0], ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
  };
  const held = new Set();
  const updatePan = () => {
    let x = 0, y = 0;
    for (const k of held) { x += PAN_KEYS[k][0]; y += PAN_KEYS[k][1]; }
    cam.pan.x = Math.sign(x) * PAN_SPEED;
    cam.pan.y = Math.sign(y) * PAN_SPEED;
    if (x || y) { moved(); requestDraw(); }
  };
  const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  // Focus on a control (a button, the legend slider) should keep arrow keys for that control.
  const ownsArrows = (t) => t && t !== document.body && (t.getAttribute?.("role") === "slider" || t.closest?.("#lens-picker, #share-pop, #yield-report"));

  // Esc closes the topmost thing: help, search, share, a top-bar report, lens picker, Almanac, then the panel.
  function escape() {
    if (donate?.isOpen) return donate.close();
    if (welcome?.isOpen) return welcome.close();
    if (help.isOpen) return help.close();
    if (search.isOpen) return search.close();
    if (share.isOpen) return share.close();
    if (reports.isOpen) return reports.close();
    if (dock.pickerOpen) return dock.closePicker();
    if (pedia.isOpen) return pedia.close();
    if (modes.escape()) return; // the active mode (e.g. the City view) goes before the panels
    if (events.emit("escape", {})) return;
    const hadMark = searchHl.clear(); // a search pick's marker goes with its selection (or alone, when there is none)
    if (state.selectedCity || state.selectedState != null) return clearSelection();
    if (hadMark) return;
  }

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if ((e.metaKey || e.ctrlKey) && !e.altKey && k === "k") {
      e.preventDefault();
      if (!help.isOpen && !pedia.isOpen && !donate?.isOpen && !welcome?.isOpen) search.focus();
      return;
    }
    if (k === "Escape") { escape(); return; }
    if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
    if (welcome?.isOpen) return; // the welcome card is up: no map shortcuts behind it
    if (k === "?") { e.preventDefault(); if (!donate?.isOpen) help.toggle(); return; }
    if (help.isOpen || pedia.isOpen || donate?.isOpen) return; // a dialog is up: no map shortcuts behind it
    if (k === "/") {
      e.preventDefault();
      search.focus();
    } else if (PAN_KEYS[k] && !(k.startsWith("Arrow") && ownsArrows(e.target))) {
      e.preventDefault();
      held.add(k);
      updatePan();
    } else if (k === "+" || k === "=") { cam.zoomBy(cam.w / 2, cam.h / 2, 1.5); moved(); requestDraw(); }
    else if (k === "-" || k === "_") { cam.zoomBy(cam.w / 2, cam.h / 2, 1 / 1.5); moved(); requestDraw(); }
    else if (k === "l") {
      const all = [null, ...lensFile.lenses];
      const step = e.shiftKey ? -1 : 1;
      setLens(all[(all.indexOf(curLens()) + step + all.length) % all.length]);
    } else if (k === "r" && w.resources) resBtn?.click();
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (held.delete(k)) updatePan();
  });
  window.addEventListener("blur", () => { held.clear(); updatePan(); });
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", () => !document.hidden && resize());

  // --- extension API ---------------------------------------------------------------------------------------------
  // The `app` object handed to ext/*/install(app) and exposed as window.__app. See the README of this API in
  // app/api.js and the summary below; names here are a stable contract with the extensions in ext/.
  const dataLoads = new Map(); // name → Promise<data | null>
  function loadData(name) {
    if (!DATA_NAME.test(String(name))) return Promise.reject(new Error(`loadData: bad name "${name}"`));
    if (!dataLoads.has(name)) {
      dataLoads.set(name, loadJSON(name, true).then((d) => {
        app.data[name] = d ?? null;
        if (name === "infrastructure") setAirportNames(d?.airports);
        events.emit("data", { name, data: app.data[name] });
        return app.data[name];
      }));
    }
    return dataLoads.get(name);
  }
  function registerStaticLayer(l) {
    if (!l || !l.id || typeof l.draw !== "function") throw new Error("registerStaticLayer({id, z, draw(ctx, vp, w, o)})");
    const k = staticLayers.findIndex((x) => x.id === l.id);
    if (k >= 0) staticLayers.splice(k, 1);
    staticLayers.push(l);
    staticLayers.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
    cache.key = null;
    scheduleWarm();
    requestDraw();
    return () => unregisterStaticLayer(l);
  }
  function unregisterStaticLayer(idOrLayer) {
    const k = staticLayers.findIndex((x) => x === idOrLayer || x.id === idOrLayer);
    if (k < 0) return false;
    staticLayers.splice(k, 1);
    cache.key = null;
    requestDraw();
    return true;
  }
  Object.assign(app, {
    // data. Optional files arrive via loadData(name) (and the "data" event); see docs/DATA_CONTRACTS.md.
    data: { world, cities, states, nation, lenses: lensFile, resources, sources: sources || [], counties: null },
    loadData,
    loadCounties: () => loadData("counties"),
    w, cam, state, cityById, lensById,
    lensValues, // (id | lens) → Promise<per-hex values | null>; lensById's lenses carry `values` only once loaded
    // drawing
    requestDraw,
    motion, // app/motion.js; docs/DATA_CONTRACTS.md "Motion"
    invalidate() { cache.key = null; invalidateHighlight(); requestDraw(); },
    registerOverlay(o) {
      if (!o || typeof o.draw !== "function") throw new Error("registerOverlay({id, z, space, draw})");
      const k = overlays.findIndex((x) => x.id === o.id && o.id != null);
      if (k >= 0) overlays.splice(k, 1);
      overlays.push(o);
      overlays.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
      requestDraw();
      return () => app.unregisterOverlay(o.id ?? o);
    },
    unregisterOverlay(idOrOverlay) {
      const k = overlays.findIndex((x) => x === idOrOverlay || x.id === idOrOverlay);
      if (k >= 0) overlays.splice(k, 1);
      requestDraw();
    },
    // static map layers (drawn into the cached map; see render/map.js Z for the slots)
    registerStaticLayer,
    unregisterStaticLayer,
    staticLayers: () => [...staticLayers],
    layerZ: LAYER_Z,
    hitLayer: (mx, my) => {
      const h = hitLayer(mx, my);
      return h ? { layer: h.layer.id, item: h.item } : null;
    },
    setHighlight(h) { state.highlight = h || null; requestDraw(); },
    // The search marker (app/highlight.js): app.highlight({x, y} | {line: [[x, y], …]} | {state} | {city}, label?) or null.
    highlight: (h) => (!h ? searchHl.clear() : searchHl.set({
      ...h,
      ...(typeof h.state === "string" ? { state: stateIndex(w, h.state) } : {}),
      ...(typeof h.city === "string" ? { city: cityById.get(h.city) || null } : {}),
    })),
    highlightBounds: (h = state.highlight) => highlightBounds(w, h),
    setResourceFilter(f) { state.resourceFilter = f || null; requestDraw(); },
    setShowResources(on) {
      if (!!on !== state.showResources && w.resources) resBtn?.click();
    },
    // selection, lenses, camera
    selectCity(city, { fly = true } = {}) {
      if (typeof city === "string") city = cityById.get(city) || null;
      return city ? selectCity(city, { fly }) : clearSelection();
    },
    selectState(ref, { fly = true } = {}) {
      const idx = stateIndex(w, ref);
      return idx >= 0 ? selectState(idx, { fly }) : clearSelection();
    },
    clearSelection,
    setLens(ref) {
      const lens = ref == null ? null : typeof ref === "string" ? lensById.get(ref) || null : ref;
      if (lens !== curLens()) setLens(lens);
      // A mode's own lens (an advisor colouring the map) shows on the lens button but does not take a quick slot.
      if (lens && !modes.mode) dock.remember(lens.id);
    },
    setBand,
    // the lens as drawn (after app.setLensView), and re-colouring after the view function's output changed
    shownLens,
    setLensView(fn) { lensView = typeof fn === "function" ? fn : null; app.refreshLens(); },
    refreshLens() {
      if (shownLens() !== lastShown) lensFade(false); // a new year's colours crossfade in
      lastShown = shownLens();
      state.band = null;
      applyLens(w, shownLens(), null);
      dock.render(shownLens(), null);
      rebuildMinimap();
      cache.key = null;
      requestDraw();
    },
    flyTo(x, y, scale = cam.scale, ms = 750) { flyToVisible(x, y, scale, ms); },
    // an extension moved the camera itself (the 3D view handing back its view): count it as the user's move
    markMoved() { moved(); },
    fitBounds,
    home: (ms) => goHome(ms),
    visibleArea: () => visibleArea(),
    isMobile,
    // hit testing (screen css px)
    cellAt,
    hitResource,
    hitCity: (mx, my) => hitCity(mx, my) || null,
    // events
    on: events.on, off: events.off, emit: events.emit,
    // modes + URL
    registerMode: modes.registerMode,
    setMode: modes.setMode,
    hasMode: modes.hasMode,
    hash: { register: url.register, update: url.schedule, soon: url.soon, flush: url.flush, value: url.value },
    // DOM hosts; panels can be replaced by an extension (e.g. the City view)
    ui,
    panels: { city: openCityPanel, state: openStatePanel, close: closeCityPanel, element: panelEl },
    // the built-in modules, for poking at things from the console
    search, share, help, lensDock: dock, reports, pedia, minimap, shareInfo, url, perf, searchMark: searchHl,
    stats() {
      const avg = (a) => (a.length ? a.reduce((p, q) => p + q, 0) / a.length : 0);
      return { staticAvg: avg(perf.static), staticLast: perf.static.at(-1), frameAvg: avg(perf.frame), frameLast: perf.frame.at(-1) };
    },
  });
  Object.defineProperties(app, {
    mode: { get: () => modes.mode, enumerable: true }, // name of the active mode or null
    modeParams: { get: () => modes.modeParams, enumerable: true },
  });
  window.__app = app;
  watchApp(app);

  // --- go --------------------------------------------------------------------------------------------------------
  renderTopbar(nation);
  resize();
  setLens(null);
  dock.render(null, null);
  if (!lensFile.lenses.length) {
    document.getElementById("loading").remove(); // the first frame paints while lenses_index.json downloads
    await lensesReady;
    dock.render(shownLens(), state.band);
  }
  url.applyCurrent(true); // after the home fit, so "at" zoom is relative to it
  document.getElementById("loading")?.remove();
  // Small optional map-layer files load once the first frame is on screen (extensions can await app.loadData).
  // (A timer backs up the frame callback, which never fires while the page is in a background tab.)
  let eagerKicked = false;
  const kickEager = () => { if (!eagerKicked) { eagerKicked = true; EAGER_DATA.forEach((n) => loadData(n)); } };
  requestAnimationFrame(() => setTimeout(kickEager, 0));
  setTimeout(kickEager, 400);
  // Extensions load after the first frame is on its way; a missing extension folder is fine.
  installExtensions(app).then(() => {
    // The camera tour, one tap away: a top-bar button and the first line of the "Map" panel (it also stays in Help).
    if (app.tour?.start) {
      const start = () => app.tour.start();
      const b = ui.addTopButton({ id: "btn-tour", icon: "▶", label: t("Journey"), title: t("Vietnam journey: a 2-minute camera tour, Lũng Cú to Cà Mau"), onClick: start });
      b?.parentNode.insertBefore(b, b.parentNode.firstChild);
      dock.setTour(start);
    }
    // First visit: a welcome card (once per browser; never over a link that carries a view, nor in automated runs).
    if (EMBED) initEmbed(app);
    else if (!deep && !location.hash.length) welcome = maybeWelcome({ tour: app.tour?.start ? () => app.tour.start() : null });
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.add("error");
  el.textContent = t("Could not load the map data ({error}). Run \"uv run python -m pipeline all\" and serve web/ over HTTP.", { error: err.message });
});
