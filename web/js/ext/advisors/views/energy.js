// Energy advisor: the mapped power plants (WRI Global Power Plant Database, data as of 2021).
import { esc, fin } from "../core/util.js";
import { fmtValue, mw, int, count3 } from "../core/fmt.js";
import { kindOf, siteDetail, siteDetailHtml } from "../../../format.js";
import { barList, shareBar, stackedBars, sizeLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, chips, sourcesHtml } from "../core/view.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { glyph } from "../../../ui/icon.js";
import { t as tr } from "../../../i18n.js";

const GROUPS = [
  { id: "thermal", label: tr("Thermal plants"), types: ["coal_plant", "gas_plant", "oil_plant"] },
  { id: "water", label: tr("Hydro"), types: ["hydro"] },
  { id: "renew", label: tr("Wind & solar"), types: ["wind", "solar"] },
];

export function mount(ctx) {
  const { app, data, el, link } = ctx;
  const res = app.data.resources;
  if (!res) {
    el.innerHTML = `<p class="adv-empty pad">${tr("resources.json is not built, so there is nothing to show here.")}</p>`;
    return {};
  }
  const types = res.types;
  const typeById = new Map(types.map((t) => [t.id, t]));
  const items = res.items.map((it, i) => ({ ...it, idx: i, key: String(i) }));
  const nat = res.summary?.national || {};
  const isMW = (t) => typeById.get(t)?.unit === "MW";
  const mwTypes = types.filter((t) => t.unit === "MW");
  const states = app.data.states || [];
  const stateIdx = new Map(states.map((s, i) => [s.abbr, i]));
  // Draw groups in GROUPS order, plus any type the groups do not list.
  const listed = new Set(GROUPS.flatMap((g) => g.types));
  const groups = GROUPS.map((g) => ({ ...g, types: g.types.filter((t) => typeById.has(t)) })).filter((g) => g.types.length);
  const extra = types.filter((t) => !listed.has(t.id)).map((t) => t.id);
  if (extra.length) groups.push({ id: "other", label: tr("Other"), types: extra });

  const st = { on: new Set(types.map((t) => t.id)), min: 0, state: null };
  ctx.setShowResources(true);

  // --- headline -------------------------------------------------------------------------------------------------
  const totalMW = mwTypes.reduce((a, t) => a + (nat[t.id]?.value || 0), 0);
  const sites = mwTypes.reduce((a, t) => a + (nat[t.id]?.count || 0), 0);
  const top = el.appendChild(document.createElement("div"));
  top.innerHTML = tiles([
    { label: tr("Mapped power"), value: mw(totalMW), sub: tr("{n} sites", { n: int(sites) }) },
    ...groups.map((g) => { const v = g.types.reduce((a, t) => a + (nat[t]?.value || 0), 0); return { label: g.label, value: mw(v), sub: tr("{n}% of mapped", { n: totalMW ? Math.round((100 * v) / totalMW) : 0 }) }; }).slice(0, 2),
  ]) + `<p class="adv-callout">${esc(tr(res.summary?.note || "Totals of the mapped sites only."))}</p>`;

  // --- national mix ---------------------------------------------------------------------------------------------
  const mixBody = section(el, { title: tr("The national power mix"), kicker: tr("Mapped sites above thresholds"), note: tr("Capacity of the power sites on the map, by type. Small plants are not mapped, so this is <b>not</b> the country's total generating capacity: it shows where the large sites are and what they run on.") });
  const mixParts = mwTypes.map((t) => ({ key: t.id, label: tr(t.name), value: nat[t.id]?.value || 0, color: t.color, text: mw(nat[t.id]?.value), icon: glyph(t, 14) })).sort((a, b) => b.value - a.value);
  const mixHover = (p) => {
    if (!p) { link.hover(null); bubbles.setSelected(null); return; }
    const set = new Set(visible().filter((it) => it.type === p.key).map((it) => it.idx));
    link.hover({ resources: set, dimOthers: true });
    bubbles.setSelected(new Set(visible().filter((it) => it.type === p.key).map((it) => it.key)));
  };
  const solo = (typeId) => {
    const only = st.on.size === 1 && st.on.has(typeId);
    st.on = only ? new Set(types.map((t) => t.id)) : new Set([typeId]);
    typeChips.set(st.on);
    apply();
  };
  shareBar(mixBody, { parts: mixParts, legend: false, onHover: mixHover, onClick: (p) => solo(p.key) });
  const mixBars = barList(mixBody, {
    rows: mixParts.map((p) => ({ ...p, sub: tr("{n} sites", { n: int(nat[p.key]?.count || 0) }) })),
    onHover: mixHover, onClick: (p) => solo(p.key), ariaLabel: tr("Mapped capacity by type"),
  });

  // --- filters --------------------------------------------------------------------------------------------------
  const fBody = section(el, { title: tr("Filter the map"), note: tr("Toggle types (Alt-click to show only one). The map dims the terrain and draws each power site as a circle sized by its capacity.") });
  const typeChips = chips(fBody, {
    label: tr("Resource types"),
    items: groups.flatMap((g) => g.types.map((t) => {
      const ty = typeById.get(t);
      return { key: t, label: tr(ty.name), color: ty.color, icon: glyph(ty, 13), count: nat[t]?.count ?? null };
    })),
    onChange: (on) => { st.on = on; apply(); },
  });
  const quick = document.createElement("div");
  quick.className = "adv-row";
  quick.innerHTML = groups.map((g) => `<button type="button" class="adv-mini" data-g="${g.id}">${esc(g.label)}</button>`).join("") +
    `<button type="button" class="adv-mini" data-g="all">${tr("All")}</button><button type="button" class="adv-mini" data-g="none">${tr("None")}</button>`;
  fBody.appendChild(quick);
  quick.addEventListener("click", (e) => {
    const g = e.target.closest("[data-g]")?.dataset.g;
    if (!g) return;
    st.on = g === "all" ? new Set(types.map((t) => t.id)) : g === "none" ? new Set() : new Set(groups.find((x) => x.id === g).types);
    typeChips.set(st.on);
    apply();
  });
  const slider = document.createElement("div");
  slider.className = "adv-slider";
  slider.innerHTML = `<label><span>${tr("Minimum size")}</span><input type="range" min="0" max="2000" step="100" value="0" aria-label="${esc(tr("Minimum power-site capacity in MW"))}"><b>${tr("Any size")}</b></label>`;
  fBody.appendChild(slider);
  const range = slider.querySelector("input");
  range.addEventListener("input", () => {
    st.min = +range.value;
    slider.querySelector("b").textContent = st.min ? `≥ ${int(st.min)} MW` : tr("Any size");
    apply();
  });
  const stateChip = document.createElement("div");
  stateChip.className = "adv-row adv-filterbar";
  fBody.appendChild(stateChip);
  stateChip.addEventListener("click", (e) => { if (e.target.closest("[data-clear-state]")) setState(null); });
  const legendBox = document.createElement("div");
  fBody.appendChild(legendBox);

  // --- top sites ------------------------------------------------------------------------------------------------
  const tBody = section(el, { title: tr("Sites"), note: tr("Every mapped site that passes the filters. Hover to find it on the map; click to fly there.") });
  const sizeSort = (r) => (isMW(r.type) && fin(r.value) ? r.value : null);
  const table = createTable(tBody, {
    caption: tr("Mapped resource sites"),
    search: tr("Search sites, provinces"),
    searchText: (r) => `${r.name} ${r.state || ""} ${r.detail || ""} ${tr(typeById.get(r.type)?.name || "")}`,
    rank: true,
    columns: [
      { key: "name", label: tr("Site"), align: "l", width: "minmax(0,1.7fr)", value: (r) => r.name, html: (r) => `<span class="ic">${glyph(typeById.get(r.type), 13)}</span>${esc(r.name)}` },
      { key: "type", label: tr("Type"), align: "l", width: "minmax(0,1fr)", value: (r) => tr(typeById.get(r.type)?.name), text: (r) => tr(typeById.get(r.type)?.name) || r.type },
      { key: "state", label: tr("Prov."), align: "l", width: "46px", value: (r) => r.state, text: (r) => r.state || "–" },
      { key: "value", label: tr("Size"), width: "minmax(0,.95fr)", value: sizeSort, text: (r) => sizeText(r), title: tr("Sort by capacity (MW; other units sort last)") },
    ],
    rows: [],
    sort: { key: "value", dir: "desc" },
    maxHeight: 300,
    onHover: (r) => {
      link.hover(r ? { resources: new Set([r.idx]), dimOthers: true, label: r.name } : null);
      bubbles.setHot(r ? r.key : null);
    },
    onClick: (r) => flyTo(r),
  });
  function sizeText(r) {
    const t = typeById.get(r.type);
    if (!fin(r.value)) return "–";
    if (t?.unit === "MW") return mw(r.value);
    if (t?.unit === "employees") return tr("{n} staff", { n: int(r.value) });
    if (/tons/.test(t?.unit || "")) return tr("{n} t/yr", { n: count3(r.value) });
    if (/km/.test(t?.unit || "")) return `${count3(r.value)} km²`;
    return fmtValue("float", r.value);
  }
  function flyTo(r) {
    focusPoint(app, r.x, r.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3.2)));
  }

  // --- per state ------------------------------------------------------------------------------------------------
  const sBody = section(el, { title: tr("Power by province"), note: tr("Mapped capacity per 2025 province, by type. Click a province to filter everything to it; click it again to clear.") });
  const stateRows = states
    .map((s, i) => ({ key: s.abbr, label: s.name, idx: i, parts: s.energy?.by_type || {}, total: s.energy?.total || 0, text: mw(s.energy?.total) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  const stacks = stackedBars(sBody, {
    rows: stateRows, keys: mwTypes.map((t) => ({ key: t.id, label: tr(t.name), color: t.color })), fmt: (v) => mw(v),
    ariaLabel: tr("Mapped power capacity by province"),
    onHover: (x) => {
      if (!x) return link.hover(null);
      const sIdx = x.row.idx;
      const set = x.part ? new Set(items.filter((it) => it.state === x.row.key && it.type === x.part).map((it) => it.idx)) : undefined;
      link.hover({ states: new Set([sIdx]), resources: set, dimOthers: true, label: x.part ? `${x.row.label}: ${tr(typeById.get(x.part)?.name) || x.part}` : x.row.label });
    },
    onClick: (x) => setState(st.state === x.row.key ? null : x.row.key, true),
  });
  const noPower = states.filter((s) => !(s.energy?.total > 0)).map((s) => s.abbr);
  if (noPower.length) sBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("No mapped power site: {list}.", { list: esc(noPower.join(", ")) })}</p>`);

  // --- explainer ------------------------------------------------------------------------------------------------
  const eBody = section(el, { title: tr("What the symbols mean"), note: tr("Each resource type, the threshold a site must pass to be mapped, and where the data comes from.") });
  eBody.innerHTML = groups.map((g) => `<h4 class="adv-h4">${esc(g.label)}</h4>${g.types.map((t) => {
    const ty = typeById.get(t);
    const s = nat[t] || {};
    const src = data.source(ty.source);
    const total = fin(s.value) ? (ty.unit === "MW" ? mw(s.value) : `${count3(s.value)} ${tr(ty.unit)}`) : ty.unit === "km² play area" ? tr("areas not additive") : "";
    return `<div class="adv-explain" style="--cc:${esc(ty.color)}"><span class="ic">${glyph(ty, 22)}</span><div>
      <b>${esc(tr(ty.name))}</b> <span class="sub">${tr("{n} mapped", { n: int(s.count || 0) })}${total ? ` · ${esc(total)}` : ""} · ${tr("measured in {unit}", { unit: esc(tr(ty.unit)) })}</span>
      <p>${esc(tr(ty.description))}</p><span class="src">${tr("Source: {src}", { src: esc(src ? `${tr(src.title)} (${tr(src.vintage || src.publisher)})` : ty.source) })}</span></div></div>`;
  }).join("")}`).join("");

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, ["gppd"], [
    "Only plants above each type's threshold are mapped (e.g. coal and gas plants of 300 MW or more, wind and solar summed per hex), so totals are <b>not</b> provincial or national capacity.",
    "The plant list dates from 2021: Vietnam's solar and wind boom of 2019–2021 is only partly in it, and plants built since are missing.",
    "Capacity (MW) is not how much electricity a plant produces: a 1,000 MW solar farm generates far less in a year than a 1,000 MW coal plant, and hydro output swings with the rains.",
    "A plant counts in the 2025 province whose hex it sits in.",
  ].map((c) => tr(c))));

  // --- map ------------------------------------------------------------------------------------------------------
  const bubbles = ctx.bubbles("sites", {
    rMax: 24,
    tip: (b) => {
      const it = b.it, t = typeById.get(it.type);
      return `<b>${esc(it.name)}</b><br>${esc(tr(t.name))} · <b>${esc(mw(it.value))}</b>${it.state ? ` · ${esc(it.state)}` : ""}${siteDetail(it) ? `<br><span class="sub">${siteDetailHtml(it)}</span>` : ""}`;
    },
    onHover: (b) => table.setHot(b ? b.key : null),
    onClick: (b) => { table.setHot(b.key); flyTo(b.it); },
  });

  function visible() {
    return items.filter((it) => st.on.has(it.type) && (!st.min || (isMW(it.type) && fin(it.value) && it.value >= st.min)) && (!st.state || it.state === st.state));
  }

  function setState(abbr, fly = false) {
    st.state = abbr;
    stacks.setSelected(abbr);
    apply();
    if (abbr && fly) {
      const b = app.highlightBounds({ states: new Set([stateIdx.get(abbr)]) });
      if (b) frameBox(app, b, { pad: 30, maxScale: 2.6 });
    }
  }

  function apply() {
    const typesOn = st.min ? new Set([...st.on].filter(isMW)) : st.on;
    const all = typesOn.size === types.length && !st.min;
    ctx.setResourceFilter(all ? null : { types: new Set(typesOn), minValue: st.min || undefined });
    const vis = visible();
    table.setRows(vis);
    const mwVis = vis.filter((it) => isMW(it.type) && fin(it.value));
    const vMax = Math.max(1, ...items.filter((it) => isMW(it.type) && fin(it.value)).map((it) => it.value));
    bubbles.set(mwVis.map((it) => ({ key: it.key, x: it.x, y: it.y, value: it.value, color: typeById.get(it.type).color, it })), { vMax });
    const sIdx = st.state ? stateIdx.get(st.state) : null;
    link.base({ dimOthers: true, states: sIdx != null ? new Set([sIdx]) : undefined });
    stateChip.innerHTML = st.state
      ? `<span class="adv-fchip">${tr("{kind}: <b>{name}</b> · {n} sites", { kind: kindOf(st.state), name: esc(states[sIdx]?.name || st.state), n: int(vis.length) })}<button type="button" data-clear-state aria-label="${esc(tr("Clear the province filter"))}">✕</button></span>`
      : "";
    const r = (v) => 24 * Math.sqrt(v / vMax);
    legendBox.innerHTML = sizeLegend([100, 500, 2000].filter((v) => v <= vMax * 1.2), r, (v) => `${int(v)} MW`, tr("Circle area = capacity"));
    mixBars.setSelected(st.on.size === 1 ? [...st.on][0] : null);
  }
  apply();

  return {
    onMapHover(h) {
      if (h.resource) {
        const it = items[res.items.indexOf(h.resource)];
        if (it) table.setHot(it.key);
      }
    },
    onEscape() {
      if (st.state) { setState(null); return true; }
      return false;
    },
    destroy() {},
  };
}
