// "Hành trình Việt Nam": a ~2-minute camera tour from Cột cờ Lũng Cú to Mũi Cà Mau. Each stop shows a card with
// 1–2 facts read from the data at runtime (stops.js). The camera follows camera.js's van Wijk zoom path between
// stops and drifts slowly in while a card is up. Pause / resume (Space), skip (→), back (←), Esc closes; a click on
// the map pauses. With Effects off or reduced motion it is a step-through slideshow. #tour=1 starts it.
// Started from the Help dialog (?), which keeps the phone top bar uncluttered.
import { t } from "../../i18n.js";
import { esc } from "../../format.js";
import { zoomPath } from "../../camera.js";
import { buildStops } from "./stops.js";

const DWELL_MS = 5200, SLOGAN_MS = 1500;
const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const smooth = (k) => k * k * (3 - 2 * k);
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function install(app) {
  const M = app.motion, cam = app.cam;
  let opener = null, stops = null, active = false, slides = false, i = 0, v = 0, cancel = null, paused = false, leg = null, autoPaused = false;

  // --- UI -------------------------------------------------------------------------------------------------------
  const bar = document.createElement("div");
  bar.className = "panel tour-bar";
  bar.hidden = true;
  bar.setAttribute("role", "region");
  bar.tabIndex = -1;
  bar.setAttribute("aria-label", t("Vietnam journey"));
  bar.innerHTML = `<div class="tour-prog"><i></i></div>
    <div class="tour-head"><span class="tour-kick">${esc(t("Vietnam journey"))} · <span class="tour-n"></span></span>
      <button type="button" class="icon-btn tour-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close (Esc)"))}">✕</button></div>
    <div class="tour-body" aria-live="polite"><h3 class="tour-title"></h3><p class="tour-slogan"></p><ul class="tour-facts"></ul></div>
    <div class="tour-ctl"><button type="button" class="tl-btn tour-prev"></button><button type="button" class="tl-btn tour-pause"></button>
      <button type="button" class="tl-btn tour-next"></button><span class="tour-src">${esc(t("Facts from this map's data: see the Almanac for sources"))}</span></div>`;
  document.body.appendChild(bar);
  const q = (s) => bar.querySelector(s);
  const progEl = q(".tour-prog i"), nEl = q(".tour-n"), bodyEl = q(".tour-body"), titleEl = q(".tour-title"), sloganEl = q(".tour-slogan"),
    factsEl = q(".tour-facts"), prevBtn = q(".tour-prev"), pauseBtn = q(".tour-pause"), nextBtn = q(".tour-next");
  prevBtn.textContent = "⏮"; prevBtn.title = t("Previous stop (←)"); prevBtn.setAttribute("aria-label", t("Previous stop (←)"));
  nextBtn.textContent = "⏭"; nextBtn.title = t("Next stop (→)"); nextBtn.setAttribute("aria-label", t("Next stop (→)"));
  bar.addEventListener("click", (e) => {
    if (e.target.closest(".tour-x")) stop();
    else if (e.target.closest(".tour-prev")) go(i - 1);
    else if (e.target.closest(".tour-next")) go(i + 1);
    else if (e.target.closest(".tour-pause")) togglePause();
    else if (e.target.closest(".tour-again")) { go(0); nextBtn.focus(); } // (the button is replaced by the first stop)
  });

  function renderCard(s, n) {
    nEl.textContent = t("{n} of {m}", { n: n + 1, m: stops.length });
    titleEl.textContent = s.title;
    sloganEl.textContent = s.slogan || "";
    sloganEl.hidden = !s.slogan;
    factsEl.innerHTML = s.facts.map((f) => `<li>${esc(f)}</li>`).join("");
  }
  function renderEnd() {
    nEl.textContent = t("{n} of {m}", { n: stops.length, m: stops.length });
    titleEl.textContent = t("End of the journey");
    sloganEl.hidden = true;
    factsEl.innerHTML = `<li style="list-style:none"><button type="button" class="tl-btn tour-again">${esc(t("↺ Start again"))}</button></li>`;
    bodyEl.classList.remove("dim");
  }
  function renderCtl() {
    const f = document.activeElement;
    pauseBtn.hidden = slides || i >= stops.length;
    pauseBtn.textContent = paused ? "▶" : "❚❚";
    const l = paused ? t("Play") : t("Pause");
    pauseBtn.title = `${l} (Space)`; pauseBtn.setAttribute("aria-label", l);
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= stops.length;
    // the focused control just went disabled or hidden (first stop, the end): keep focus in the bar
    if ([prevBtn, pauseBtn, nextBtn].includes(f) && (f.disabled || f.hidden)) (i >= stops.length ? q(".tour-again") || prevBtn : nextBtn).focus();
  }
  const progress = (p) => { progEl.style.width = `${(100 * Math.min(1, p)).toFixed(2)}%`; };

  // --- camera: keys are the point at the middle of the map area left above the card, and a scale ----------------
  function area() {
    const top = app.visibleArea?.().y0 ?? 50;
    const phone = cam.w <= 700;
    const bottom = cam.h - (phone ? Math.min(cam.h * 0.42, 300) : 190);
    return { vx: cam.w / 2, vy: (top + Math.max(top + 80, bottom)) / 2 };
  }
  function place(k) {
    const { vx, vy } = area();
    cam.stop();
    cam.scale = k.s;
    cam.x = k.x - (vx - cam.w / 2) / k.s;
    cam.y = k.y - (vy - cam.h / 2) / k.s;
  }
  function here() {
    const { vx, vy } = area(), s = cam.scale;
    return { x: cam.x + (vx - cam.w / 2) / s, y: cam.y + (vy - cam.h / 2) / s, s };
  }
  const keyOf = (s) => ({ x: s.x, y: s.y, s: cam.clampScale((cam.fitScale || cam.scale) * 2 ** s.z) });

  // --- playback -----------------------------------------------------------------------------------------------------
  function startLeg(n) {
    cancel?.(); cancel = null;
    i = n;
    if (i >= stops.length) return finish();
    const s = stops[i], a = here(), b = keyOf(s);
    const path = zoomPath(a.x, a.y, cam.w / a.s, b.x, b.y, cam.w / b.s);
    const fly = Math.min(4200, Math.max(2200, path.S * 900));
    leg = { s, a, b, path, fly, total: fly + DWELL_MS + (s.slogan ? SLOGAN_MS : 0), shown: false };
    bodyEl.classList.add("dim");
    v = 0;
    run();
  }
  function run() {
    paused = false; renderCtl();
    const from = v, L = leg;
    cancel = M.tween({ from, to: 1, ms: L.total * (1 - from), ease: "linear",
      onUpdate: (p) => { v = p; frame(L, p); },
      onDone: () => { cancel = null; if (active && !slides && M.enabled) startLeg(i + 1); } });
  }
  // The tour flies the 2D camera: the 3D view (ext/view3d) would hide it, so entering 3D pauses the tour and playing or
  // stepping it leaves 3D.
  const leave3d = () => { if (app.view3d?.on) app.view3d.exit(true); };
  function frame(L, p) {
    if (app.view3d?.on) { if (!paused) togglePause(); return; }
    const el = p * L.total;
    if (el < L.fly) {
      const [x, y, vw] = L.path(easeInOut(el / L.fly));
      place({ x, y, s: cam.w / vw });
    } else place({ x: L.b.x, y: L.b.y, s: L.b.s * (1 + 0.08 * smooth((el - L.fly) / (L.total - L.fly))) });
    if (!L.shown && el > L.fly * 0.7) {
      L.shown = true;
      renderCard(L.s, i);
      bodyEl.classList.remove("dim");
    }
    progress((i + p) / stops.length);
  }
  function togglePause() {
    if (slides || i >= stops.length) return;
    if (paused) { leave3d(); run(); } else { cancel?.(); cancel = null; paused = true; renderCtl(); }
  }
  function finish() {
    i = stops.length;
    renderEnd(); renderCtl(); progress(1);
  }
  function showSlide(n) {
    cancel?.(); cancel = null;
    i = Math.max(0, Math.min(stops.length, n));
    if (i >= stops.length) { finish(); app.requestDraw(); return; }
    place(keyOf(stops[i]));
    renderCard(stops[i], i);
    bodyEl.classList.remove("dim");
    renderCtl(); progress((i + 1) / stops.length);
    app.requestDraw();
  }
  function go(n) {
    if (!active) return;
    leave3d();
    n = Math.max(0, Math.min(stops.length, n));
    if (slides) return showSlide(n);
    if (n >= stops.length) { cancel?.(); cancel = null; return finish(); }
    startLeg(n);
  }

  async function start() {
    if (active) return;
    active = true;
    opener = document.activeElement;
    // Clear the screen before the await: a #tour=1&city=… link (or Back to one) then corrects its own history entry
    // (the hash state's set() is synchronous) instead of pushing a second one that Back returns to with the tour running.
    if (app.mode) app.setMode(null);
    app.clearSelection?.();
    leave3d();
    await Promise.all([app.loadData("wonders"), app.loadData("places")]);
    if (!active) return;
    const D = app.data;
    stops = buildStops({ cities: D.cities, wonders: D.wonders, places: D.places, world: app.w.raw, lenses: D.lenses, grid: app.w.grid });
    if (!stops.length) { active = false; return; }
    app.emit("tour"); // the timeline closes its card and a replay
    document.body.classList.add("tour-on");
    slides = !M.enabled;
    paused = false;
    bar.hidden = false;
    app.hash.flush(); // now: the camera moves every frame from here on, and each move re-arms the debounced write
    if (slides) showSlide(0);
    else startLeg(0);
    bar.focus({ preventScroll: true }); // Space / arrows drive the tour (a focused button would take Space)
  }
  function stop() {
    if (!active) return;
    active = false;
    cancel?.(); cancel = null;
    const hadFocus = bar.contains(document.activeElement);
    bar.hidden = true;
    if (hadFocus) (opener !== document.body && opener?.isConnected && opener.getClientRects().length ? opener : document.getElementById("btn-help"))?.focus();
    document.body.classList.remove("tour-on");
    app.hash.update();
    app.requestDraw();
  }

  M.on?.("change", (on) => {
    if (!active) return;
    if (!on && !slides) {
      if (document.hidden && M.userEnabled !== false && !reduced()) { // a background tab: pick up where it was
        if (!paused && cancel) { cancel(); cancel = null; autoPaused = true; }
        return;
      }
      slides = true;
      showSlide(Math.min(i, stops.length));
    } else if (on && autoPaused) { autoPaused = false; run(); }
  });
  app.on("escape", () => { if (!active) return false; stop(); return true; });
  // Opening an advisor or the City View takes the camera (and the screen): the tour ends, as starting it closes them.
  app.on("mode", (e) => { if (active && e?.name) stop(); });
  addEventListener("keydown", (e) => {
    if (!active || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || (e.target?.tagName === "BUTTON" && e.key === " ")) return;
    if (e.key === " ") { e.preventDefault(); togglePause(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
  }, true);
  // Grabbing the map pauses the tour (so the camera is the user's), resume with ▶.
  document.getElementById("map")?.addEventListener("pointerdown", () => { if (active && !slides && !paused && cancel) togglePause(); });

  app.hash.register("tour", { get: () => (active ? "1" : null), set: (val) => (val === "1" ? start() : stop()) });

  // The start button, in the Help dialog.
  const card = document.querySelector("#help .help-card");
  if (card) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn tour-start";
    b.innerHTML = `<span aria-hidden="true">▶</span> ${esc(t("Vietnam journey"))} <span class="tour-len">${esc(t("a 2-minute camera tour, Lũng Cú to Cà Mau"))}</span>`;
    b.addEventListener("click", () => { card.querySelector("[data-close]")?.click(); start(); });
    card.querySelector("h2")?.after(b);
  }
  injectStyle();
  app.tour = { start, stop, get active() { return active; }, get index() { return i; }, get stops() { return stops; }, next: () => go(i + 1) };
}

function injectStyle() {
  const css = `
.tour-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 18px; z-index: 22; width: min(560px, calc(100vw - 16px));
  padding: 0 12px 9px; font-size: 13px; color: var(--ink); box-sizing: border-box; overflow: hidden; }
.tour-bar[hidden], .tour-bar [hidden] { display: none !important; }
.tour-bar:focus { outline: none; }
.tour-prog { height: 3px; margin: 0 -12px 7px; background: rgba(201,164,92,.18); }
.tour-prog i { display: block; height: 100%; width: 0; background: var(--gold-bright); }
.tour-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.tour-kick { color: var(--ink-dim); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
.tour-body { transition: opacity .45s ease, transform .45s ease; min-height: 74px; }
.tour-body.dim { opacity: 0; transform: translateY(4px); }
.tour-title { margin: 2px 0 4px; font: 600 20px var(--serif); color: var(--gold-bright); }
.tour-slogan { margin: 0 0 4px; font: 600 16px var(--serif); color: #f2d27a; }
.tour-facts { margin: 0; padding-left: 18px; line-height: 1.45; }
.tour-ctl { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
.tour-bar .tl-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; min-width: 32px; height: 28px; padding: 0 8px; font: inherit; }
.tour-bar .tl-btn:hover:not(:disabled) { background: rgba(201,164,92,.15); }
.tour-bar .tl-btn:disabled { opacity: .35; cursor: default; }
.tour-src { margin-left: auto; color: var(--ink-dim); font-size: 10.5px; text-align: right; }
.tour-start { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; width: 100%; margin: 4px 0 12px; padding: 8px 12px; font-size: 14px; text-align: left; }
.tour-len { color: var(--ink-dim); font-size: 12px; }
body.tour-on #lens-area, body.tour-on #minimap-wrap, body.tour-on #btn-minimap, body.tour-on .rp-bar { display: none !important; }
.no-motion .tour-body { transition: none; }
@media (prefers-reduced-motion: reduce) { .tour-body { transition: none; } }
@media (max-width: 700px) { .tour-bar { bottom: 8px; padding: 0 10px 7px; } .tour-title { font-size: 17px; } .tour-body { min-height: 0; } .tour-src { display: none; } }`;
  const el = document.createElement("style");
  el.id = "tour-style";
  el.textContent = css;
  document.head.appendChild(el);
}
