import { css } from "../color.js";
import { t } from "../i18n.js";
import { esc, kindOf, popShort } from "../format.js";
import { isCapital } from "../world.js";
import { yieldGrid, amenities, industries, economyRows, popLine, growthSpan, showPanel, fullName } from "./infoPanel.js";

/**
 * Opens the panel for province `idx` (index into world.json states / states.json; Vietnam's 34 provinces of 2025).
 * ctx: {w, nation, states (states.json or null), cities, onClose, onPedia, onCity(city)}
 */
export function openStatePanel(idx, ctx) {
  const { w, nation } = ctx;
  const n = nation.nation;
  const geo = w.raw.states[idx] || {};
  // states.json is in the same order as world.json states; fall back to matching by fips.
  let st = ctx.states?.[idx];
  if (st && geo.fips && st.fips && st.fips !== geo.fips) st = ctx.states.find((s) => s.fips === geo.fips);
  st = st || { ...geo };
  const name = st.name || geo.name || t("Province");
  const abbr = st.abbr || geo.abbr || "";
  const count = ctx.states?.length || w.raw.states.length;

  // Its cities: the seats of the former provinces merged into it.
  const cities = (ctx.cities || []).filter((c) => (c.states || []).includes(abbr)).sort((a, b) => (b.population || 0) - (a.population || 0));
  const cityRows = cities.length
    ? `<div class="city-list">${cities
        .map((c) => {
          const multi = c.province_old && c.province_old !== c.name ? `<span class="muted"> · ${esc(c.province_old)}</span>` : "";
          return `<button class="city-row" data-city="${esc(c.id)}" title="${esc(fullName(c))}">
            <span class="cr-name">${isCapital(c) ? "★ " : ""}${esc(c.name)}${multi}</span>
            <span class="cr-pop">${popShort(c.population)}</span><span class="cr-go" aria-hidden="true">›</span></button>`;
        })
        .join("")}</div>`
    : `<p class="muted">${t("No cities in this province's data.")}</p>`;

  const hasEcon = st.population != null || st.yields;
  showPanel({
    kind: "state",
    kindLabel: kindOf(abbr),
    stripe: css(w.stateColor[idx] || [190, 190, 190]),
    title: name,
    sub: Array.isArray(st.former) && st.former.length
      ? (st.former.length > 1 ? t("Merged in July 2025 from {list}", { list: esc(st.former.join(", ")) }) : t("Kept its borders in the July 2025 merger"))
      : esc(abbr),
    headExtra: hasEcon ? popLine(st, growthSpan(st, n)) : "",
    sections: [
      st.yields && { title: t("Yields · rank among provinces"), html: `<div class="yield-grid">${yieldGrid(nation, st.yields, st.ranks, count)}</div>` },
      hasEcon && { title: t("Living standards"), html: amenities(st, n) },
      hasEcon && { title: t("Economy"), html: economyRows(st, n) },
      st.jobs && { title: t("Top industries · where people work"), html: industries(st, nation, 8) },
      { title: t("Cities · former province seats"), html: cityRows },
      !hasEcon && { title: t("Data"), html: `<p class="muted">${t("Province statistics are not in this data build (states.json is missing).")}</p>` },
    ],
    foot: `${t("Source: {src}", { src: esc(t(nation.vintage)) })}${nation.gdp_vintage ? `; GRDP: ${esc(t(nation.gdp_vintage))}` : ""}${t(", summed over its former provinces.")} ${t("Ranks are among the {n} provinces (1 = largest).", { n: count })}`,
    onClose: ctx.onClose,
    onPedia: ctx.onPedia,
    wire(panel) {
      panel.querySelectorAll("[data-city]").forEach((b) => {
        b.onclick = () => {
          const c = ctx.cities.find((x) => x.id === b.dataset.city);
          if (c) ctx.onCity(c);
        };
      });
    },
  });
}
