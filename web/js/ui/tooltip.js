import { esc, int, popShort, compact } from "../format.js";
import { formatLensValue } from "./lenses.js";
import { glyph } from "./icon.js";
import { FOREIGN } from "../world.js";
import { fullName } from "./infoPanel.js";
import { t as tr } from "../i18n.js";

const el = () => document.getElementById("tooltip");

const nameOf = (table, id) => tr(table.find((t) => t.id === id)?.name);

export function showCellTooltip(mx, my, w, i, lens, showResources = true) {
  const raw = w.raw;
  const lines = [];
  const city = w.cityByCell.get(i);
  if (city) lines.push(`<b>${esc(city.name)}</b> <span class="muted">· ${tr("{n} people", { n: popShort(city.population) })}</span>`);

  const wt = w.water[i];
  if (wt) {
    const depth = raw.elev[i] < 0 ? ` <span class="muted">· ${tr("{n} m deep", { n: int(-raw.elev[i]) })}</span>` : "";
    lines.push(`<b>${esc(nameOf(w.tables.water, wt) || tr("Water"))}</b>${depth}`);
  } else {
    const cover = w.cover[i] > 0 ? nameOf(w.tables.cover, w.cover[i]) : null;
    const relief = w.relief[i] > 0 ? nameOf(w.tables.relief, w.relief[i]) : null;
    const terrain = [cover, relief].filter(Boolean).join(" · ") || (relief ?? tr("Land"));
    lines.push(`<b>${esc(terrain)}</b> <span class="muted">· ${int(raw.elev[i])} m</span>`);
  }
  const o = raw.owner[i];
  if (o >= 0) {
    // The former province (pre-2025) when its name differs from the province it is now part of.
    const former = raw.county[i] >= 0 ? raw.counties[raw.county[i]].name : "";
    const prov = raw.states[o].name;
    lines.push(former && former !== prov ? tr("{former} <span class=\"muted\">(former) · now</span> {prov}", { former: esc(former), prov: esc(prov) }) : tr("{prov} <span class=\"muted\">province</span>", { prov: esc(prov) }));
    if (lens) lines.push(`${glyph(lens, 13)} ${esc(tr(lens.name))}: <b>${formatLensValue(lens, lens.values[i])}</b>`);
  } else if (o === FOREIGN) {
    lines.push(`<span class="muted">${tr("Beyond the borders (not mapped)")}</span>`);
  }
  const res = showResources && w.resources?.byCell.get(i);
  if (res) {
    for (const it of res.slice(0, 4)) {
      const t = w.resources.typeById.get(it.type);
      const num = it.value == null ? "" : Math.abs(it.value) < 1e6 ? int(it.value) : compact(it.value);
      const val = num ? ` · ${num}${t.unit ? " " + esc(tr(t.unit)) : ""}` : "";
      const kind = it.name && it.name !== t.name ? ` <span class="muted">· ${esc(tr(t.name))}${val}</span>` : `<span class="muted">${val}</span>`;
      lines.push(`<span style="color:${esc(t.color || "#efe4c6")}">${glyph(t, 13)}</span> ${esc(it.name || tr(t.name))}${kind}`);
    }
    if (res.length > 4) lines.push(`<span class="muted">${tr("+{n} more", { n: res.length - 4 })}</span>`);
  }
  if (city) lines.push(`<span class="muted">${tr("Click to open the city")}</span>`);
  else if (o >= 0) lines.push(`<span class="muted">${tr("Click to open {name}", { name: esc(raw.states[o].name) })}</span>`);
  show(mx, my, lines.join("<br>"));
}

/**
 * A tooltip with ready-made content: a string is HTML (escape any data yourself with format.js esc), {text} is
 * plain text. Used for registered static layers' tooltip(item).
 */
export function showHtmlTooltip(mx, my, content) {
  if (content == null || content === "") return hideTooltip();
  const html = typeof content === "string" ? content : esc(content.text ?? "");
  show(mx, my, html);
}

export function showCityTooltip(mx, my, city) {
  show(mx, my, `<b>${esc(fullName(city))}</b><br><span class="muted">${tr("Click to open the city")}</span>`);
}

function show(mx, my, html) {
  const t = el();
  t.innerHTML = html;
  t.hidden = false;
  const r = t.getBoundingClientRect();
  t.style.left = Math.max(4, Math.min(window.innerWidth - r.width - 8, mx + 16)) + "px";
  t.style.top = Math.max(4, Math.min(window.innerHeight - r.height - 8, my + 16)) + "px";
}

export function hideTooltip() {
  el().hidden = true;
}
