// Military advisor ("General"): People's Army sites mapped in OpenStreetMap as military land (military.json):
// installations by branch and tier, provinces, restricted ground and Encampment cities. Vietnam publishes no troop,
// spending or veteran figures, so the US version's headcount and dollar sections have nothing to show here.
import { esc, fin, el as mk } from "../core/util.js";
import { fixed, int } from "../core/fmt.js";
import { stackedBars, swatchLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, chips, segmented, sourcesHtml } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { t as tr } from "../../../i18n.js";
import { kindOf } from "../../../format.js";

const COMP_COLOR = { army: "#7d9a46", navy: "#3f6fc2", air_force: "#6fb3e0", other: "#d6b04a" };
const COMP_SHORT = { army: tr("Ground"), navy: tr("Navy"), air_force: tr("Air Def.–AF"), other: tr("Border & other") };
const TIER_LABEL = { major: tr("Major"), base: tr("Base"), site: tr("Site") };
const TIER_COLOR = { major: "#c24a3e", base: "#d9a457", site: "#9a9aa8" };
const km2 = (v) => (fin(v) ? `${v >= 10 ? int(v) : fixed(v, v >= 1 ? 1 : 2)} km²` : "–");

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const mil = app.data.military || (await app.loadData("military").catch(() => null));
  if (!mil) {
    el.innerHTML = `<p class="adv-empty pad">${tr("military.json is not built, so the General has nothing to report.")}</p>`;
    return {};
  }
  const { states: stLevel, metros } = data.levels;
  const comps = (mil.components || []).map((c) => ({ ...c, color: COMP_COLOR[c.id] || "#9a9aa8", short: COMP_SHORT[c.id] || tr(c.name) }));
  const compById = new Map(comps.map((c) => [c.id, c]));
  const insts = (mil.installations || []).map((it) => ({ ...it, key: it.id }));
  const instByKey = new Map(insts.map((it) => [it.key, it]));
  const nat = mil.national || {};
  const provName = (abbr) => stLevel.byKey.get(abbr)?.name || abbr || "–";
  const instCells = (it) => (it.cells?.length ? it.cells : it.cell != null ? [it.cell] : []);
  const cellInst = new Map();
  for (const it of insts) for (const c of instCells(it)) if (!cellInst.has(c)) cellInst.set(c, it);
  const st = { comps: new Set(comps.map((c) => c.id)), tier: "all", state: null };

  // --- headline -------------------------------------------------------------------------------------------------
  const camps = Object.values(mil.cities || {});
  const forts = camps.filter((c) => c.tier === "fortress").length;
  el.insertAdjacentHTML("beforeend", tiles([
    { label: tr("Installations"), value: int(nat.installations ?? insts.length), sub: tr("{n} major (10 km²+), mapped in OpenStreetMap", { n: int(nat.by_tier?.major ?? 0) }) },
    { label: tr("Mapped area"), value: km2(nat.area_km2), sub: tr("inside the outlines") },
    { label: tr("Encampment cities"), value: int(camps.length), sub: tr("{forts} fortresses, {garrisons} garrisons", { forts, garrisons: camps.length - forts }) },
  ]) + `<p class="adv-callout">${tr("Vietnam publishes no troop numbers, defence spending or veteran counts by province, so the General can only report what volunteers have mapped: sites are sized by the land inside their outline, never by headcount.")}</p>`);

  // --- forts on the map -----------------------------------------------------------------------------------------
  const tRow = mk("div", "adv-sec adv-mapsec adv-row");
  el.appendChild(tRow);
  const fortBtn = mk("button", "adv-mini");
  fortBtn.type = "button";
  tRow.appendChild(fortBtn);
  const fortsOn = () => { try { return !!app.ui.mapToggles?.().find((t) => t.id === "military")?.on; } catch { return false; } };
  const drawFortBtn = () => {
    const on = fortsOn();
    fortBtn.textContent = on ? tr("Hide forts on the map") : tr("Show forts on the map");
    fortBtn.setAttribute("aria-pressed", String(on));
  };
  fortBtn.addEventListener("click", () => { app.ui.setMapToggle?.("military", !fortsOn()); drawFortBtn(); app.requestDraw?.(); });
  drawFortBtn();

  // --- by branch and tier ---------------------------------------------------------------------------------------
  const bBody = section(el, { title: tr("By branch and tier"), note: `${esc(tr(mil.rules?.components || ""))} ${esc(tr(mil.rules?.tier || ""))}` });
  const tierKeys = ["major", "base", "site"].map((k) => ({ key: k, label: TIER_LABEL[k], color: TIER_COLOR[k] }));
  const branchRows = comps.map((c) => {
    const parts = { major: 0, base: 0, site: 0 };
    for (const it of insts) if (it.component === c.id) parts[it.tier] = (parts[it.tier] || 0) + 1;
    const total = parts.major + parts.base + parts.site;
    return { key: c.id, label: c.short, parts, total, text: int(total) };
  }).filter((r) => r.total);
  const branchBars = stackedBars(bBody, {
    rows: branchRows, keys: tierKeys, fmt: (v) => int(v), ariaLabel: tr("Installations by branch and tier"),
    onHover: (x) => {
      if (!x) return link.hover(null);
      const set = insts.filter((it) => it.component === x.row.key && (!x.part || it.tier === x.part));
      link.hover({ cells: new Set(set.flatMap(instCells)), dimOthers: true, label: `${x.row.label}${x.part ? ` · ${TIER_LABEL[x.part]}` : ""}: ${tr("{n} sites", { n: set.length })}` });
    },
    onClick: (x) => {
      const only = st.comps.size === 1 && st.comps.has(x.row.key);
      st.comps = only ? new Set(comps.map((c) => c.id)) : new Set([x.row.key]);
      compChips.set(st.comps);
      apply();
    },
  });
  bBody.insertAdjacentHTML("beforeend", swatchLegend(tierKeys) + `<p class="adv-note">${tr("Click a branch to list only its sites below.")}</p>`);

  // --- installations --------------------------------------------------------------------------------------------
  const iBody = section(el, {
    title: tr("Largest installations"), kicker: tr(mil.vintage?.installations || "OpenStreetMap"),
    note: tr("{rule} Hover a row to find it on the map; click to fly there.", { rule: esc(tr(mil.rules?.installations || "")) }),
  });
  const counts = new Map();
  for (const it of insts) counts.set(it.component, (counts.get(it.component) || 0) + 1);
  const compChips = chips(iBody, {
    label: tr("Branches"),
    items: comps.filter((c) => counts.get(c.id)).map((c) => ({ key: c.id, label: c.short, color: c.color, count: counts.get(c.id) })),
    onChange: (on) => { st.comps = on; apply(); },
  });
  const sRow = mk("div", "adv-row");
  iBody.appendChild(sRow);
  segmented(sRow, {
    label: tr("Size"), value: st.tier,
    options: [{ value: "major", label: tr("Major") }, { value: "big", label: tr("Major & bases") }, { value: "all", label: tr("Every site") }],
    onChange: (v) => { st.tier = v; apply(); },
  });
  const stateChip = mk("div", "adv-row adv-filterbar");
  iBody.appendChild(stateChip);
  stateChip.addEventListener("click", (e) => { if (e.target.closest("[data-clear-state]")) setState(null); });
  const instTip = (r) => `${r.name} · ${tr(compById.get(r.component)?.name || r.component)}${r.parts?.length ? ` · ${tr("also: {list}", { list: r.parts.join(", ") })}` : ""}`;
  const instTable = createTable(iBody, {
    caption: tr("Military installations"), search: tr("Search installations, provinces"), rank: true, maxHeight: 300,
    searchText: (r) => `${r.name} ${provName(r.state)} ${r.state} ${compById.get(r.component)?.name || ""}`,
    columns: [
      { key: "name", label: tr("Installation"), align: "l", width: "minmax(0,1.9fr)", value: (r) => r.name, html: (r) => `<i class="dot" style="background:${esc(compById.get(r.component)?.color || "#999")}"></i>${esc(r.name)}`, tip: instTip },
      { key: "component", label: tr("Branch"), align: "l", width: "minmax(0,.9fr)", hideBelow: 400, value: (r) => compById.get(r.component)?.short, text: (r) => compById.get(r.component)?.short || r.component },
      { key: "tier", label: tr("Tier"), align: "l", width: "46px", value: (r) => ({ major: 0, base: 1, site: 2 })[r.tier], text: (r) => TIER_LABEL[r.tier] || r.tier },
      { key: "state", label: tr("Province"), align: "l", width: "minmax(0,1fr)", value: (r) => provName(r.state), text: (r) => provName(r.state) },
      { key: "area", label: tr("Area"), width: "minmax(0,.8fr)", value: (r) => r.area_km2, text: (r) => km2(r.area_km2), title: tr("Land inside the mapped outline (– : mapped as a point)") },
    ],
    rows: [], sort: { key: "area", dir: "desc" },
    onHover: (r) => link.hover(r ? { cells: new Set(instCells(r)), label: r.name } : null),
    onClick: (r) => flyTo(r),
  });
  function flyTo(r) {
    if (r.cells && r.cells.length > 2) {
      const b = app.highlightBounds({ cells: new Set(r.cells) });
      if (b) return frameBox(app, b, { pad: 60, maxScale: 3 });
    }
    focusPoint(app, r.x, r.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3)));
  }

  // --- provinces ------------------------------------------------------------------------------------------------
  const pBody = section(el, { title: tr("By province"), note: tr("Mapped installations and the land inside their outlines, by the 2025 province that holds them. Click a province to list only its sites above.") });
  const provRows = Object.entries(mil.states || {}).map(([abbr, s]) => ({ ...s, key: abbr, row: stLevel.byKey.get(abbr) })).filter((p) => p.row);
  const maxN = Math.max(1, ...provRows.map((p) => p.installations || 0));
  const pTable = createTable(pBody, {
    caption: tr("Installations by province"), rank: true, maxHeight: 280, search: tr("Search provinces"),
    searchText: (p) => p.row.name,
    columns: [
      { key: "name", label: tr("Province"), align: "l", width: "minmax(0,1.6fr)", value: (p) => p.row.name, text: (p) => p.row.name },
      { key: "n", label: tr("Installations"), value: (p) => p.installations, text: (p) => int(p.installations), bar: { max: maxN, color: "rgba(135,150,171,.35)" } },
      { key: "area", label: tr("Mapped area"), value: (p) => p.area_km2, text: (p) => km2(p.area_km2) },
    ],
    rows: provRows, sort: { key: "n", dir: "desc" },
    onHover: (p) => link.hover(p ? rowsHighlight(stLevel, [p.row], { dim: true }) : null),
    onClick: (p) => setState(st.state === p.key ? null : p.key, true),
  });

  // --- restricted ground ----------------------------------------------------------------------------------------
  const rBody = section(el, { title: tr("Restricted ground"), note: tr("{rule} Hover to outline it; click to fly there.", { rule: esc(tr(mil.rules?.ranges || "")) }) });
  const ranges = (mil.ranges || []).map((r) => ({ ...r, key: r.id }));
  const rTable = createTable(rBody, {
    caption: tr("Largest restricted areas"), rank: true, maxHeight: 240,
    columns: [
      { key: "name", label: tr("Area"), align: "l", width: "minmax(0,2fr)", value: (r) => r.name, html: (r) => `<i class="dot" style="background:${esc(compById.get(r.component)?.color || "#999")}"></i>${esc(r.name)}` },
      { key: "state", label: tr("Province"), align: "l", width: "minmax(0,1fr)", value: (r) => provName(r.state), text: (r) => provName(r.state) },
      { key: "area", label: tr("Size"), width: "minmax(0,.9fr)", value: (r) => r.area_km2, text: (r) => km2(r.area_km2), bar: { max: Math.max(...ranges.map((r) => r.area_km2 || 0), 1), color: "rgba(194,74,62,.3)" } },
    ],
    rows: ranges, sort: { key: "area", dir: "desc" },
    onHover: (r) => link.hover(r ? { cells: new Set(r.cells || []), dimOthers: true, color: "#f09a7f", label: r.name } : null),
    onClick: (r) => { const it = instByKey.get(r.installation); if (it) return flyTo(it); const b = app.highlightBounds({ cells: new Set(r.cells || []) }); if (b) frameBox(app, b, { pad: 60, maxScale: 2.6 }); },
  });

  // --- encampment cities ----------------------------------------------------------------------------------------
  const gBody = section(el, { title: tr("Encampment cities"), note: esc(tr(mil.rules?.encampment || mil.rule || "")) });
  const garrisons = Object.entries(mil.cities || {}).map(([id, c]) => ({ ...c, key: id, row: metros.byKey.get(id) })).filter((g) => g.row);
  const instNames = (g) => (g.installations || []).map((id) => instByKey.get(id)?.name).filter(Boolean).join(", ");
  const gTable = createTable(gBody, {
    caption: tr("Encampment cities"), rank: true, maxHeight: 250,
    columns: [
      { key: "name", label: tr("City"), align: "l", width: "minmax(0,1.3fr)", value: (g) => g.row.name, html: (g) => `${esc(g.row.name)} <span class="sub">${esc(g.row.sub)}</span>`, tip: (g) => `${g.row.name}: ${instNames(g)}` },
      { key: "tier", label: tr("Tier"), align: "l", width: "minmax(0,.8fr)", value: (g) => (g.tier === "fortress" ? 0 : 1), text: (g) => `${g.tier === "fortress" ? tr("Fortress") : tr("Garrison")}${g.naval ? " ⚓" : ""}` },
      { key: "inst", label: tr("Qualifying sites"), align: "l", width: "minmax(0,1.9fr)", hideBelow: 380, value: (g) => g.installation_count, text: instNames },
    ],
    rows: garrisons, sort: { key: "tier", dir: "asc" },
    onHover: (g) => link.hover(g ? rowsHighlight(metros, [g.row]) : null),
    onClick: (g) => metros.focus(g.row),
  });
  gBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("⚓ naval: a naval base is among the qualifying sites. Click a city to open it; its City View shows the Encampment district.")}</p>`);

  // --- rules ----------------------------------------------------------------------------------------------------
  const rulesBody = section(el, { title: tr("How the map is built"), open: false });
  const RULE_LABEL = { installations: tr("Installations"), tier: tr("Tiers"), components: tr("Branches"), ranges: tr("Restricted ground"), encampment: tr("Encampment"), names: tr("Names") };
  rulesBody.innerHTML = Object.entries(mil.rules || {}).map(([k, t]) => `<p class="adv-note"><b>${esc(RULE_LABEL[k] || k)}:</b> ${esc(tr(t))}</p>`).join("");

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, mil.sources || ["osm_military"], [
    esc(tr(mil.caveats || "")),
    tr("Tiers come from the mapped outline only: a 'major' range can hold few people, a small headquarters many."),
    tr("Province totals follow where each site's point lies; restricted ground is drawn on the hexes whose centre it covers."),
  ].filter(Boolean)));

  // --- filters ----------------------------------------------------------------------------------------------------
  function visible() {
    return insts.filter((it) => st.comps.has(it.component) && (st.tier === "all" || it.tier === "major" || (st.tier === "big" && it.tier === "base")) && (!st.state || it.state === st.state));
  }
  function setState(abbr, fly = false) {
    st.state = abbr;
    pTable.setSelected(abbr ? new Set([abbr]) : null);
    apply();
    const row = abbr ? stLevel.byKey.get(abbr) : null;
    if (row && fly) {
      const b = app.highlightBounds({ states: new Set([row.ref]) });
      if (b) frameBox(app, b, { pad: 30, maxScale: 2.6 });
    }
  }
  function apply() {
    const vis = visible();
    instTable.setRows(vis);
    const row = st.state ? stLevel.byKey.get(st.state) : null;
    link.base(row ? { states: new Set([row.ref]), dimOthers: true } : null);
    stateChip.innerHTML = st.state
      ? `<span class="adv-fchip">${tr("{kind}: <b>{name}</b> · {n} sites", { kind: kindOf(st.state), name: esc(provName(st.state)), n: int(vis.length) })}<button type="button" data-clear-state aria-label="${esc(tr("Clear the province filter"))}">✕</button></span>`
      : "";
  }
  apply();

  return {
    onMapHover(h) {
      const prov = h.cell >= 0 ? stLevel.rowAtCell(h.cell) : null;
      pTable.setHot(prov && mil.states?.[prov.key] ? prov.key : null, false);
      const inst = h.item?.kind === "fort" ? instByKey.get(h.item.data?.id) : h.cell >= 0 ? cellInst.get(h.cell) : null;
      instTable.setHot(inst ? inst.key : null, !!inst);
      branchBars.setHot(inst ? inst.component : null);
      rTable.setHot(h.item?.kind === "range" ? h.item.data?.id ?? null : null, h.item?.kind === "range");
      const m = h.cell >= 0 ? metros.rowAtCell(h.cell) : null;
      gTable.setHot(m && mil.cities?.[m.key] ? m.key : null, false);
    },
    onMapClick(ev) {
      const fort = ev.item?.kind === "fort" ? instByKey.get(ev.item.data?.id) : null;
      if (fort) { instTable.setHot(fort.key, true); flyTo(fort); return true; }
      // A click on a province (not a city) filters the sites to it; a second click clears it.
      if (ev.city || ev.state == null) return false;
      const abbr = stLevel.rows[ev.state]?.key;
      if (!abbr) return false;
      setState(st.state === abbr ? null : abbr);
      return true;
    },
    onEscape() {
      if (st.state) { setState(null); return true; }
      return false;
    },
  };
}
