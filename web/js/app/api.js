// Building blocks of the extension API (the `app` object that main.js creates and hands to ext/*/install(app)).
//
//   createEmitter()            app.on / app.off / app.emit
//   createHashState(opts)      the shareable URL hash: core keys (lens, city, state, at; see app/urlstate.js) plus
//                              keys that extensions register with app.hash.register(key, {get, set})
//   createModes(app)           app.registerMode / app.setMode (one active mode; Esc leaves it)
//   createUi(app, opts)        app.ui.dock / undock / addTopButton / toast
//   createMapToggles(opts)     app.ui.addMapToggle / mapToggles: switches for map layers, kept in the hash (layers=)
//
// main.js assembles the full `app` (see its "extension API" section); the exact surface is documented there.
import { parseHash, formatHash } from "./urlstate.js";
import { icon } from "../ui/icon.js";
import { hasIcon } from "../icons.js";
import { esc } from "../format.js";
import { t as tr } from "../i18n.js";

// --- events ------------------------------------------------------------------------------------------------------

/**
 * on(name, fn) → off function; off(name, fn); emit(name, payload) → true if a handler returned true.
 * Handlers run in registration order; the first one that returns true "consumes" the event and stops the rest
 * (used by "mapclick" and "escape"; other events ignore the return value but stop the same way).
 */
export function createEmitter() {
  const handlers = new Map();
  const on = (name, fn) => {
    if (!handlers.has(name)) handlers.set(name, []);
    handlers.get(name).push(fn);
    return () => off(name, fn);
  };
  const off = (name, fn) => {
    const list = handlers.get(name);
    if (!list) return;
    const k = list.indexOf(fn);
    if (k >= 0) list.splice(k, 1);
  };
  const emit = (name, payload) => {
    const list = handlers.get(name);
    if (!list || !list.length) return false;
    for (const fn of [...list]) {
      try {
        if (fn(payload) === true) return true;
      } catch (err) {
        console.error(`app "${name}" handler failed`, err);
      }
    }
    return false;
  };
  const has = (name) => !!handlers.get(name)?.length;
  return { on, off, emit, has };
}

// --- URL hash ----------------------------------------------------------------------------------------------------

const CORE_KEYS = new Set(["lens", "city", "state", "at"]);
const DEBOUNCE_MS = 350;

/**
 * Shareable URL state:  #lens=income&city=35620&at=x,y,zoom&<extension keys>
 * Lens, selection and extension-key changes push a history entry (so Back undoes them); camera moves replace it.
 *
 * opts: {read() → {lens, city, state, at}, apply(core, {initial}), busy() → true while the camera animates,
 *        replaceOnly (every write replaces the current entry: embed mode)}
 * Returns {schedule(), soon(), flush(), applyCurrent(initial), register(key, {get, set}) → unregister, value(key)}.
 *   value(key) → the key in the link the page was opened / navigated with (null if absent).
 *   get() → string | null   the key's current value (null = leave it out of the hash)
 *   set(value | null)       apply a value from the URL (on load, Back/Forward, a pasted link); null = absent.
 *   A key registered after the page loaded gets set(value) once, right away (in a microtask), if the current
 *   hash has it.
 */
export function createHashState(opts) {
  const extras = new Map(); // key -> {get, set}
  let timer = 0;
  let lastWritten = location.hash;
  let linkHash = location.hash; // the hash the page was opened or navigated with (not one write() made)
  let applying = false;

  const params = (hash) => new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const readExtras = () => {
    const out = [];
    for (const [key, h] of extras) {
      let v = null;
      try {
        v = h.get();
      } catch (err) {
        console.error(`hash key "${key}" get() failed`, err);
      }
      if (v != null && v !== "") out.push([key, String(v)]);
    }
    return out;
  };
  const format = (core, ex) => {
    const base = formatHash(core);
    const tail = ex.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    if (!tail) return base;
    return base ? `${base}&${tail}` : `#${tail}`;
  };
  const sig = (core, ex) => `${core.lens || ""}|${core.city || ""}|${core.state || ""}|${ex.map((e) => e.join("=")).join("&")}`;
  const hashSig = (hash) => {
    const p = params(hash);
    const ex = [...extras.keys()].filter((k) => p.get(k)).map((k) => [k, p.get(k)]);
    return sig(parseHash(hash), ex);
  };
  let entrySig = hashSig(location.hash);
  // The signature of what the app shows after applying a link: an invalid value it dropped or corrected
  // (#lens=bogus, #advisor=nope) then rewrites the same history entry instead of pushing a new one.
  const stateSig = () => sig(opts.read(), readExtras());

  function write(force = false) {
    timer = 0;
    if (applying) return;
    if (!force && opts.busy?.()) return schedule(); // wait for the camera to settle
    const core = opts.read();
    const ex = readExtras();
    // Keys no extension has registered yet (one still loading on a slow network) stay in the link as they are, so
    // a shared #…&year=2019&view=city is not stripped before the timeline / City view can apply it.
    const waiting = [...params(location.hash)].filter(([k, v]) => v && !CORE_KEYS.has(k) && !extras.has(k));
    const hash = format(core, [...ex, ...waiting]);
    if (hash === location.hash || (!hash && !location.hash)) {
      lastWritten = location.hash;
      return;
    }
    const url = location.pathname + location.search + (hash || "");
    const s = sig(core, ex);
    try {
      if (replaceNext && s === undoSig) {
        // A replaced run (a timeline play from "now" back to "now") ended where it started: drop its entry, so one
        // Back is not a step that changes nothing.
        undoSig = null;
        lastWritten = hash; // the entry Back lands on (its popstate then applies nothing new)
        history.back();
        entrySig = s;
        replaceNext = false;
        return;
      } else if (s !== entrySig && !replaceNext && !opts.replaceOnly) { // replaceOnly: embed mode, the host page's Back stays its own
        undoSig = entrySig;
        history.pushState(null, "", url);
      } else history.replaceState(null, "", url);
    } catch {
      /* some sandboxes forbid history writes: the app still works, the link just doesn't update */
    }
    entrySig = s;
    replaceNext = false;
    lastWritten = location.hash;
  }

  // schedule(true): the next write replaces the current entry even if the state changed (a timeline play's
  // later years: Back undoes the whole play, not one year at a time).
  let replaceNext = false;
  let undoSig = null; // the state under the last pushed entry
  function schedule(replace = false) {
    if (replace === true) replaceNext = true;
    clearTimeout(timer);
    timer = setTimeout(() => write(), DEBOUNCE_MS);
  }

  function setExtra(key, h, value) {
    try {
      h.set(value);
    } catch (err) {
      console.error(`hash key "${key}" set() failed`, err);
    }
  }

  function applyCurrent(initial = false) {
    const p = params(location.hash);
    applying = true;
    try {
      opts.apply(parseHash(location.hash), { initial });
      for (const [key, h] of extras) setExtra(key, h, p.get(key));
    } finally {
      applying = false;
    }
    entrySig = stateSig();
    lastWritten = location.hash;
    undoSig = null;
  }

  const onNav = () => {
    if (location.hash === lastWritten) return;
    linkHash = location.hash;
    clearTimeout(timer);
    applyCurrent(false);
  };
  window.addEventListener("popstate", onNav);
  window.addEventListener("hashchange", onNav);

  function register(key, h) {
    if (CORE_KEYS.has(key)) throw new Error(`hash key "${key}" is reserved`);
    if (!h || typeof h.get !== "function" || typeof h.set !== "function") throw new Error("hash.register needs {get, set}");
    extras.set(key, h);
    const v = params(location.hash).get(key);
    if (v != null) {
      queueMicrotask(() => {
        if (extras.get(key) !== h) return;
        applying = true;
        try {
          setExtra(key, h, v);
        } finally {
          applying = false;
        }
        entrySig = stateSig();
      });
    }
    return () => {
      if (extras.get(key) === h) extras.delete(key);
    };
  }

  return {
    schedule,
    /** Write on the next task (coalesces several changes made in one go, e.g. setMode(null) then setMode(x)). */
    soon() {
      clearTimeout(timer);
      timer = setTimeout(() => write(), 0);
    },
    applyCurrent,
    register,
    flush() {
      clearTimeout(timer);
      write(true);
    },
    /** The key's value in the link the page was opened or navigated with (string or null): what a set() is applying.
     *  Not the current hash, which may already hold the app's own debounced write (e.g. at= of the selection's flight). */
    value: (key) => params(linkHash).get(key),
  };
}

// --- modes -------------------------------------------------------------------------------------------------------

/**
 * Modes: named, mutually exclusive app states owned by extensions (e.g. "city" for the City view).
 *   registerMode(name, {enter(params), exit(), onEscape?()}) → unregister
 *   setMode(name | null, params = {})   exits the active mode (exit()), enters the new one (enter(params)),
 *                                       emits "mode" {name, prev, params} and schedules a URL update.
 *   Esc: the active mode's onEscape() runs first; unless it returns true, the mode is left (setMode(null)).
 */
export function createModes(app) {
  const modes = new Map();
  let current = null, params = null;
  function registerMode(name, def) {
    if (!name || !def || typeof def.enter !== "function") throw new Error("registerMode(name, {enter, exit})");
    modes.set(name, def);
    return () => {
      if (current === name) setMode(null);
      modes.delete(name);
    };
  }
  function setMode(name, p = {}) {
    if (name != null && !modes.has(name)) {
      console.warn(`unknown mode "${name}"`);
      return false;
    }
    const prev = current;
    if (prev) {
      try {
        modes.get(prev)?.exit?.();
      } catch (err) {
        console.error(`mode "${prev}" exit() failed`, err);
      }
    }
    current = name ?? null;
    params = name ? p || {} : null;
    if (current) {
      try {
        modes.get(current).enter(params);
      } catch (err) {
        console.error(`mode "${current}" enter() failed`, err);
      }
    }
    app.emit("mode", { name: current, prev, params });
    // Write the link now rather than after the debounce, so a copied URL already names the new mode.
    (app.hash?.soon || app.hash?.update)?.();
    app.requestDraw?.();
    return true;
  }
  /** Esc handling for main.js: true if the active mode handled the key. */
  function escape() {
    if (!current) return false;
    const def = modes.get(current);
    let keep = false;
    try {
      keep = def?.onEscape?.() === true;
    } catch (err) {
      console.error(`mode "${current}" onEscape() failed`, err);
    }
    if (!keep) setMode(null);
    return true;
  }
  return {
    registerMode,
    setMode,
    escape,
    get mode() { return current; },
    get modeParams() { return params; },
    hasMode: (name) => modes.has(name),
  };
}

// --- UI hosts ----------------------------------------------------------------------------------------------------

/**
 * app.ui:
 *   dock(side = "left" | "right", {width = 380, label}) → HTMLElement
 *     A docked dashboard container below the top bar (a bottom sheet on phones). One per side: calling it again
 *     returns the same element (re-shown, with the new width). While a dock is visible the map's usable area
 *     shrinks: app.visibleArea(), app.flyTo() and app.fitBounds() frame inside what is left, and the city panel,
 *     lens dock and minimap move aside. The element is empty; fill it yourself (it scrolls vertically).
 *     When a dock opens or closes and nothing is flying the camera, main.js re-frames: from the home view it fits
 *     the whole land into the remaining area (and returns home when the last dock closes); otherwise it keeps the
 *     point at the centre of the usable area centred. Call app.fitBounds()/app.flyTo() right after dock() to
 *     frame your own view instead.
 *   undock(side)            hide and empty that dock
 *   dockWidth(side) → px    its current width (0 when hidden)
 *   addTopButton({id, icon, label, onClick, title, menu}) → HTMLButtonElement
 *     A top-bar button before the "More ▾" menu, Help / Almanac. `icon` is an icons.js id (or a short text / emoji);
 *     the label hides on narrow screens like the other buttons'. Calling it again with the same id replaces it.
 *     `menu: true` puts it in the "More ▾" menu instead (role=menuitem, before Share); its id, click() and focus()
 *     keep working (focus() on a closed menu's item lands on the More button). aria-pressed on a menu item is shown
 *     as menuitemcheckbox / aria-checked.
 *   toast(msg)              a short message under the top bar
 */
export function createUi(app, { toast, onLayout }) {
  const docks = { left: null, right: null };
  const widths = { left: 0, right: 0 };
  const isPhone = () => matchMedia("(max-width: 700px)").matches;

  const open = { left: false, right: false };
  function layout() {
    let changed = false;
    for (const side of ["left", "right"]) {
      const el = docks[side];
      const isOpen = !!(el && !el.hidden);
      const wpx = isOpen && !isPhone() ? Math.round(el.getBoundingClientRect().width) : 0;
      // Phones report width 0 (docks are bottom sheets), so opening / closing counts as a change too.
      if (wpx !== widths[side] || isOpen !== open[side]) changed = true;
      widths[side] = wpx;
      open[side] = isOpen;
      document.body.style.setProperty(`--dock-${side}`, `${wpx}px`);
    }
    document.body.classList.toggle("dock-open", !!(docks.left && !docks.left.hidden) || !!(docks.right && !docks.right.hidden));
    if (changed) onLayout?.();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;

  function dock(side = "left", { width = 380, label = "" } = {}) {
    if (side !== "left" && side !== "right") throw new Error('dock side must be "left" or "right"');
    let el = docks[side];
    if (!el) {
      el = document.createElement("aside");
      el.className = `panel app-dock app-dock-${side}`;
      el.dataset.side = side;
      el.setAttribute("role", "region");
      document.body.appendChild(el);
      docks[side] = el;
      ro?.observe(el);
    }
    if (label) el.setAttribute("aria-label", label);
    el.style.setProperty("--dock-w", `${Math.max(200, Math.round(width))}px`);
    el.hidden = false;
    layout();
    return el;
  }

  function undock(side) {
    const el = docks[side];
    if (!el || el.hidden) return;
    el.hidden = true;
    el.innerHTML = "";
    layout();
  }

  function addTopButton({ id, icon: ic, label = "", onClick, title = "", menu = false } = {}) {
    const host = document.querySelector("#topbar .tb-more");
    const list = menu ? document.getElementById("tb-menu-list") : null;
    if (!host || (menu && !list)) return null;
    if (id) document.getElementById(id)?.remove();
    const b = document.createElement("button");
    if (id) b.id = id;
    b.type = "button";
    b.className = "btn btn-ext" + (label ? "" : " btn-icon");
    if (title) b.title = title;
    b.setAttribute("aria-label", title || label || id || "button");
    const glyph = ic ? (hasIcon(ic) ? icon(ic, "•", { size: 15 }) : `<span class="emoji" aria-hidden="true">${esc(ic)}</span>`) : "";
    b.innerHTML = `${glyph}${label ? `<span class="lbl">${esc(label)}</span>` : ""}`;
    if (onClick) b.addEventListener("click", (e) => onClick(e, b));
    if (menu) {
      // Menu items go before Share, in the order they were added.
      b.setAttribute("role", "menuitem");
      list.insertBefore(b, list.querySelector("#btn-share"));
      topMenu?.adopt(b);
    } else {
      // Extension buttons go before the More menu (and the Author mark), in the order they were added.
      host.insertBefore(b, host.querySelector(".tb-menu") || host.firstChild);
    }
    document.body.classList.add("tb-ext");
    return b;
  }
  const topMenu = wireTopMenu();

  addEventListener("resize", layout);
  return {
    dock,
    undock,
    dockWidth: (side) => widths[side] || 0,
    isDockOpen: (side) => !!(docks[side] && !docks[side].hidden),
    addTopButton,
    toast,
    _layout: layout,
  };
}

/**
 * The top bar's "More ▾" (Thêm ▾) menu button (index.html #btn-more / #tb-menu-list): a WAI-ARIA menu button.
 * Enter / Space / ↓ open it on the first item, ↑ on the last; ↑ ↓ Home End move; Esc closes it and returns focus
 * to the button; Tab or a click outside closes it. Picking an item closes the menu and focuses the button before the
 * item's own click handler runs, so a dialog it opens returns focus to the button.
 */
function wireTopMenu() {
  const btn = document.getElementById("btn-more"), list = document.getElementById("tb-menu-list");
  if (!btn || !list) return null;
  const wrap = btn.parentElement;
  // The list lives on <body>: inside the top bar (z-index 10) a city panel or dock (z-index 12) would cover it.
  document.body.appendChild(list);
  btn.innerHTML = `<span class="tbm-lbl">${esc(tr("More"))}</span><span class="tbm-caret" aria-hidden="true">▾</span>`;
  btn.title = tr("More: advisors, 3D view, share");
  const items = () => [...list.children].filter((b) => !b.hidden && /^menuitem/.test(b.getAttribute("role") || ""));
  const isOpen = () => !list.hidden;
  function position() {
    const r = btn.getBoundingClientRect();
    list.style.top = `${Math.round(r.bottom + 6)}px`;
    list.style.left = `${Math.round(Math.max(8, Math.min(innerWidth - list.offsetWidth - 8, r.right - list.offsetWidth)))}px`;
  }
  function open(at = 0) {
    // Phones: the bar scrolls under the pinned Language / Help / Almanac group; bring the button out from under it.
    const pin = document.querySelector("#topbar .tb-buttons")?.getBoundingClientRect(), r = btn.getBoundingClientRect();
    if (pin && pin.left > r.left && r.right > pin.left - 8) btn.closest("#topbar").scrollLeft += r.right - pin.left + 8;
    list.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    position();
    const it = items();
    if (it.length && at != null) it[at < 0 ? it.length - 1 : 0].focus();
  }
  function close(focusBtn = true) {
    if (!isOpen()) return;
    list.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (focusBtn) btn.focus();
  }
  // A keyboard click (detail 0) opens on the first item; a mouse / touch click just opens.
  btn.addEventListener("click", (e) => (isOpen() ? close() : open(e.detail === 0 ? 0 : null)));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(e.key === "ArrowUp" ? -1 : 0); }
  });
  list.addEventListener("keydown", (e) => {
    const it = items(), k = it.indexOf(document.activeElement);
    const go = (i) => { e.preventDefault(); it[(i + it.length) % it.length]?.focus(); };
    if (e.key === "ArrowDown") go(k + 1);
    else if (e.key === "ArrowUp") go(k - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(-1);
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "Tab") { e.preventDefault(); close(); }
  });
  list.addEventListener("click", (e) => { if (e.target.closest?.("[role^=menuitem]")) close(); }, true);
  document.addEventListener("pointerdown", (e) => { if (isOpen() && !wrap.contains(e.target) && !list.contains(e.target)) close(false); }, true);
  addEventListener("resize", () => close(false));
  // aria-pressed is not allowed on a menuitem: show a pressed item as a checked menuitemcheckbox instead.
  const pressed = (b) => {
    const v = b.getAttribute("aria-pressed");
    if (v == null) return;
    b.removeAttribute("aria-pressed");
    b.setAttribute("role", "menuitemcheckbox");
    b.setAttribute("aria-checked", v === "true" ? "true" : "false");
  };
  if (typeof MutationObserver === "function") {
    new MutationObserver((ms) => ms.forEach((m) => m.target.parentElement === list && pressed(m.target)))
      .observe(list, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
  }
  // Code that focuses an item of the closed menu (a dialog returning focus) lands on the More button.
  function adopt(b) {
    b.tabIndex = -1;
    b.focus = (o) => (isOpen() ? HTMLElement.prototype.focus.call(b, o) : btn.focus(o));
    pressed(b);
  }
  [...list.children].forEach(adopt);
  return { adopt, open, close, get isOpen() { return isOpen(); } };
}

// --- map layer toggles -------------------------------------------------------------------------------------------

/**
 * app.ui.addMapToggle({id, label, icon, get() → bool, set(on), title?, default?, group?, groupLabel?}) → remove function
 *   A switch for a map layer, listed under "Show on the map" in the "Map" panel (the one dock button that also picks
 *   the colouring theme, ui/lenses.js), so any number of layers fits on a phone. `icon` is an icons.js id or a short
 *   text / emoji. `group` puts it under a section header (GROUPS below, in that order; an unknown id gets its own
 *   section after them, headed by `groupLabel` (already translated) or t(group); toggles without a group go last).
 *   `set(on)` is yours: flip your layer's state (its visible()/sig() then change and the static map
 *   re-renders; main also calls app.requestDraw()). `default` is the state when the URL says nothing (defaults to
 *   get() at the time of adding).
 *   The URL hash key `layers` lists the toggles that are on (`#layers=roads,rail,military`; `layers=none` = all
 *   off) and is written only while some toggle differs from its default; a toggle added after the page loaded is
 *   set from the current hash right away. Calling it again with the same id replaces the toggle.
 *   `hash: false`: a preference, not a layer (the Effects switch): never in the hash, not counted on the button.
 * app.ui.setMapToggle(id, on) → bool       switch one from code, as the panel would (false if no such toggle)
 * app.ui.mapToggles() → [{id, label, on}]   for debugging and tests
 * app.ui.mapPreset() → "clean" | "lively" | "everything" | null    the preset the switches match (PRESETS below)
 *
 * opts: {hash: {register, update, value}, onChange()}. The returned object also has sections() (what the panel
 * draws: [{id, label, items: [{id, label, icon, title, on, hash}]}]), flip(id), applyPreset(id), preset() and onList(fn)
 * (the list or a state changed: the panel re-renders).
 */
// Sections of "Show on the map", in display order: id → header label (English, translated with t()).
export const GROUPS = { display: "Display", transport: "Transport", energy: "Energy", geography: "Geography", nature: "Nature", culture: "Culture",
  history: "History", living: "Living", economy: "Economy", weather: "Weather", places: "Place names", military: "Military" };

// Presets at the top of "Show on the map" (Anh, 2026-11-28): each lists the layers it turns on; every other layer goes
// off, except military, which a preset never touches, and the Effects preference. Lively is the default set (no layers=
// in the URL). Preferences such as Living tiles (hash: false) follow a preset but are not compared to tell which one is
// on, so a reloaded Clean link (Living tiles back on) still shows Clean.
export const PRESET_KEEP = ["military", "motion"];
const LIVELY = ["roads", "rail", "hubs", "rivers", "wonders", "places", "traffic", "ambient", "hexlife", "trees", "homes", "seasons", "boats", "tet", "daynight"];
export const PRESETS = [
  { id: "clean", label: "Clean", on: ["roads", "rail", "rivers", "places"] },
  { id: "lively", label: "Lively", on: LIVELY },
  { id: "everything", label: "Everything", on: [...LIVELY, "peaks", "passes", "lakes", "gates", "parks", "crafts", "festivals", "battles", "relics",
    "worship", "hospitals", "universities", "markets", "beaches", "reserves", "metro", "bridges", "communes"] },
];

export function createMapToggles({ hash, onChange }) {
  const toggles = new Map(); // id → {id, label, icon, title, group, groupLabel, get, set, def}
  const listeners = new Set();
  // The ids the URL asked for (a Set), or null when the URL has no layers= key. Ids of toggles that are not
  // registered yet (an extension still loading) stay in the hash until their toggle arrives.
  let wanted = null;

  const isOn = (t) => {
    try { return !!t.get(); } catch (err) { console.error(`map toggle "${t.id}" get() failed`, err); return false; }
  };
  const setOn = (t, on) => {
    if (isOn(t) === !!on) return;
    try { t.set(!!on); } catch (err) { console.error(`map toggle "${t.id}" set() failed`, err); }
  };
  const render = () => listeners.forEach((fn) => { try { fn(); } catch (err) { console.error("map toggles listener failed", err); } });

  // URL: layers=a,b (the ones on) while anything differs from its default; "none" = every toggle off.
  const pending = () => (wanted ? [...wanted].filter((id) => id !== "none" && !toggles.has(id)) : []);
  const hashed = () => [...toggles.values()].filter((t) => t.hash); // (hash: false = a preference, e.g. Effects)
  function hashGet() {
    const list = hashed();
    const waiting = pending();
    if (!waiting.length && list.every((t) => isOn(t) === t.def)) return wanted && !list.length ? [...wanted].join(",") : null;
    const on = [...list.filter(isOn).map((t) => t.id), ...waiting];
    return on.length ? on.join(",") : "none";
  }
  const parse = (v) => new Set(String(v).split(",").map((s) => s.trim()).filter(Boolean));
  function hashSet(v) {
    const set = v == null ? null : parse(v);
    wanted = set && set.size ? set : null; // an empty layers= is the defaults; only "none" turns every layer off
    for (const t of hashed()) setOn(t, wanted ? wanted.has(t.id) : t.def);
    render();
    onChange?.();
  }
  // After a change in the panel the URL follows the switches (plus ids still waiting for their toggle).
  const syncWanted = () => {
    if (wanted) wanted = new Set([...hashed().filter(isOn).map((t) => t.id), ...pending()]);
  };
  hash.register("layers", { get: hashGet, set: hashSet });

  function sections() {
    const list = [...toggles.values()];
    const order = Object.keys(GROUPS);
    const rank = (g) => (!g ? Infinity : order.includes(g) ? order.indexOf(g) : order.length);
    const groups = [...new Set(list.map((t) => t.group))].sort((a, b) => rank(a) - rank(b));
    return groups.map((g) => {
      const items = list.filter((t) => t.group === g);
      const label = !g ? "" : GROUPS[g] ? tr(GROUPS[g]) : items.find((t) => t.groupLabel)?.groupLabel || tr(g);
      return { id: g, label, items: items.map((t) => ({ id: t.id, label: t.label, icon: t.icon, title: t.title, on: isOn(t), hash: t.hash })) };
    });
  }

  function add({ id, label, icon: ic = "", get, set, title = "", default: def, group = "", groupLabel = "", hash: inHash = true } = {}) {
    if (!id || typeof get !== "function" || typeof set !== "function") throw new Error("addMapToggle({id, label, icon, get, set})");
    const t = { id: String(id), label: label || String(id), icon: ic, title, group: group ? String(group) : "", groupLabel: groupLabel ? String(groupLabel) : "",
      get, set, def: false, hash: inHash !== false };
    t.def = def === undefined ? isOn(t) : !!def;
    toggles.set(t.id, t);
    if (wanted && t.hash) {
      setOn(t, wanted.has(t.id));
      onChange?.();
    }
    render();
    return () => {
      if (toggles.get(t.id) !== t) return;
      toggles.delete(t.id);
      render();
      hash.update();
    };
  }

  /** Switch a toggle from code (e.g. an advisor's "show forts" button), exactly as the panel would. false if unknown. */
  function setToggle(id, on) {
    const t = toggles.get(String(id));
    if (!t) return false;
    setOn(t, !!on);
    syncWanted();
    render();
    onChange?.();
    hash.update();
    return true;
  }

  // A preset: every switch but PRESET_KEEP set at once, then one re-render and one (debounced) hash write.
  function applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return false;
    for (const t of toggles.values()) if (!PRESET_KEEP.includes(t.id)) setOn(t, p.on.includes(t.id));
    syncWanted();
    render();
    onChange?.();
    hash.update();
    return true;
  }
  /** The preset the switches match now, or null ("Custom"). */
  const preset = () => PRESETS.find((p) => hashed().every((t) => PRESET_KEEP.includes(t.id) || isOn(t) === p.on.includes(t.id)))?.id ?? null;

  return {
    add,
    set: setToggle,
    applyPreset,
    preset,
    flip: (id) => { const t = toggles.get(String(id)); return t ? setToggle(t.id, !isOn(t)) : false; },
    list: () => [...toggles.values()].map((t) => ({ id: t.id, label: t.label, on: isOn(t) })),
    sections,
    /** How many map layers (not preferences) are on, and how many there are. */
    count: () => { const l = hashed(); return { on: l.filter(isOn).length, total: l.length }; },
    onList: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    refresh: render,
  };
}
