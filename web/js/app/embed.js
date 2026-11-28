// Embed mode (?embed=1, plus the usual hash): the atlas inside another site's <iframe>. This module has no imports
// and main.js imports it first, so it runs before i18n.js or anything else touches storage:
//  * localStorage becomes an in-memory store: an embed neither reads the visitor's saved choices (language, recent
//    themes, Effects) nor saves any (welcome seen, ...) that would carry over into a normal visit;
//  * a link's tour=1 is dropped (an embed never starts the camera tour by itself).
// The strip, the maker badge and "click to interact" are app/embedui.js; the iframe code is embedSnippet() below.
const query = typeof location === "object" ? new URLSearchParams(location.search) : new URLSearchParams();
export const EMBED = query.get("embed") === "1";
export const EMBED_SEARCH = EMBED && query.get("search") === "1";

if (EMBED) {
  const mem = new Map();
  const store = {
    getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
    setItem: (k, v) => void mem.set(String(k), String(v)),
    removeItem: (k) => void mem.delete(String(k)),
    clear: () => mem.clear(),
    key: (i) => [...mem.keys()][i] ?? null,
    get length() { return mem.size; },
  };
  try { Object.defineProperty(window, "localStorage", { value: store, configurable: true }); } catch { /* left as is */ }
  document.documentElement.classList.add("embed");
  if (EMBED_SEARCH) document.documentElement.classList.add("embed-search");
  const h = location.hash.replace(/([#&])tour=[^&]*&?/, "$1").replace(/[#&]$/, "");
  if (h !== location.hash) {
    try { history.replaceState(null, "", location.pathname + location.search + h); } catch { /* sandboxed */ }
  }
}

/** The published site; embed code and "open on the site" links point here. */
export const SITE = "https://atlasvn.online/";
/** Size presets: [width, height] attributes (the code scales them to the column's width, keeping the ratio). */
export const PRESETS = { "16:9": [640, 360], "4:3": [640, 480], "1:1": [560, 560] };

/** SITE, or this server on a local copy (so a dev build's links and previews stay local). */
export function siteBase(loc = location) {
  const local = !/^https?:$/.test(loc.protocol) || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(loc.hostname);
  return local ? loc.origin + loc.pathname.replace(/index\.html?$/, "") : SITE;
}

const attr = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** The view's embed URL and full-site URL: base + "?embed=1[&search=1][&lang=en]" + hash. */
export function embedUrls({ base = SITE, hash = "", lang = "vi", search = false } = {}) {
  const h = hash && hash !== "#" ? (hash[0] === "#" ? hash : "#" + hash) : "";
  const en = lang === "en" ? "lang=en" : "";
  return {
    src: `${base}?embed=1${search ? "&search=1" : ""}${en ? "&" + en : ""}${h}`,
    link: `${base}${en ? "?" + en : ""}${h}`,
  };
}

/**
 * The code to paste into a page: a responsive <iframe> (full column width, the preset's ratio; width / height
 * attributes for old browsers), title and loading="lazy", then an attribution link to the same view on the site.
 * opts: {base, hash, lang, search, preset: "16:9" | "4:3" | "1:1", title, credit}
 */
export function embedSnippet(opts = {}) {
  const [w, h] = PRESETS[opts.preset] || PRESETS["16:9"];
  const { src, link } = embedUrls(opts);
  return `<iframe src="${attr(src)}" title="${attr(opts.title || "")}" width="${w}" height="${h}" ` +
    `style="width:100%;height:auto;aspect-ratio:${w}/${h};border:0" loading="lazy"></iframe>\n` +
    `<p><a href="${attr(link)}">${attr(opts.credit || "")}</a></p>`;
}
