// Advisors: Civ-style exploration dashboards docked beside the map, linked both ways with it.
//
//   app mode "advisor", params {id, ...}  (id = an advisor id, or none for the council picker)
//   URL hash: #advisor=<id> ("council" for the picker)
//   top-bar button "Advisors"
// Each advisor is a module in views/ exporting mount(ctx) → {onMapHover?, onMapClick?, onEscape?, destroy?}.
// ctx = {app, data, el, link, params, on(name, fn), bubbles(id, opts), tip, setResourceFilter, setShowResources,
//        switchTo(id, params)} — everything registered through ctx is undone when the view goes away.
import { buildData } from "./core/data.js";
import { createLinker, createBubbles, createMapTip } from "./core/link.js";
import { emblem } from "./core/emblems.js";
import { frameNation } from "./core/frame.js";
import { esc, el } from "./core/util.js";
import { icon } from "../../ui/icon.js";
import { t as tr, lang } from "../../i18n.js";

export const ADVISORS = [
  { id: "energy", name: tr("Energy"), role: tr("Minister of Power"), color: "#d98a2b", dark: "#3a1f08", blurb: tr("Where the power comes from: dams, coal, gas, sun and wind."), load: () => import("./views/energy.js") },
  { id: "economy", name: tr("Economy"), role: tr("Treasurer"), color: "#c9a43a", dark: "#3a2c08", blurb: tr("Who makes what: GRDP, jobs by industry and the provinces that lead."), load: () => import("./views/economy.js") },
  { id: "people", name: tr("People"), role: tr("Keeper of the Registers"), color: "#c46a4f", dark: "#3a140c", blurb: tr("Where people live, where they are moving, town and country."), load: () => import("./views/people.js") },
  { id: "prosperity", name: tr("Prosperity"), role: tr("Steward of the Hearth"), color: "#3f9c82", dark: "#082a22", blurb: tr("Incomes, poverty, inequality and who is being left behind."), load: () => import("./views/prosperity.js") },
  { id: "knowledge", name: tr("Knowledge"), role: tr("Mandarin of Letters"), color: "#4a86d6", dark: "#0a1c3a", blurb: tr("Universities, literacy and a trained workforce."), load: () => import("./views/knowledge.js") },
  { id: "land", name: tr("Land"), role: tr("Surveyor General"), color: "#6e9a3c", dark: "#18280a", blurb: tr("Forest, rice paddies, wetland and city: what covers the country."), load: () => import("./views/land.js") },
  { id: "commerce", name: tr("Commerce"), role: tr("Master of Trade"), color: "#2fa4b8", dark: "#062630", blurb: tr("The seaports, the busiest airports and the domestic air routes."), load: () => import("./views/commerce.js") },
  { id: "military", name: tr("Military"), role: tr("General"), color: "#8796ab", dark: "#141b26", blurb: tr("People's Army sites mapped in OpenStreetMap: bases, airfields, ranges and garrison cities."), load: () => import("./views/military.js") },
  { id: "culture", name: tr("Culture"), role: tr("Keeper of Wonders"), color: "#c25b9a", dark: "#2e0c22", blurb: tr("Wonders of the land, and the typhoons places endure."), load: () => import("./views/culture.js") },
  { id: "explorer", name: tr("Explorer"), role: tr("Cartographer"), color: "#9a7bc9", dark: "#1e1236", blurb: tr("Slice and dice every number: any level, any columns, any chart."), load: () => import("./views/explorer.js") },
];
const byId = new Map(ADVISORS.map((a) => [a.id, a]));
// The council picker groups its advisors (any advisor not listed here is added to the last group).
const COUNCIL = (() => {
  const g = [
    { label: tr("Wealth and work"), ids: ["economy", "prosperity", "commerce", "energy"] },
    { label: tr("People and land"), ids: ["people", "knowledge", "culture", "land"] },
    { label: tr("Defense"), ids: ["military"] },
    { label: tr("Your own questions"), ids: ["explorer"] },
  ];
  const listed = new Set(g.flatMap((x) => x.ids));
  g[g.length - 1].ids.push(...ADVISORS.filter((a) => !listed.has(a.id)).map((a) => a.id));
  return g;
})();
// 460 px, narrower below 1200 px wide so the whole country still fits beside the dock (matches advisors.css).
const dockW = () => (innerWidth >= 1200 ? 460 : Math.round(Math.min(460, Math.max(340, innerWidth * 0.38))));

function injectCss() {
  if (document.getElementById("advisors-css")) return;
  const l = document.createElement("link");
  l.id = "advisors-css";
  l.rel = "stylesheet";
  l.href = new URL("../../../css/advisors.css", import.meta.url).href;
  document.head.appendChild(l);
}

export function install(app) {
  injectCss();
  let data = null, dataP = null;
  let dock = null;
  let active = null; // {adv, api, cleanup: [fn], bubbles: [b], token}
  let current = null; // advisor id or "council"
  let pendingTeardown = false;
  let token = 0;
  let lastId = null;
  let framedFor = null; // the advisor the map was last framed for
  let linkLens = null; // a link's own lens (#lens=…&advisor=…): the advisor's opening lens does not replace it
  let prevCam = null; // the camera when the advisors opened
  const link = createLinker(app);
  const tip = createMapTip();
  const canvas = document.getElementById("map");

  const ensureData = () => (dataP ??= app.loadCounties().catch(() => null).then(() => (data = buildData(app))));

  // --- top-bar button ---------------------------------------------------------------------------------------------
  const btn = app.ui.addTopButton({
    id: "btn-advisors", icon: "g-people", label: tr("Advisors"), title: tr("Advisors: explore the data behind the map"),
    onClick: () => (app.mode === "advisor" ? app.setMode(null) : app.setMode("advisor", { id: lastId })),
  });
  if (btn) {
    btn.innerHTML = `<svg class="icon" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5 3 7v2h18V7z" fill="currentColor"/><path d="M5 10.5h2.6v7H5zM10.7 10.5h2.6v7h-2.6zM16.4 10.5H19v7h-2.6zM3.5 19h17v2.5h-17z" fill="currentColor"/></svg><span class="lbl">${tr("Advisors")}</span>`;
    btn.setAttribute("aria-pressed", "false");
  }
  app.on("mode", ({ name }) => btn?.setAttribute("aria-pressed", String(name === "advisor")));

  // --- dock shell -------------------------------------------------------------------------------------------------
  function shell() {
    dock = app.ui.dock("left", { width: dockW(), label: tr("Advisors") });
    if (dock.querySelector(".adv-root")) return dock.querySelector(".adv-root");
    dock.innerHTML = "";
    dock.classList.add("adv-dock");
    const root = el("div", "adv-root");
    root.innerHTML = `
      <div class="adv-grip" aria-hidden="true"></div>
      <header class="adv-head">
        <button type="button" class="adv-council-btn" data-adv="council" title="${tr("All advisors")}">${icon("g-people", "👥", { size: 14 })}<span>${tr("Council")}</span></button>
        <nav class="adv-tabs" role="tablist" aria-label="${tr("Advisors")}">${ADVISORS.map((a) => `<button type="button" role="tab" data-adv="${a.id}" aria-selected="false" title="${esc(`${a.name}: ${a.role}`)}" style="--adv:${a.color}">${emblem(a, 30)}<span class="sr-only">${esc(a.name)}</span></button>`).join("")}</nav>
        <button type="button" class="icon-btn adv-close" aria-label="${tr("Close the advisors (Esc)")}" title="${tr("Close (Esc)")}">${icon("close", "✕", { size: 12 })}</button>
      </header>
      <p class="adv-yearnote" role="status" hidden></p>
      <div class="adv-main" tabindex="-1"></div>`;
    dock.appendChild(root);
    yearNote(root);
    root.addEventListener("click", (e) => {
      const t = e.target.closest("button");
      if (!t) return;
      if (t.classList.contains("adv-close")) return app.setMode(null);
      if (t.dataset.adv) return switchTo(t.dataset.adv === "council" ? null : t.dataset.adv);
      if (t.dataset.pedia) return app.pedia?.open?.(t.dataset.pedia);
      if (t.hasAttribute("data-frame")) return link.frame() || frameNation(app);
    });
    root.querySelector(".adv-tabs").addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      const tabs = [...root.querySelectorAll(".adv-tabs [role=tab]")];
      let i = tabs.indexOf(document.activeElement);
      i = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      e.preventDefault();
      tabs[i].focus();
      switchTo(tabs[i].dataset.adv);
    });
    return root;
  }

  // The advisors' figures are the latest published ones whatever the timeline's year: say so while a year is shown.
  function yearNote(root = dock?.querySelector(".adv-root")) {
    const n = root?.querySelector(".adv-yearnote"), y = app.timeline?.year;
    if (!n) return;
    n.hidden = y == null;
    n.textContent = y == null ? "" : tr("The advisors show the latest published figures, not {year}. The map legend says which year a lens shows.", { year: y });
  }
  app.on("year", () => yearNote());

  function switchTo(id, params = {}) {
    if (app.mode === "advisor" && (id || "council") === current && !Object.keys(params).length) return;
    app.setMode("advisor", { ...params, id: id || null });
  }

  // --- views ------------------------------------------------------------------------------------------------------
  function teardownView() {
    if (!active) return;
    const a = active;
    active = null;
    try { a.api?.destroy?.(); } catch (err) { console.error("advisor destroy failed", err); }
    dispose(a);
    link.clear();
    tip.hide();
  }
  // Run (and forget) a view's cleanups and bubbles; safe to call again for anything registered later.
  function dispose(a) {
    const fns = a.cleanup.splice(0).reverse(), bs = a.bubbles.splice(0);
    for (const f of fns) { try { f(); } catch (err) { console.error(err); } }
    for (const b of bs) b.destroy();
  }

  async function show(id, params) {
    const my = ++token;
    const root = shell();
    const adv = id ? byId.get(id) : null;
    current = adv ? adv.id : "council";
    if (adv) lastId = adv.id;
    root.style.setProperty("--adv", adv?.color || "#c9a45c");
    root.querySelectorAll(".adv-tabs [role=tab]").forEach((b) => {
      const on = b.dataset.adv === current;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on || (!adv && b === root.querySelector(".adv-tabs [role=tab]")) ? 0 : -1;
    });
    root.querySelector(".adv-council-btn").setAttribute("aria-pressed", String(!adv));
    teardownView();
    // Every advisor is national in scope: frame the whole country beside the dock when one opens (or the council
    // first appears), not when the same advisor is re-shown with new parameters.
    if (current !== framedFor) {
      framedFor = current;
      requestAnimationFrame(() => { if (my === token && app.mode === "advisor") frameNation(app); });
    }
    const main = root.querySelector(".adv-main");
    main.scrollTop = 0;
    dock.scrollTop = 0;
    if (!adv) {
      main.innerHTML = councilHtml();
      main.querySelectorAll(".adv-card").forEach((c) => c.addEventListener("click", () => switchTo(c.dataset.adv)));
      return;
    }
    main.innerHTML = `${titleHtml(adv)}<div class="adv-body"><div class="adv-loading">${esc(tr("The {role} is gathering the figures…", { role: lang === "en" ? adv.role.toLowerCase() : adv.role }))}</div></div>`;
    let mod;
    try {
      [mod] = await Promise.all([adv.load(), ensureData()]);
    } catch (err) {
      console.error(err);
      if (my === token) main.querySelector(".adv-body").innerHTML = `<p class="adv-empty pad">${esc(tr("This advisor could not load ({err}).", { err: err.message || err }))}</p>`;
      return;
    }
    if (my !== token || app.mode !== "advisor") return;
    const body = main.querySelector(".adv-body");
    // The loading line stays while an advisor that awaits its own files mounts; it is removed once the view is up.
    const loading = body.querySelector(".adv-loading");
    body.replaceChildren(...(loading ? [loading] : []));
    const a = { adv, api: null, cleanup: [], bubbles: [], token: my };
    active = a;
    const ctx = {
      app, data, el: body, link, tip, params: params || {}, advisor: adv,
      on(name, fn) { const off = app.on(name, fn); a.cleanup.push(off); return off; },
      bubbles(id, opts = {}) {
        const b = createBubbles(app, `adv-${adv.id}-${id}`, opts);
        b.handlers = opts;
        a.bubbles.push(b);
        return b;
      },
      setResourceFilter(f) {
        if (!a.savedFilter) { a.savedFilter = { f: app.state.resourceFilter }; a.cleanup.push(() => app.setResourceFilter(a.savedFilter.f)); }
        app.setResourceFilter(f);
      },
      setShowResources(on) {
        if (!a.savedShow) { a.savedShow = { v: app.state.showResources }; a.cleanup.push(() => app.setShowResources(a.savedShow.v)); }
        app.setShowResources(on);
      },
      /** Colour the map with a lens (a lenses.json id, a lens object, or null) while this view is open. The lens the
       *  viewer had is restored on exit, unless they have picked another one themselves since. */
      setLens(ref) {
        if (linkLens && linkLens === app.state.lens) return;
        if (!a.lensSaved) {
          a.lensSaved = { lens: app.state.lens, ours: new Set() };
          a.cleanup.push(() => {
            const cur = app.state.lens;
            if (cur === a.lensSaved.lens || (cur && !a.lensSaved.ours.has(cur))) return;
            app.setLens(a.lensSaved.lens || null);
          });
        }
        app.setLens(ref);
        if (app.state.lens) a.lensSaved.ours.add(app.state.lens);
      },
      switchTo,
      cleanup: (fn) => a.cleanup.push(fn),
    };
    try {
      a.api = (await mod.mount(ctx)) || {};
    } catch (err) {
      console.error(`advisor "${adv.id}" failed`, err);
      body.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">${tr("Something went wrong drawing this advisor.")}</p>`);
      a.api = {};
    }
    linkLens = null; // only the opening lens: later picks inside the view apply as usual
    loading?.remove();
    // The view may have been switched away while it awaited its files: undo what it registered.
    if (active !== a) {
      try { a.api?.destroy?.(); } catch (err) { console.error(err); }
      dispose(a);
      return;
    }
    // Map hover → dashboard, only while a view that wants it is open (the app skips hover work without listeners).
    if (a.api.onMapHover && active === a) {
      a.cleanup.push(app.on("hover", (h) => {
        try { a.api.onMapHover(h); } catch (err) { console.error(err); }
      }));
    }
  }

  function titleHtml(adv) {
    return `<div class="adv-title" style="--adv:${adv.color}">
      ${emblem(adv, 64)}
      <div class="adv-titles"><div class="adv-kind">${esc(adv.role)}</div><h2>${esc(adv.name)}</h2><p>${esc(adv.blurb)}</p></div>
    </div>`;
  }

  function councilHtml() {
    return `<div class="adv-title council"><div class="adv-titles"><div class="adv-kind">${tr("Your council")}</div><h2>${tr("Advisors")}</h2>
      <p>${tr("Each advisor opens a dashboard on one part of the real economy. Hover anything to see it on the map; hover the map to find it in the charts; click to drill in.")}</p></div></div>
      ${COUNCIL.map((g) => `<h4 class="adv-council-h">${esc(g.label)}</h4><div class="adv-council">${g.ids.map((id) => byId.get(id)).filter(Boolean).map((a) => `<button type="button" class="adv-card" data-adv="${a.id}" style="--adv:${a.color}">
        ${emblem(a, 48)}<span class="t"><span class="r">${esc(a.role)}</span><b>${esc(a.name)}</b><span class="d">${esc(a.blurb)}</span></span></button>`).join("")}</div>`).join("")}
      <p class="adv-note pad">${tr("All figures are public data: {nso}, NSO's monthly reports for 2026, the VCCI Provincial Competitiveness Index, WorldPop, ESA WorldCover, ETOPO1, OpenStreetMap power plants, roads, rail and port areas, the seaport list of Decision 804/QĐ-TTg, OurAirports and ACV passenger counts, Wikidata, IBTrACS typhoon tracks and Natural Earth. Money is in US dollars at the World Bank {fx} rate. Each dashboard lists its sources and caveats at the bottom; each figure states its year.", { nso: esc(tr(app.data.nation?.vintage || "NSO Statistical Yearbook")), fx: esc(app.data.nation?.currency?.fx_year || "") })}</p>`;
  }

  // --- map → dashboard --------------------------------------------------------------------------------------------
  let lastBubble = null;
  canvas?.addEventListener("pointermove", (e) => {
    if (app.mode !== "advisor" || !active || e.pointerType !== "mouse" || e.buttons) return;
    let hit = null, owner = null;
    for (const b of active.bubbles) {
      hit = b.hit(e.clientX, e.clientY);
      if (hit) { owner = b; break; }
    }
    if (hit !== lastBubble) {
      for (const b of active.bubbles) b.setHot(b === owner ? hit.key : null);
      lastBubble = hit;
      link.fromMap(() => {
        owner?.handlers.onHover?.(hit);
        if (!hit) for (const b of active.bubbles) b.handlers.onHover?.(null);
      });
    }
    if (hit && owner.handlers.tip) tip.show(e.clientX, e.clientY, owner.handlers.tip(hit));
    else tip.hide();
  });
  canvas?.addEventListener("pointerleave", () => {
    if (!lastBubble || !active) return;
    link.fromMap(() => { for (const b of active.bubbles) { b.setHot(null); b.handlers.onHover?.(null); } });
    lastBubble = null;
    tip.hide();
  });
  app.on("mapclick", (ev) => {
    if (app.mode !== "advisor" || !active) return false;
    for (const b of active.bubbles) {
      const hit = b.hit(ev.x, ev.y);
      if (hit && b.handlers.onClick) { b.handlers.onClick(hit); return true; }
    }
    return active.api?.onMapClick?.(ev) === true;
  });

  // --- mode -------------------------------------------------------------------------------------------------------
  app.registerMode("advisor", {
    enter(params) {
      // Remember where the camera was when the advisors opened (not on a switch between advisors), to fly back on exit.
      if (!pendingTeardown && !current) prevCam = { x: app.cam.x, y: app.cam.y, scale: app.cam.scale };
      pendingTeardown = false;
      show(params?.id && byId.has(params.id) ? params.id : null, params);
    },
    exit() {
      // A switch between advisors is exit() + enter() in one go: keep the dock and only rebuild its content.
      pendingTeardown = true;
      // Left by opening a link (a pasted URL, Back): the address already names a view without the advisors, and
      // its own "at" decides the camera, so do not fly back over it.
      const h = location.hash;
      if (/[#&]at=/.test(h) && !/[#&]advisor=/.test(h)) prevCam = null;
      token++;
      queueMicrotask(() => {
        if (!pendingTeardown) return;
        pendingTeardown = false;
        teardownView();
        current = null;
        framedFor = null;
        // Back to the view the advisors were opened from (unless another mode, e.g. the City view, took over).
        const p = prevCam;
        prevCam = null;
        if (p && app.mode == null) {
          const fs = app.cam.fitScale;
          if (fs > 0 && Math.abs(p.scale / fs - 1) < 0.03) app.home();
          else { app.cam.flyTo(p.x, p.y, p.scale, 650); app.requestDraw(); }
        }
        // Leave the left dock alone if another mode has already put its own content there.
        const d = dock, root = d?.querySelector(".adv-root");
        dock = null;
        if (!d || !root) return;
        root.remove();
        d.classList.remove("adv-dock");
        if (!d.children.length) app.ui.undock("left");
      });
    },
    onEscape() {
      if (active?.api?.onEscape?.() === true) return true;
      return false;
    },
  });

  app.hash.register("advisor", {
    get: () => (app.mode === "advisor" ? current || "council" : null),
    set(v) {
      if (v) {
        const id = byId.has(v) ? v : null;
        if (app.mode !== "advisor" || (id || "council") !== current) {
          // A link with a camera (at=) keeps it: mark the advisor as framed so show() does not frame the nation.
          if (app.hash.value("at")) framedFor = id || "council";
          linkLens = app.hash.value("lens") === app.state.lens?.id ? app.state.lens : null;
          app.setMode("advisor", { id });
        }
      } else if (app.mode === "advisor") app.setMode(null);
    },
  });

  app.advisors = { list: ADVISORS, open: (id, params) => switchTo(id, params), get current() { return current; }, data: () => data, ensureData };
}
