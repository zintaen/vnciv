// Real photos in the place card (ext/hexlife's card): 1–4 freely licensed photos from Wikimedia Commons, fetched by the
// browser only when a card opens, cached per cell (or per named place). Order of preference: the place's Wikidata
// image (P18), files found by the place's name near the point (CirrusSearch nearcoord), geotagged files nearest the
// point. Each photo shows its author and licence and links to its file page. Offline or no result: one muted line.
import { t } from "../../i18n.js";
import { esc } from "../../format.js";
import { mapToLonLat } from "../daynight/sun.js";
import { parsePhotos, mergePhotos } from "./geom.js";

const API = "https://commons.wikimedia.org/w/api.php";
const WIDTH = 320;
const COMMON = { action: "query", format: "json", formatversion: "2", origin: "*", prop: "imageinfo",
  iiprop: "url|mime|extmetadata", iiurlwidth: String(WIDTH), iiextmetadatafilter: "LicenseShortName|Artist" };

const url = (base, params) => `${base}?${new URLSearchParams(params)}`;
async function getJSON(u, signal) {
  const r = await fetch(u, { signal, credentials: "omit" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

const net = (p) => Object.assign(p, { net: true }); // a job that really asked the network

/** Photos for a point (map units) and an optional name / Wikidata id: [{title, thumb, page, author, license}]. */
export async function fetchPhotos({ x, y, name, wd, radiusM }, signal) {
  const [lon, lat] = mapToLonLat(x, y);
  const ll = `${lat.toFixed(5)}|${lon.toFixed(5)}`;
  const jobs = [];
  if (wd && /^Q\d+$/.test(wd)) {
    jobs.push(net(getJSON(url("https://www.wikidata.org/w/api.php", { action: "wbgetclaims", entity: wd, property: "P18", format: "json", origin: "*" }), signal)
      .then((j) => {
        const file = j?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
        return file ? getJSON(url(API, { ...COMMON, titles: `File:${file}` }), signal).then(parsePhotos) : [];
      })));
  } else jobs.push(Promise.resolve([]));
  if (name) {
    const q = `${name.replace(/["\\]/g, " ")} filetype:bitmap nearcoord:${Math.round((radiusM || 5000) / 1000) + 5}km,${lat.toFixed(4)},${lon.toFixed(4)}`;
    jobs.push(net(getJSON(url(API, { ...COMMON, generator: "search", gsrsearch: q, gsrnamespace: "6", gsrlimit: "16" }), signal).then(parsePhotos)));
  } else jobs.push(Promise.resolve([]));
  jobs.push(net(getJSON(url(API, { ...COMMON, generator: "geosearch", ggscoord: ll, ggsradius: String(Math.min(10000, radiusM || 5000)),
    ggsnamespace: "6", ggslimit: "30" }), signal).then(parsePhotos)));
  const res = await Promise.allSettled(jobs);
  const failed = res.find((r) => r.status === "rejected");
  if (failed && !res.some((r, k) => r.status === "fulfilled" && jobs[k].net)) throw failed.reason; // no request got through
  return mergePhotos(res.map((r) => (r.status === "fulfilled" ? r.value : [])), 4);
}

export function installPhotos(app) {
  const grid = app.w.grid;
  const cache = new Map(); // key → Promise<photos>
  let pending = null; // {cell, name, wd, x, y} for the next card (a search pick or a site click)
  let ctl = null;

  function keyOf(p) { return p.name ? `n:${p.name}|${p.cell}` : `c:${p.cell}`; }
  function load(p) {
    const k = keyOf(p);
    if (!cache.has(k)) {
      const pr = fetchPhotos(p).catch((err) => { cache.delete(k); throw err; }); // a failure (offline) may be retried
      cache.set(k, pr);
    }
    return cache.get(k);
  }

  function strip(photos) {
    return `<div class="xp-ph-row">${photos.map((p) => `<a class="xp-ph" href="${esc(p.page)}" target="_blank" rel="noopener" title="${esc(p.title.replace(/^File:/, ""))}">
      <img src="${esc(p.thumb)}" alt="${esc(p.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""))}" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`).join("")}</div>
      <ol class="xp-ph-cred">${photos.map((p, i) => `<li><a href="${esc(p.page)}" target="_blank" rel="noopener">${i + 1}. ${esc(p.author || t("Unknown author"))}</a>, ${esc(p.license)}</li>`).join("")}</ol>
      <div class="xp-ph-src">${esc(t("Photos: Wikimedia Commons (free licences); not checked by the atlas."))}</div>`;
  }

  app.on("hexcard", ({ cell, el }) => {
    if (!el) return;
    ctl?.abort();
    const p = pending && pending.cell === cell ? pending : { cell, x: grid.cx(cell), y: grid.cy(cell), radiusM: 5000 };
    pending = null;
    const box = document.createElement("div");
    box.className = "xp-photos";
    box.setAttribute("aria-live", "polite");
    box.innerHTML = `<div class="xp-ph-head">${esc(p.name ? t("Photos of {name}", { name: p.name }) : t("Photos near here"))}</div><div class="xp-ph-msg">${esc(t("Loading photos…"))}</div>`;
    const note = el.querySelector(".hl-note");
    if (note) note.before(box); else el.appendChild(box);
    app.hexlife?.place?.();
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      box.querySelector(".xp-ph-msg").textContent = t("Photos need an internet connection.");
      return;
    }
    const mine = (ctl = new AbortController());
    load(p).then((photos) => {
      if (mine.signal.aborted || !box.isConnected) return;
      if (!photos.length) box.querySelector(".xp-ph-msg").textContent = t("No freely licensed photos found near here.");
      else box.innerHTML = `<div class="xp-ph-head">${box.querySelector(".xp-ph-head").innerHTML}</div>${strip(photos)}`;
      app.hexlife?.place?.();
    }, () => {
      if (mine.signal.aborted || !box.isConnected) return;
      box.querySelector(".xp-ph-msg").textContent = t("Photos could not be loaded (offline or Wikimedia Commons is unreachable).");
      app.hexlife?.place?.();
    });
  });

  /** Open the card for a named place at map point (x, y). */
  function showPlace({ x, y, name, wd }) {
    if (!app.hexlife?.open || !Number.isFinite(x) || !Number.isFinite(y)) return;
    let cell = grid.cellAt(x, y);
    if (!(cell >= 0 && cell < grid.size)) return;
    pending = { cell, x, y, name: name || null, wd: wd || null, radiusM: 3000 };
    app.hexlife.open(cell);
  }

  // Search picks: the marker main.js sets for a point or a city (not provinces, rivers or roads) opens the card.
  // Only right after a choice in the search box (stories and other code call app.highlight too).
  const mark = app.searchMark;
  let pickAt = -1e9;
  const picked = () => { pickAt = performance.now(); };
  document.getElementById("search-results")?.addEventListener("click", picked, true);
  document.getElementById("search-input")?.addEventListener("keydown", (e) => { if (e.key === "Enter") picked(); }, true);
  if (mark?.set) {
    const set0 = mark.set.bind(mark);
    mark.set = (spec) => {
      const ok = set0(spec);
      try {
        if (ok && spec && !spec.line && spec.state == null && performance.now() - pickAt < 1500) {
          const h = mark.current;
          if (h && Number.isFinite(h.x)) showPlace({ x: h.x, y: h.y, name: spec.city?.name || h.label || "" });
        }
      } catch (err) { console.warn("explore: photo card", err); }
      return ok;
    };
  }

  // Site clicks (everyday places, geography layers, wonders): the layer's own click still runs; the card follows.
  const siteOf = (l, it) => {
    if (!it) return null;
    const x = it.x ?? it.r?.x ?? it.data?.x, y = it.y ?? it.r?.y ?? it.data?.y;
    const name = (Array.isArray(it.row) ? it.row[2] : null) || it.r?.n || it.data?.name || null;
    const wd = it.r?.wd || it.data?.wikidata || null;
    return Number.isFinite(x) && Number.isFinite(y) && name ? { x, y, name, wd } : null;
  };
  const wrap = () => {
    for (const l of app.staticLayers()) {
      if (typeof l.click !== "function" || l.__xpWrapped) continue;
      if (!/^(poi-|wonders|peaks|passes|lakes|dams|gates|crafts|battles|festivals|parks)/.test(l.id)) continue;
      const c0 = l.click;
      l.click = function (item, ev) {
        const r = c0.call(this, item, ev);
        if (r === true && !app.mode) { const s = siteOf(l, item); if (s) setTimeout(() => showPlace(s), 0); }
        return r;
      };
      l.__xpWrapped = true;
    }
  };
  wrap();
  app.on("extensions", wrap);
  return { showPlace, cache, fetchPhotos };
}

export const PHOTO_CSS = `
.xp-photos { margin: 6px 0 4px; }
.xp-ph-head { color: var(--ink-dim); font-size: 11px; margin-bottom: 3px; }
.xp-ph-msg { color: var(--ink-dim); font-size: 11px; font-style: italic; }
.xp-ph-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px; }
.xp-ph { display: block; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 3px; background: rgba(255,255,255,.06); }
.xp-ph img { width: 100%; height: 100%; object-fit: cover; display: block; }
.xp-ph:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 1px; }
.xp-ph-cred { margin: 3px 0 0; padding: 0; list-style: none; font-size: 10px; line-height: 1.35; color: var(--ink-dim); max-height: 5.6em; overflow: auto; }
.xp-ph-cred a { color: var(--ink-dim); }
.xp-ph-cred a:hover, .xp-ph-cred a:focus-visible { color: var(--gold-bright); }
.xp-ph-src { font-size: 10px; color: var(--ink-dim); margin-top: 2px; }
@media (max-width: 700px) { .xp-ph-row { grid-template-columns: repeat(4, 1fr); } .xp-ph-cred { max-height: 3.2em; } .xp-ph-src { display: none; } }`;
