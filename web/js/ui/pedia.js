// The Almanac: what every number means and exactly where it comes from.
import { resolveTables } from "../terrain.js";
import { esc, fixed, int } from "../format.js";
import { parseHex, luminance } from "../color.js";
import { icon, glyph } from "./icon.js";
import { formatLensValue } from "./lenses.js";
import { t } from "../i18n.js";

const COVER_ICON = { forest_deciduous: "l-forest", forest_evergreen: "l-forest", forest_mixed: "l-forest", cropland: "l-farmland", pasture: "l-farmland", urban: "l-developed" };
// Glyph colour that reads on a resource medallion (dark on light faces such as nuclear yellow or silver).
const inkOn = (hex) => {
  try { return /^#[0-9a-f]{6}$/i.test(hex || "") && luminance(parseHex(hex)) > 0.4 ? "#1c1710" : "#f8f0d8"; } catch { return "#f8f0d8"; }
};
const CATEGORY = { energy: "Energy", mineral: "Minerals", agri: "Agriculture" };

export function initPedia(data) {
  const modal = document.getElementById("pedia");
  const card = modal.querySelector(".modal-card");
  const nav = document.getElementById("pedia-nav");
  const body = document.getElementById("pedia-body");
  const srcName = (id) => data.sources?.find((s) => s.id === id)?.title || id || "";
  let restoreFocus = null;

  const h2 = (ic, fb, text) => `<h2>${icon(ic, fb, { size: 24 })}<span>${esc(text)}</span></h2>`;

  // Page keys stay English (pedia.open("Yields")); titles and text go through t().
  const pages = {
    "About this map": () => {
      const km = data.world.km_per_unit || 1;
      const g = data.world.grid;
      return `
      ${h2("pedia", "📖", t("About this map"))}
      <p>${t("This is the real Vietnam, drawn like a strategy game. Nothing is invented: every tile, city and number comes from public data, listed under <i>Sources</i>.")}</p>
      <h4>${t("How it's built")}</h4>
      <p>${t("Vietnam is projected (Albers equal-area) and cut into {cols}×{rows} hexes, each {km} km corner to corner (about {area} km²). Each hex belongs to the province and former province under most of its sample points. Terrain comes from elevation samples and land-cover pixels inside each hex. Hoàng Sa (Paracel) and Trường Sa (Spratly) islands, far smaller than a hex, are shown by the hexes at their centres, as part of Đà Nẵng and Khánh Hòa.", {
        cols: g.cols, rows: g.rows, km: Math.round(g.radius * 2 * km), area: Math.round(2.598 * (g.radius * km) ** 2) })}</p>
      <p>${t("<b>Provinces</b> are the 34 provinces and centrally-run cities created on 1 July 2025. Vietnam's statistics are still published for the 63 <b>former provinces</b> they were merged from, so every province number is a sum (or a population-weighted average) of its former provinces.")}</p>
      <p>${t("<b>Cities</b> are the 63 seats of the former provinces. Like a metro area in a strategy game, each city stands for its whole former province: its banner numbers cover the province, not just the town.")}</p>
      <p>${t("Money is shown in US dollars, converted at the World Bank's official rate for {year} ({fx} ₫ per $).", {
        year: esc(data.nation.currency?.fx_year || "2024"),
        fx: esc(int(data.nation.currency?.fx || 0)) })}</p>
      <h4>${t("Controls")}</h4>
      <p>${t("Drag or arrow keys / WASD to pan · scroll, +/– or double-click to zoom · click a city or a province to open it · / or ⌘K to search · L to cycle lenses · R to show or hide resources · ? for all shortcuts · Esc to close.")}</p>
      <p>${t("The address bar always holds a link to what you're looking at (lens, selection and view); use <i>Share</i> to copy it or to download a picture.")}</p>`;
    },
    Yields: () => `
      ${h2("y-production", "⚙️", t("Yields"))}
      <p>${t("Civilization's yields mapped onto real measures that Vietnam's statistics office publishes for every province. <b>Gold is GDP</b> (GRDP): output per year, counted where the work is done.")}</p>
      <table>${data.nation.yields.map((y) => `<tr><td class="ic" style="color:${esc(y.color)}">${glyph(y, 26)}</td><td><b style="color:${esc(y.color)}">${esc(t(y.label))}${y.key === "gold" ? " (GRDP)" : ""}</b><br>${esc(t(y.description))}</td></tr>`).join("")}</table>
      <h4>${t("Work &amp; income")}</h4>
      <p>${t("Unemployment = unemployed ÷ labour force in working age (Labour Force Survey). Income is the average monthly income per person from the Household Living Standards Survey, × 12: per person, not per household.")}</p>`,
    Provinces: () => `
      ${h2("terrain", "🗺️", t("Provinces"))}
      <p>${t("Click any land hex without a city to open its province. A province's numbers add up its former provinces ({vintage}); rates are averages weighted by population (or by labour force for work rates).", {
        vintage: esc(t(data.nation.vintage)) + (data.nation.gdp_vintage ? `; GRDP: ${esc(t(data.nation.gdp_vintage))}` : "") })}</p>
      <p>${t("<b>Ranks</b> (\"#3 of {n}\") compare the {n} provinces; 1 is the largest.", { n: data.world.states.length })}</p>
      ${data.states ? "" : `<p class="muted">${t("This data build has no states.json, so province panels show names and cities only.")}</p>`}`,
    Terrain: () => {
      const tb = data.w?.tables || resolveTables(data.world.tables);
      const hasCover = Array.isArray(data.world.cover);
      const row = (x) => `<tr><td class="nm">${x.color ? `<span class="swatch" style="background:${esc(x.color)}"></span>` : ""}${
        COVER_ICON[x.key] ? icon(COVER_ICON[x.key], "", { size: 15 }) + " " : ""}<b>${esc(t(x.name))}</b></td><td>${esc(t(x.rule || ""))}</td></tr>`;
      return `
      ${h2("terrain", "🗺️", t("Terrain"))}
      <p>${t("Each hex averages the ETOPO1 elevation samples inside it. Relief comes from the mean elevation and roughness (standard deviation) of those samples; shading comes from elevation differences with neighbouring hexes, lit from the north-west.")}</p>
      <h4>${icon("l-forest", "🌲", { size: 16 })} ${t("Land cover")}</h4>
      ${hasCover
        ? `<p>${t("The base colour of each hex is its dominant land-cover group: the largest group among the land samples inside it. Small symbols show the mix: trees scale with the forest share, and fields, reeds, shrubs and grass tufts mark farmland, wetland, scrub and grassland.")}</p>
           <table>${tb.cover.filter((x) => x.id > 0).map(row).join("")}</table>`
        : `<p class="muted">${t("This data build has no land-cover layer yet; land is coloured by elevation.")}</p>`}
      <h4>${t("Relief")}</h4>
      <table>${tb.relief.map(row).join("")}</table>
      <h4>${icon("r-hydro", "💧", { size: 16 })} ${t("Water")}</h4>
      <table>${tb.water.filter((x) => x.id > 0).map(row).join("")}</table>
      <h4>${t("Beyond the borders")}</h4>
      <p class="muted">${t("Neighbouring land (China, Laos, Cambodia, Thailand and beyond) is drawn under a light fog: it is shown for context and not mapped in detail.")}</p>`;
    },
    Lenses: () => `
      ${h2("layers", "▤", t("Lenses"))}
      <p>${t("Lenses recolour the map by one measure ({vintage}). Population density, land cover and typhoons are measured hex by hex from gridded data. The province lenses spread each former province's figure over its hexes; a hex on a border averages its 7 sample points (centre + 6), so borders blend a little.", { vintage: esc(t(data.lenses.vintage || "")) })}</p>
      <p>${t("The legend shows how many hexes fall at each value. Hover or drag on it to show only that range on the map.")}</p>
      ${(data.lenses.groups || [{ id: null, name: "" }]).map((g) => {
        const ls = data.lenses.lenses.filter((l) => !g.id || l.group === g.id);
        if (!ls.length) return "";
        return `${g.name ? `<h3 class="grp">${icon(`g-${g.id}`, "", { size: 16 })} ${esc(t(g.name))}</h3>` : ""}${ls.map((l) => `
          <div class="lens-entry"><div class="le-ic">${glyph(l, 26)}</div><div>
          <h4>${esc(t(l.name))}</h4><p>${esc(t(l.description))}<br>
          <i class="le-ramp" style="background:linear-gradient(90deg, ${(l.ramp || []).map(esc).join(",")})"></i>
          <span class="muted">${t("Scale: {scale}, {lo}–{hi} {unit}", { scale: esc(t(l.scale)), lo: esc(formatLensValue({ ...l, unit: null }, l.domain[0])), hi: esc(formatLensValue({ ...l, unit: null }, l.domain[1])), unit: esc(t(l.unit)) })}${
            l.higher_is === "good" ? " · " + t("higher is better") : l.higher_is === "bad" ? " · " + t("higher is worse") : ""}${l.source ? " · " + esc(t(srcName(l.source))) : ""}</span></p></div></div>`).join("")}`;
      }).join("")}`,
    Resources: () => {
      const r = data.resources;
      if (!r?.types?.length) return `${h2("resources", "⛏️", t("Resources"))}<p class="muted">${t("This data build has no resources layer.")}</p>`;
      const count = new Map();
      for (const it of r.items || []) count.set(it.type, (count.get(it.type) || 0) + 1);
      const cats = [...new Set(r.types.map((ty) => ty.category || "other"))];
      return `
      ${h2("resources", "⛏️", t("Resources"))}
      <p>${t("Resources mark the country's biggest power plants on the tiles where they are. Only meaningful sites are shown: each type's threshold is in its description. When zoomed out, a hex shows its highest-ranked resource; zoom in to see more. Press <b>R</b> to show or hide them.")}</p>
      ${cats.map((c) => `<h4>${esc(t(CATEGORY[c] || c))}</h4><table class="res-table">
        <tr><th></th><th>${t("Type")}</th><th>${t("What counts")}</th><th>${t("Sites")}</th></tr>
        ${r.types.filter((ty) => (ty.category || "other") === c).map((ty) => `<tr>
          <td class="ic"><span class="res-ic" style="background:${esc(ty.color || "#24384f")};color:${inkOn(ty.color)}">${glyph(ty, 20)}</span></td>
          <td class="nm"><b>${esc(t(ty.name))}</b>${ty.unit ? `<br><span class="muted">${t("value in {unit}", { unit: esc(t(ty.unit)) })}</span>` : ""}</td>
          <td>${esc(t(ty.description || ""))}<br><span class="muted">${t("Source: {source}", { source: esc(t(srcName(ty.source))) })}</span></td>
          <td class="num">${count.get(ty.id) || 0}</td></tr>`).join("")}</table>`).join("")}`;
    },
    Sources: () => `
      ${h2("pedia", "📖", t("Sources"))}
      ${data.sources.map((s) => `
        <h4>${esc(t(s.title))}</h4>
        <p>${esc(t(s.description))}<br>
        <span class="muted">${esc(t(s.publisher))} · ${esc(t(s.license))}${s.vintage ? " · " + esc(s.vintage) : ""} ·
        <a href="${/^https?:\/\//i.test(s.homepage || "") ? esc(s.homepage) : "#"}" target="_blank" rel="noopener">${t("homepage")}</a></span></p>
        <table>${(s.files || []).map((f) => `<tr><td><code>${esc(f.url)}</code></td><td class="muted" style="white-space:nowrap">${esc((f.retrieved || "").slice(0, 10))}${f.bytes ? `<br>${fixed(f.bytes / 1e6, 1)} MB` : ""}</td></tr>`).join("")}</table>`).join("")}`,
  };

  const show = (name) => {
    if (!pages[name]) name = "About this map";
    body.innerHTML = pages[name]();
    body.scrollTop = 0;
    nav.querySelectorAll("button").forEach((b) => {
      const on = b.dataset.page === name;
      b.classList.toggle("active", on);
      b.setAttribute("aria-current", on ? "page" : "false");
    });
  };
  nav.innerHTML = `<div class="hd">${t("Almanac")}</div>` + Object.keys(pages).map((p) => `<button data-page="${esc(p)}">${esc(t(p))}</button>`).join("");
  nav.onclick = (e) => {
    const b = e.target.closest("button[data-page]");
    if (b) show(b.dataset.page);
  };
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    if (restoreFocus && document.contains(restoreFocus)) restoreFocus.focus();
    restoreFocus = null;
  };
  modal.onclick = (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  };
  // Keep Tab inside the dialog.
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...card.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  return {
    open(page = "About this map") {
      if (modal.hidden) restoreFocus = document.activeElement;
      show(page);
      modal.hidden = false;
      (nav.querySelector("button.active") || card.querySelector("[data-close]"))?.focus();
    },
    close,
    get isOpen() {
      return !modal.hidden;
    },
  };
}
