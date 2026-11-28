// Explore (phase D, Anh 2026-11-28): four tools in one extension.
//   photos.js   real photos (Wikimedia Commons, free licences only) in ext/hexlife's place card, also after a search
//               pick or a click on a site (everyday places, geography, wonders)
//   measure.js  "Đo / Measure" (great-circle path length) and "Vòng bán kính / Radius" (what is inside a circle)
//   fly.js      fly-along journeys on real lines: the North–South railway, down the Mekong, down the Red River
//   seasons.js  "Lịch mùa Việt Nam / Season calendar": a month-by-month panel and layer (seasons.json + living.json)
// Entries: the top bar's "More" menu (Measure, Radius, Fly-along journeys), the Map panel switch "Season calendar".
// API: app.explore = {fly(id), journeys, measure(), radius(), photos, seasons}. Hash keys: measure=…, fly=<id>.
import { t } from "../../i18n.js";
import { esc } from "../../format.js";
import { installPhotos, PHOTO_CSS } from "./photos.js";
import { installMeasure, MEASURE_CSS } from "./measure.js";
import { installFly, FLY_CSS, JOURNEYS } from "./fly.js";
import { installSeasons, SEASONS_CSS } from "./seasons.js";

export function install(app) {
  const st = document.createElement("style");
  st.id = "xp-style";
  st.textContent = PHOTO_CSS + MEASURE_CSS + FLY_CSS + SEASONS_CSS + PICK_CSS;
  document.head.appendChild(st);

  const photos = installPhotos(app);
  const measure = installMeasure(app);
  const flyer = installFly(app);
  const seasons = installSeasons(app);

  // the journey picker (a small dialog)
  const dlg = document.createElement("div");
  dlg.className = "panel xp-pick";
  dlg.hidden = true;
  dlg.setAttribute("role", "dialog");
  dlg.setAttribute("aria-label", t("Fly-along journeys"));
  dlg.innerHTML = `<div class="xp-head"><b>✈ ${esc(t("Fly-along journeys"))}</b>
      <button type="button" class="icon-btn xp-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close"))}">✕</button></div>
    <ul>${JOURNEYS.map((j) => `<li><button type="button" class="xp-go" data-fly="${esc(j.id)}"><span aria-hidden="true">${j.icon}</span>
      <span><b>${esc(t(j.title))}</b><small>${esc(t(j.sub))}</small></span></button></li>`).join("")}</ul>`;
  document.body.appendChild(dlg);
  let pickOpener = null;
  const closePick = () => {
    if (dlg.hidden) return false;
    dlg.hidden = true;
    if (dlg.contains(document.activeElement) && pickOpener?.isConnected) pickOpener.focus?.();
    return true;
  };
  const openPick = () => {
    pickOpener = document.getElementById("btn-more") || document.activeElement;
    dlg.hidden = false;
    dlg.querySelector(".xp-go")?.focus();
  };
  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("xp-x")) closePick();
    else if (b.dataset.fly) { dlg.hidden = true; flyer.fly(b.dataset.fly); }
  });
  app.on("escape", () => closePick());

  app.ui.addTopButton({ id: "btn-measure", icon: "📏", label: t("Measure"), title: t("Measure a distance on the map (km)"), menu: true, onClick: () => measure.open("measure") });
  app.ui.addTopButton({ id: "btn-radius", icon: "◎", label: t("Radius"), title: t("A circle on the map: population, area and places inside"), menu: true, onClick: () => measure.open("radius") });
  app.ui.addTopButton({ id: "btn-fly", icon: "✈", label: t("Fly-along journeys"), title: t("Fly along the North–South railway, the Mekong or the Red River"), menu: true, onClick: openPick });

  app.explore = { fly: (id) => flyer.fly(id), stopFly: () => flyer.stop(), journeys: JOURNEYS.map((j) => ({ id: j.id, title: t(j.title), sub: t(j.sub), icon: j.icon })),
    flyer, measure: () => measure.open("measure"), radius: (p) => measure.open("radius", p), tools: measure, photos, seasons, openPicker: openPick };
}

const PICK_CSS = `
.xp-pick { position: fixed; right: 10px; top: calc(var(--topbar-h, 40px) + 8px); z-index: 30; width: min(320px, calc(100vw - 20px)); padding: 8px 10px 10px; font-size: 12.5px; color: var(--ink); box-sizing: border-box; }
.xp-pick[hidden] { display: none; }
.xp-pick ul { list-style: none; margin: 6px 0 0; padding: 0; }
.xp-pick li { margin-bottom: 3px; }`;
