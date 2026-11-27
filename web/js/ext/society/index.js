// Society extension: an "Ethnic groups (2019 census)" section in the city (former province) and province panels.
// The lenses (largest ethnic group, ethnic minorities, crops) live in lenses.json and need no code here.
// Data: ethnic.json, loaded on the first panel that opens.
import { compact, esc, pct } from "../../format.js";
import { t } from "../../i18n.js";

const TOP = 5;
const COLORS = { Kinh: "#d8c27a", "Tày": "#4f9d69", "Thái": "#3f7fbf", "Mường": "#c0584f", "Nùng": "#8c6bb1", "Mông": "#e08a2e" };

function sectionHtml(e, row) {
  const ranked = e.groups.map((g, k) => [g, row.pop[k]])
    .filter(([g, v]) => v > 0 && g !== "Người nước ngoài" && g !== "Không xác định")
    .sort((a, b) => b[1] - a[1]).slice(0, TOP);
  const max = ranked[0]?.[1] || 1;
  const rows = ranked.map(([g, v]) => `<div class="ind"><span aria-hidden="true">•</span>
      <span>${esc(g)}</span><span class="n">${compact(v)} · ${pct(v / row.total, v / row.total < 0.1 ? 1 : 0)}</span>
      <div class="bar"><i style="width:${(v / max) * 100}%;background:${COLORS[g] || "#c9a45c"}"></i></div></div>`).join("");
  return `<section class="cp-section soc-ethnic"><h3>${esc(t("Ethnic groups · 2019 census"))}</h3>
    <div class="stat-row"><span class="sl">${esc(t("Ethnic minorities"))}</span><span><b>${pct(row.minority_share)}</b>
      <span class="cmp">VN ${pct(e.nation.minority_share)}</span></span></div>
    ${rows}
    <p class="muted">${esc(t("Census of 1 April 2019 (NSO), the {n} largest groups.", { n: ranked.length }))}</p></section>`;
}

export function install(app) {
  let data = null;
  const load = () => app.loadData("ethnic").then((d) => (data = d));
  // Insert after the panel has been drawn; `key` guards against a slow load landing on another panel.
  function addSection(key, pick) {
    const panel = app.panels.element;
    const put = () => {
      if (!data || !panel || panel.hidden || panel.dataset.socKey !== key) return;
      const row = pick(data);
      if (!row) return;
      panel.querySelector(".soc-ethnic")?.remove();
      const foot = panel.querySelector(".cp-foot");
      foot?.insertAdjacentHTML("beforebegin", sectionHtml(data, row));
    };
    if (!panel) return;
    panel.dataset.socKey = key;
    if (data) put();
    else load().then(put, (err) => console.warn("society: ethnic.json failed to load", err));
  }

  const onCity = (city) => {
    const iso = city?.counties?.[0];
    if (iso && !app.mode) addSection(`c:${iso}`, (d) => d.former?.[iso]);
  };
  const onState = (idx) => {
    const abbr = app.w.raw.states[idx]?.abbr;
    if (abbr) addSection(`s:${abbr}`, (d) => d.provinces?.[abbr]);
  };
  const origCity = app.panels.city;
  app.panels.city = (city, ctx) => { origCity(city, ctx); onCity(city); };
  const origState = app.panels.state;
  app.panels.state = (idx, ctx) => { origState(idx, ctx); onState(idx); };
  // A link with #city= or #state= opens its panel before extensions install: add the section to that panel too.
  if (app.state.selectedCity) onCity(app.state.selectedCity);
  else if (app.state.selectedState != null) onState(app.state.selectedState);
}
