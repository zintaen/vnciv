import { css } from "../color.js";
import { t } from "../i18n.js";
import { esc } from "../format.js";
import { isCapital } from "../world.js";
import { yieldGrid, amenities, industries, economyRows, popLine, growthSpan, showPanel, hidePanel, fullName } from "./infoPanel.js";

/**
 * ctx: {w, nation, onClose, onPedia, onState(stateIndex)}
 */
export function openCityPanel(city, ctx) {
  const { w, nation } = ctx;
  const n = nation.nation;
  const owner = city.cell != null ? w.raw.owner[city.cell] : -1;
  const col = css(w.stateColor[owner] || [190, 190, 190]);

  // The city's 2025 province as a link to its panel.
  const states = (city.states || [])
    .map((abbr) => ({ abbr, i: w.raw.states.findIndex((s) => s.abbr === abbr) }))
    .map(({ abbr, i }) => (i >= 0 && ctx.onState
      ? `<button class="chip" data-state="${i}" title="${esc(t("Open the province of {name} (2025)", { name: w.raw.states[i].name }))}">${esc(w.raw.states[i].name)}</button>`
      : `<span class="chip">${esc(abbr)}</span>`))
    .join("");

  const growth = growthSpan(city, n);

  showPanel({
    kind: "city",
    kindLabel: city.province_old ? t("City · former province of {name}", { name: esc(city.province_old) }) : t("City"),
    stripe: col,
    title: city.name,
    titleHtml: `${isCapital(city) ? `<span class="cap" title="${t("National capital")}">★</span> ` : ""}${esc(city.name)}`,
    sub: `${esc(city.full ? fullName(city) : "")}${states ? `<div class="chips">${states}</div>` : ""}`,
    headExtra: popLine(city, growth),
    sections: [
      { title: t("Yields"), html: `<div class="yield-grid">${yieldGrid(nation, city.yields)}</div>` },
      { title: t("Living standards"), html: amenities(city, n) },
      { title: t("Economy"), html: economyRows(city, n) },
      city.jobs && { title: t("Where people work"), html: industries(city, nation) },
    ],
    foot: `${t("The city stands for its whole former province (before the July 2025 merger).")} ${t("Each figure shows its year and is compared with Vietnam's figure for the same year (HDI and FDI 2024: NSO publishes them only for the 34 provinces since 2025). 2025 values are preliminary; GRDP 2025 is an estimate.")} ${t("Source: {src}", { src: esc(t(nation.vintage)) })}${nation.gdp_vintage ? `; GRDP: ${esc(t(nation.gdp_vintage))}` : ""}. ${esc(t(nation.currency?.note || ""))}`,
    onClose: ctx.onClose,
    onPedia: ctx.onPedia,
    wire(panel) {
      panel.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => ctx.onState(+b.dataset.state)));
    },
  });
}

export const closeCityPanel = hidePanel;
