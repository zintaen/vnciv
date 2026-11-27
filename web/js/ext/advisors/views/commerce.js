// Commerce advisor ("Master of Trade"): Vietnam's seaports and airports, and the road and rail network
// (infrastructure.json), plus the domestic air routes (trade.json, OpenFlights 2014) as its trade routes. Vietnam
// publishes no open freight-flow or port-tonnage data, so there are no freight routes.
import { esc, fin, el as mk } from "../core/util.js";
import { int, count3 } from "../core/fmt.js";
import { airportName } from "../../../format.js";
import { barList, sizeLegend } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, sourcesHtml } from "../core/view.js";
import { focusPoint, frameBox } from "../core/frame.js";
import { prepareRoutes } from "../../../render/art/improvements.js";
import { t as tr } from "../../../i18n.js";

const PORT_COLOR = "#4f9ad6", AIR_COLOR = "#e6cf86";
const HUB_SHORT = { L: tr("Major hub"), M: tr("Medium hub"), S: tr("Small hub"), N: tr("Local airport") };

export async function mount(ctx) {
  const { app, el, link, data } = ctx;
  const [infra, trade] = await Promise.all([app.loadData("infrastructure"), app.loadData("trade").catch(() => null)]);
  if (!infra) {
    el.innerHTML = `<p class="adv-empty pad">${tr("infrastructure.json is not built, so the Master of Trade has nothing to report.")}</p>`;
    return {};
  }
  const provName = (abbr) => data.levels.states.byKey.get(abbr)?.name || abbr || "–";
  const v = infra.vintage || {};
  const ports = (infra.ports || []).map((p) => ({ ...p, key: `p${p.id}` }));
  const airports = (infra.airports || []).map((a) => ({ ...a, key: `a${a.id}` })).sort((a, b) => (b.enplanements || 0) - (a.enplanements || 0));
  const totalPax = airports.reduce((s, a) => s + (a.enplanements || 0), 0);
  const topAir = airports[0];
  const portProvs = new Set(ports.map((p) => p.state).filter(Boolean));

  // --- headline -------------------------------------------------------------------------------------------------
  el.insertAdjacentHTML("beforeend", tiles([
    { label: tr("Seaports"), value: int(ports.length), sub: tr("in {n} provinces", { n: portProvs.size }) },
    { label: tr("Air passengers"), value: count3(totalPax), sub: `${tr("{n} airports, {year}", { n: airports.length, year: topAir?.year || "" })}${trade?.routes?.length && topAir ? ` · ${topAir.id} ${count3(topAir.enplanements)}` : ""}` },
    // With the air routes, the busiest airport moves into the passengers tile so the headline stays one row.
    trade?.routes?.length
      ? { label: tr("Air routes"), value: int(trade.routes.length), sub: tr("domestic, OpenFlights {year}", { year: esc(String(trade.year || 2014)) }) }
      : { label: tr("Busiest airport"), value: topAir ? count3(topAir.enplanements) : "–", sub: topAir ? tr("{id} passengers", { id: topAir.id }) : "" },
  ]));

  // --- ports ------------------------------------------------------------------------------------------------------
  let portTable = null, airBars = null, portBubbles = null, airBubbles = null;
  const pBody = section(el, { title: tr("Seaports"), kicker: esc(tr(v.ports || "")), note: tr("{rule} Hover a port to find it on the map; click to fly there.", { rule: esc(tr(infra.rules?.ports || "")) }) });
  const portHover = (p) => {
    link.hover(p ? { cells: new Set(p.cell != null ? [p.cell] : []), label: p.name } : null);
    portBubbles?.setHot(p ? p.key : null);
  };
  portTable = createTable(pBody, {
    caption: tr("Seaports"), maxHeight: 300, search: tr("Search ports"),
    searchText: (p) => `${p.name} ${provName(p.state)} ${p.state}`,
    columns: [
      { key: "name", label: tr("Port"), align: "l", width: "minmax(0,1.8fr)", value: (p) => p.name, text: (p) => p.name },
      { key: "prov", label: tr("Province"), align: "l", width: "minmax(0,1.2fr)", value: (p) => provName(p.state), text: (p) => provName(p.state) },
      { key: "type", label: tr("Type"), align: "l", value: (p) => p.type, text: (p) => (p.type ? tr(p.type) : "–"), hideBelow: 380 },
    ],
    rows: ports, sort: { key: "prov", dir: "asc" },
    onHover: (p) => portHover(p),
    onClick: (p) => flyTo(p),
  });

  // --- airports ---------------------------------------------------------------------------------------------------
  const aBody = section(el, { title: tr("Airports"), kicker: esc(tr(v.airports || "")), note: esc(tr(infra.rules?.airports || "")) });
  const airHover = (a) => {
    link.hover(a ? { cells: new Set(a.cell != null ? [a.cell] : []), label: `${a.id} · ${airportName(a.name)}` } : null);
    airBubbles?.setHot(a ? a.key : null);
  };
  airBars = barList(aBody, {
    rank: true, ariaLabel: tr("Busiest airports by passengers"),
    rows: airports.filter((a) => fin(a.enplanements)).map((a) => ({
      key: a.key, label: `${a.id} ${a.city || airportName(a.name)}`, full: airportName(a.name), value: a.enplanements,
      text: count3(a.enplanements), sub: HUB_SHORT[a.hub] || "", color: AIR_COLOR,
    })),
    onHover: (r) => airHover(r ? airports.find((a) => a.key === r.key) : null),
    onClick: (r) => flyTo(airports.find((a) => a.key === r.key)),
  });
  aBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("Passengers in {year}, arriving and departing.", { year: esc(String(topAir?.year || "")) })} ${Object.entries(infra.hubs || {}).map(([k, t]) => `<b>${esc(k)}</b> ${esc(tr(t))}`).join(" · ")}.</p>`);

  // --- air routes (trade.json) -------------------------------------------------------------------------------------
  const air = trade?.routes?.length ? airRoutes(ctx, trade) : null;

  // --- on the map -------------------------------------------------------------------------------------------------
  const mBody = section(el, { title: tr("On the map") });
  let show = "both";
  segmented(mBody, {
    label: tr("Show"), value: show,
    options: [{ value: "both", label: tr("Ports & airports") }, { value: "ports", label: tr("Ports") }, { value: "air", label: tr("Airports") }, { value: "none", label: tr("None") }],
    onChange: (x) => { show = x; drawSites(); },
  });
  const sizeBox = mk("div");
  mBody.appendChild(sizeBox);
  portBubbles = ctx.bubbles("ports", {
    rMax: 6, alpha: 0.7,
    tip: (b) => `<b>${esc(b.it.name)}</b><br>${tr("Seaport")} · ${esc(provName(b.it.state))}`,
    onHover: (b) => portTable?.setHot(b ? b.key : null, true),
    onClick: (b) => flyTo(b.it),
  });
  airBubbles = ctx.bubbles("airports", {
    rMax: 18, alpha: 0.5,
    tip: (b) => `<b>${esc(b.it.id)} · ${esc(b.it.name)}</b><br>${esc(tr(infra.hubs?.[b.it.hub] || "Airport"))} · ${tr("<b>{n}</b> passengers ({year})", { n: count3(b.it.enplanements), year: b.it.year })}`,
    onHover: (b) => airBars?.setHot(b ? b.key : null),
    onClick: (b) => { airBars?.setHot(b.key); flyTo(b.it); },
  });
  function drawSites() {
    const aMax = Math.max(1, ...airports.map((a) => a.enplanements || 0));
    portBubbles.set(show === "both" || show === "ports" ? ports.map((p) => ({ key: p.key, x: p.x, y: p.y, value: 1, color: PORT_COLOR, it: p })) : [], { vMax: 1 });
    airBubbles.set(show === "both" || show === "air" ? airports.filter((a) => fin(a.enplanements)).map((a) => ({ key: a.key, x: a.x, y: a.y, value: a.enplanements, color: AIR_COLOR, it: a })) : [], { vMax: aMax });
    sizeBox.innerHTML = (show === "both" || show === "ports" ? `<p class="adv-note"><span style="color:${PORT_COLOR}">●</span> ${tr("Seaports (all the same size: no tonnage is published).")}</p>` : "")
      + (show === "both" || show === "air" ? sizeLegend([1e6, 10e6, 40e6], (x) => 18 * Math.sqrt(x / aMax), (x) => count3(x), tr("Airports (gold): passengers")) : "");
  }
  drawSites();

  // --- roads and rail: the counts and rules (the map-art layers draw them; switches live in the Map menu) ----------
  const nBody = section(el, { title: tr("Roads and rails"), open: false });
  const nRoad = [0, 0], nRail = [0, 0];
  for (const r of infra.roads || []) nRoad[r[2]] = (nRoad[r[2]] || 0) + 1;
  for (const r of infra.rail || []) nRail[r[2]] = (nRail[r[2]] || 0) + 1;
  const toggles = (() => { try { return app.ui.mapToggles?.() || []; } catch { return []; } })();
  nBody.innerHTML = `<p class="adv-note">${(infra.road_classes || []).map((c, i) => `<b>${esc(tr(c.name))}</b>: ${tr("{n} hex links", { n: int(nRoad[i] || 0) })}`).join(" · ")}<br>${(infra.rail_tiers || []).map((c, i) => `<b>${esc(tr(c.name))}</b>: ${tr("{n} hex links", { n: int(nRail[i] || 0) })}`).join(" · ")}</p>
    <p class="adv-note">${esc(tr(infra.rules?.roads || ""))}</p><p class="adv-note">${esc(tr(infra.rules?.rail || ""))}</p>
    ${toggles.length ? `<p class="adv-note">${tr("Switch the road, rail and site art on or off from the <b>Map</b> menu beside Resources.")}</p>` : ""}`;

  function flyTo(p) {
    if (!p) return;
    focusPoint(app, p.x, p.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3)));
  }

  el.insertAdjacentHTML("beforeend", sourcesHtml(data, [...(infra.sources || ["natural_earth", "wikidata", "ourairports", "wikipedia_airports"]), ...(air ? trade.sources || ["openflights_routes"] : [])], [
    tr("Vietnam publishes no open port throughput (Vinamarine) or freight-flow statistics, so ports are listed, not ranked, and there are no freight routes."),
    ...(air ? [tr("The air routes are the OpenFlights route database as of June 2014, its last update: which airlines linked which airports then, with no passenger or cargo counts. Routes opened since 2014 are missing, and some listed then may have stopped.")] : []),
    tr("Ports are whatever Wikidata records as a port with coordinates: some terminals of one port appear separately, and some ports may be missing."),
    tr("Airport passengers are Airports Corporation of Vietnam figures as compiled on Wikipedia; some are rounded."),
    tr("Natural Earth roads and rails are map art, not statistics: a generalised alignment that lags new expressways."),
  ]));

  return {
    onMapHover(h) {
      air?.onMapHover(h);
      if (h.item?.kind === "port") portTable?.setHot(`p${h.item.data?.id}`, true);
      if (h.item?.kind === "airport") airBars?.setHot(`a${h.item.data?.id}`);
    },
    onMapClick(ev) {
      if (ev.item?.kind === "port" || ev.item?.kind === "airport") { flyTo(ev.item.data); return true; }
      return air?.onMapClick(ev) || false;
    },
    onEscape: () => air?.onEscape() || false,
  };
}

/**
 * The "Air routes" section: the routes table (rank, A ⇄ B, airlines, distance) and the cities with the most routes,
 * linked to the map (hover lights the route's arc, click pins it and frames it). The arcs are the map layer's own
 * geometry (prepareRoutes), so the highlight sits on the line the "Air routes" layer draws.
 */
function airRoutes(ctx, trade) {
  const { app, el, link, data } = ctx;
  const metros = data.levels.metros;
  const zoneById = new Map((trade.zones || []).map((z) => [z.id, z]));
  const zName = (id) => zoneById.get(id)?.short || zoneById.get(id)?.name || id;
  const arcs = prepareRoutes(app.w, trade);
  const arcOf = new Map(arcs.map((a) => [a.route, a]));
  const routes = (trade.routes || []).map((r) => ({ ...r, key: `r${r.rank}`, label: `${zName(r.a)} ⇄ ${zName(r.b)}`, arc: arcOf.get(r) || null, src: r }));
  // map item (the layer's own arc, {route: the trade.json record}) → our row
  const bySrc = new Map(routes.map((r) => [r.src, r]));
  const byRank = new Map(routes.map((r) => [r.rank, r]));
  const rowOfItem = (d) => bySrc.get(d?.route) || byRank.get(d?.route?.rank) || null;
  const st = { zone: null, route: null, hot: null };

  const body = section(el, {
    title: tr("Air routes"), kicker: esc(trade.vintage ? tr(trade.vintage) : tr("OpenFlights routes, June 2014")),
    note: `${esc(tr(trade.rule || ""))} ${esc(tr(trade.path_note || ""))} ${tr("Hover a route to light it up on the map; click to pin it.")}`,
  });
  const ctl = mk("div", "adv-row");
  body.appendChild(ctl);
  const layerBtn = mk("button", "adv-mini");
  layerBtn.type = "button";
  ctl.appendChild(layerBtn);
  const layerOn = () => { try { return !!app.ui.mapToggles?.().find((t) => t.id === "trade")?.on; } catch { return false; } };
  const drawBtn = () => { const on = layerOn(); layerBtn.textContent = on ? tr("Hide the routes on the map") : tr("Show the routes on the map"); layerBtn.setAttribute("aria-pressed", String(on)); };
  layerBtn.addEventListener("click", () => { app.ui.setMapToggle?.("trade", !layerOn()); drawBtn(); app.requestDraw(); });
  drawBtn();
  const fRow = mk("div", "adv-row adv-filterbar");
  body.appendChild(fRow);
  fRow.addEventListener("click", (e) => { if (e.target.closest("[data-clear-zone]")) setZone(null); });

  const zoneHighlight = (ids, label) => {
    const rows = ids.map((id) => metros.byKey.get(zoneById.get(id)?.anchor?.city || id)).filter(Boolean);
    return rows.length ? { ...metros.highlight(rows), label } : null;
  };
  const maxAir = Math.max(1, ...routes.map((r) => r.airlines || 0));
  const rTable = createTable(body, {
    caption: tr("Domestic air routes"), rank: false, maxHeight: 300, search: tr("Search routes, airports"),
    searchText: (r) => `${zoneById.get(r.a)?.name || r.a} ${zoneById.get(r.b)?.name || r.b} ${(r.airports || []).join(" ")} ${(r.airline_codes || []).join(" ")}`,
    columns: [
      { key: "rank", label: "#", width: "34px", value: (r) => r.rank, text: (r) => String(r.rank) },
      { key: "name", label: tr("Route"), align: "l", width: "minmax(0,2fr)", value: (r) => r.label, html: (r) => `${esc(r.label)} <span class="sub">${esc((r.airports || []).join("–"))}</span>`, tip: (r) => `${zoneById.get(r.a)?.name || r.a} ⇄ ${zoneById.get(r.b)?.name || r.b} (${(r.airports || []).join("–")})` },
      { key: "airlines", label: tr("Airlines"), width: "64px", value: (r) => r.airlines, text: (r) => int(r.airlines), tip: (r) => `${tr(r.airlines === 1 ? "{n} airline" : "{n} airlines", { n: int(r.airlines) })}: ${(r.airline_codes || []).join(", ") || "–"}`, bar: { max: maxAir, color: "rgba(24,169,154,.3)" }, title: tr("{what} (IATA codes)", { what: tr(trade.units?.airlines || "airlines flying the route") }) },
      { key: "dist", label: tr("Distance"), value: (r) => r.dist_km, text: (r) => (fin(r.dist_km) ? `${int(r.dist_km)} km` : "–"), hideBelow: 360, title: tr("Great-circle distance between the two airports") },
    ],
    rows: routes, sort: { key: "rank", dir: "asc" },
    onHover: (r) => { setHot(r); link.hover(r ? zoneHighlight([r.a, r.b], r.label) : null); },
    onClick: (r) => selectRoute(r),
  });

  // Zones: the cities with the most routes among these 30.
  const nRoutes = new Map();
  for (const r of routes) for (const z of [r.a, r.b]) nRoutes.set(z, (nRoutes.get(z) || 0) + 1);
  const zones = (trade.zones || []).map((z) => ({ ...z, key: z.id, n: nRoutes.get(z.id) || 0 }));
  body.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${tr("Cities with the most routes")}</h4>`);
  const zTable = createTable(body, {
    caption: tr("Cities with the most air routes"), rank: true, maxHeight: 240,
    columns: [
      { key: "name", label: tr("City"), align: "l", width: "minmax(0,1.6fr)", value: (z) => z.short || z.name, html: (z) => `${esc(z.short || z.name)} <span class="sub">${esc((z.airports || []).join(" "))}</span>`, tip: (z) => `${z.name}: ${(z.partners || []).map(([id, n]) => `${zName(id)} (${n})`).join(", ")}` },
      { key: "n", label: tr("Routes"), value: (z) => z.n, text: (z) => int(z.n), bar: { max: Math.max(1, ...zones.map((z) => z.n)), color: "rgba(24,169,154,.3)" } },
    ],
    rows: zones, sort: { key: "n", dir: "desc" },
    onHover: (z) => link.hover(z ? zoneHighlight([z.id], z.name) : null),
    onClick: (z) => setZone(st.zone === z.id ? null : z.id),
  });
  body.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr("Click a city to list only its routes; click it again (or Esc) to show them all.")}</p>`);

  function setZone(id) {
    st.zone = id;
    rTable.setRows(id ? routes.filter((r) => r.a === id || r.b === id) : routes);
    zTable.setSelected(id ? new Set([id]) : null);
    const h = id ? zoneHighlight([id], zoneById.get(id)?.name) : null;
    link.base(h ? { ...h, dimOthers: true } : null);
    fRow.innerHTML = id ? `<span class="adv-fchip">${tr("City: <b>{name}</b> · {n} routes", { name: esc(zName(id)), n: nRoutes.get(id) || 0 })}<button type="button" data-clear-zone aria-label="${esc(tr("Clear the city filter"))}">✕</button></span>` : "";
  }
  function setHot(r) { if (st.hot !== r) { st.hot = r || null; app.requestDraw(); } }
  function selectRoute(r) {
    st.route = st.route === r ? null : r;
    rTable.setSelected(st.route ? new Set([st.route.key]) : null);
    app.requestDraw();
    const b = st.route?.arc?.bbox;
    if (b) { const R = app.w.grid.R * 3; frameBox(app, { x0: b[0] - R, y0: b[1] - R, x1: b[2] + R, y1: b[3] + R }, { pad: 40, maxScale: 2.6 }); }
  }

  // The hovered (or pinned) route drawn in gold over the map, with its two ends, whether or not the layer is on.
  const off = app.registerOverlay({
    id: "adv-commerce-air", z: 18, space: "world",
    draw(c, cam) {
      const r = st.hot || st.route;
      if (!r?.arc) return;
      const s = cam.scale;
      c.save();
      c.lineCap = "round";
      c.strokeStyle = "rgba(10,8,4,.9)";
      c.lineWidth = 7 / s;
      c.stroke(r.arc.path);
      c.strokeStyle = "#ffd36a";
      c.lineWidth = 3.5 / s;
      c.stroke(r.arc.path);
      const e = r.arc.ends;
      for (let k = 0; k < 4; k += 2) {
        c.beginPath();
        c.arc(e[k], e[k + 1], 5 / s, 0, Math.PI * 2);
        c.fillStyle = "#fff3c4";
        c.fill();
        c.lineWidth = 1.5 / s;
        c.stroke();
      }
      c.restore();
    },
  });
  ctx.cleanup(off);

  return {
    onMapHover(h) {
      const r = h.item?.kind === "route" ? rowOfItem(h.item.data) : null;
      rTable.setHot(r ? r.key : null, !!r);
      const m = !r && h.cell >= 0 ? metros.rowAtCell(h.cell) : null;
      zTable.setHot(m && zoneById.has(m.key) ? m.key : null, false);
    },
    onMapClick(ev) {
      const r = ev.item?.kind === "route" ? rowOfItem(ev.item.data) : null;
      if (r) { selectRoute(r); return true; }
      return false;
    },
    onEscape() {
      if (st.route) { selectRoute(st.route); return true; }
      if (st.zone) { setZone(null); return true; }
      return false;
    },
  };
}
