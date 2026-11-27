// Culture advisor ("Keeper of Wonders"): wonders by published rule (wonders.json: World Heritage sites, national parks,
// universities, landmarks) and the typhoons places endure (disasters.json: IBTrACS tracks near Vietnam).
import { esc, fin, el as mk } from "../core/util.js";
import { int } from "../core/fmt.js";
import { barList } from "../core/charts.js";
import { createTable } from "../core/table.js";
import { section, tiles, segmented, mapPicker, sourcesHtml } from "../core/view.js";
import { rowsHighlight } from "../core/data.js";
import { frameBox, focusPoint } from "../core/frame.js";
import { t as tr, lang } from "../../../i18n.js";

const KIND = {
  natural: { label: tr("Nature"), color: "#6aa84f" },
  university: { label: tr("Universities"), color: "#4a86d6" },
  landmark: { label: tr("Landmarks"), color: "#e0b54c" },
};
const RULE_TITLE = { world_heritage: tr("World Heritage sites"), national_park: tr("National parks"), research_university: tr("National and regional universities"), landmark: tr("Landmarks") };

export async function mount(ctx) {
  const { app, data, el, link } = ctx;
  const disastersP = app.loadData("disasters").catch(() => null); // lazy: only this advisor needs it
  const won = await app.loadData("wonders");
  const { states: stLevel, counties } = data.levels;
  const lensDis = app.lensById?.get("disasters");

  // --- headline -------------------------------------------------------------------------------------------------
  const wonders = (won?.wonders || []).map((w) => ({ ...w, key: w.id, short: (lang !== "vi" && w.short_en) || w.short }));
  const byKind = (k) => wonders.filter((w) => w.kind === k).length;
  const byRule = (id) => wonders.filter((w) => w.rule === id).length;
  const tileEl = mk("div");
  el.appendChild(tileEl);
  const drawTiles = (dis) => {
    const t = dis?.typhoons;
    tileEl.innerHTML = tiles([
      { label: tr("Wonders"), value: int(wonders.length), sub: tr("{parks} national parks · {unis} universities · {marks} landmarks", { parks: byRule("national_park"), unis: byRule("research_university"), marks: byRule("landmark") }) },
      { label: tr("World Heritage"), value: int(byRule("world_heritage")), sub: tr("UNESCO sites") },
      t?.national
        ? { label: tr("Typhoons"), value: int(t.national.storms), sub: tr("storms since {since} · {n} of typhoon strength", { since: t.since, n: int(t.national.strong) }) }
        : { label: tr("Typhoons"), value: "…", sub: tr("reading the tracks") },
    ]);
  };
  drawTiles(null);

  // --- map colour -----------------------------------------------------------------------------------------------
  const mapRow = mk("div", "adv-sec adv-mapsec");
  el.appendChild(mapRow);
  const picker = mapPicker(ctx, mapRow, {
    value: "terrain",
    options: [
      { value: "terrain", label: tr("Terrain"), lens: () => null },
      ...(lensDis ? [{ value: "dis", label: tr("Typhoons"), lens: () => "disasters" }] : []),
    ],
  });

  // --- wonders --------------------------------------------------------------------------------------------------
  let wonderBars = [];
  const bubbles = ctx.bubbles("wonders", {
    rMax: 9, minR: 9, alpha: 0.28,
    tip: (b) => `<b>${esc(b.it.name)}</b><br>${esc(RULE_TITLE[b.it.rule] || b.it.kind)} #${esc(b.it.rank)} · ${esc(metricText(b.it))}${b.it.curated ? `<br><span class="sub">${esc(tr("hand-picked, not ranked by data"))}</span>` : ""}`,
    onHover: (b) => { for (const w of wonderBars) w.setHot(b ? b.key : null); },
    onClick: (b) => flyTo(b.it),
  });
  if (won && wonders.length) {
    const wBody = section(el, { title: tr("Wonders"), kicker: tr("Each chosen by a published rule"), note: tr("Hover a wonder to find it on the map; click to fly there. World Heritage sites are listed by year of inscription, national parks by area, universities national first, then regional; landmarks are a hand-picked list.") });
    let kind = "all";
    segmented(wBody, {
      label: tr("Kind"), value: kind,
      options: [{ value: "all", label: tr("All") }, ...Object.entries(KIND).filter(([k]) => byKind(k)).map(([k, v]) => ({ value: k, label: v.label }))],
      onChange: (v) => { kind = v; drawWonders(); },
    });
    const wHost = mk("div");
    wBody.appendChild(wHost);
    function drawWonders() {
      wHost.innerHTML = "";
      wonderBars = [];
      const vis = wonders.filter((w) => kind === "all" || w.kind === kind);
      for (const rule of won.rules || []) {
        const list = vis.filter((w) => w.rule === rule.id);
        if (!list.length) continue;
        wHost.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${esc(RULE_TITLE[rule.id] || rule.id)}</h4><p class="adv-note adv-rule">${esc(tr(rule.text))}</p>`);
        const host = mk("div");
        wHost.appendChild(host);
        const val = (w) => (w.rule === "national_park" ? w.metrics?.area_km2 ?? null : null);
        wonderBars.push(barList(host, {
          rank: !(rule.curated || w0curated(list)), compact: true, ariaLabel: RULE_TITLE[rule.id] || rule.id,
          rows: list.map((w) => ({ key: w.key, label: w.short || w.name, full: w.name, sub: w.state, value: val(w), text: metricText(w), color: KIND[w.kind]?.color })),
          onHover: (r) => {
            const w = r ? wonders.find((x) => x.key === r.key) : null;
            link.hover(w ? { cells: new Set(w.cells && w.cells.length ? w.cells : w.cell != null ? [w.cell] : []), label: w.short || w.name } : null);
            bubbles.setHot(w ? w.key : null);
          },
          onClick: (r) => flyTo(wonders.find((x) => x.key === r.key)),
        }));
      }
      bubbles.set(vis.filter((w) => fin(w.x) && fin(w.y)).map((w) => ({ key: w.key, x: w.x, y: w.y, value: 1, color: KIND[w.kind]?.color || "#ccc", it: w })), { vMax: 1 });
    }
    drawWonders();
    wBody.insertAdjacentHTML("beforeend", `<p class="adv-note">${tr('Map markers: <i class="dot" style="background:{c1}"></i>natural · <i class="dot" style="background:{c2}"></i>university · <i class="dot" style="background:{c3}"></i>landmark.', { c1: KIND.natural.color, c2: KIND.university.color, c3: KIND.landmark.color })}</p>`);
  } else el.insertAdjacentHTML("beforeend", `<p class="adv-empty pad">${esc(tr("wonders.json is not built."))}</p>`);
  function flyTo(w) {
    if (!w) return;
    if (w.cells && w.cells.length > 2) {
      const b = app.highlightBounds({ cells: new Set(w.cells) });
      if (b) return frameBox(app, b, { pad: 60, maxScale: 3 });
    }
    focusPoint(app, w.x, w.y, Math.min(app.cam.maxScale, Math.max(app.cam.scale, (app.cam.fitScale || 1) * 3.2)));
  }

  // --- typhoons (lazy) -----------------------------------------------------------------------------------------
  const dSec = section(el, { title: tr("Typhoons"), kicker: tr("IBTrACS storm tracks") });
  dSec.innerHTML = `<p class="adv-loading">${esc(tr("Reading the storm tracks…"))}</p>`;
  const srcEl = mk("div");
  el.appendChild(srcEl);
  const drawSources = (dis) => {
    srcEl.innerHTML = sourcesHtml(data, [...(won?.sources || []), ...(dis?.sources || ["ibtracs"])], [
      tr("Wonders come from Wikidata, so a site's coordinates and the list of parks are only as good as Wikidata's records. Landmarks are an editorial choice."),
      tr("Vietnam publishes no visitor counts per park or site, so wonders are not ranked by visits."),
      tr("A storm counts for a place when its best track passed within {km} km of it: a count of storms that came close, not of damage. Floods and landslides from storms that stayed offshore are not counted.", { km: Number(dis?.typhoons?.radius_km) || 100 }),
      tr("Former-province counts are the mean over the province's hexes, so a large province reads lower than its most exposed coast."),
    ]);
  };
  drawSources(null);
  let dState = null, dCounty = null;
  // The storm records arrive after the rest of the dashboard is up (the view may be gone by then).
  disastersP.then((dis) => {
    if (!active()) return;
    if (!dis?.typhoons) dSec.innerHTML = `<p class="adv-empty">${esc(tr("disasters.json is not built."))}</p>`;
    else drawTyphoons(dis.typhoons);
    drawTiles(dis);
    drawSources(dis);
  });

  const provHighlight = (abbrs, label) => {
    const idx = abbrs.map((a) => stLevel.byKey.get(a)?.ref).filter((i) => i != null);
    return idx.length ? { states: new Set(idx), dimOthers: true, label } : null;
  };
  function drawTyphoons(T) {
    dSec.innerHTML = `<p class="adv-note">${esc(tr(T.rule || ""))}</p>`;
    const nat = T.national || {};
    const years = nat.by_year || [];
    if (years.length) {
      dSec.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${esc(tr("Storms near Vietnam per year, {from}–{to}", { from: years[0].year, to: years[years.length - 1].year }))}</h4>`);
      dSec.appendChild(columnChart(years, (y) => y.storms, (y) => tr("{year}: {n} storms", { year: y.year, n: y.storms })));
    }
    // Provinces.
    const sRows = Object.entries(T.states || {}).map(([a, x]) => ({ key: a, name: stLevel.byKey.get(a)?.name || a, row: stLevel.byKey.get(a), total: x.total, strong: x.strong }));
    dSec.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${esc(tr("By province"))}</h4>`);
    dState = createTable(dSec, {
      caption: tr("Typhoons by province"), rank: true, maxHeight: 240, search: tr("Search provinces"),
      rows: sRows,
      columns: [
        { key: "name", label: tr("Province"), align: "l", width: "minmax(0,1.5fr)", value: (r) => r.name, text: (r) => r.name },
        { key: "total", label: tr("Storms"), value: (r) => r.total, text: (r) => int(r.total), bar: { max: Math.max(1, ...sRows.map((r) => r.total || 0)), color: "rgba(79,154,214,.35)" }, title: tr("Tropical storms or stronger within {km} km since {since}", { km: T.radius_km, since: T.since }) },
        { key: "strong", label: tr("Typhoons"), value: (r) => r.strong, text: (r) => int(r.strong), title: tr("Of typhoon strength ({kt}+ kt)", { kt: T.strong_kt }) },
      ],
      sort: { key: "total", dir: "desc" },
      onHover: (r) => link.hover(r?.row ? rowsHighlight(stLevel, [r.row], { dim: true }) : null),
      onClick: (r) => { picker.set("dis"); if (r.row) stLevel.focus(r.row); },
    });
    // Former provinces.
    const cc = T.counties?.columns || [];
    const ci = Object.fromEntries(cc.map((k, j) => [k, j]));
    if (counties && cc.length) {
      const rows = (T.counties.rows || []).map((x) => ({ x, r: counties.byKey.get(x[ci.geoid]) })).filter((d) => d.r).map(({ x, r }) => ({ ...r, dx: x }));
      dSec.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${esc(tr("By former province"))}</h4>`);
      dCounty = createTable(dSec, {
        caption: tr("Typhoons by former province"), rank: true, maxHeight: 240, search: tr("Search former provinces"), rows,
        columns: [
          { key: "name", label: tr("Former province"), align: "l", width: "minmax(0,1.6fr)", value: (r) => r.name, html: (r) => `${esc(r.name)} <span class="sub">${esc(r.sub)}</span>` },
          { key: "total", label: tr("Storms"), value: (r) => r.dx[ci.total], text: (r) => int(r.dx[ci.total]), bar: { max: Math.max(1, ...rows.map((r) => r.dx[ci.total] || 0)), color: "rgba(79,154,214,.35)" } },
          { key: "strong", label: tr("Typhoons"), value: (r) => r.dx[ci.strong], text: (r) => int(r.dx[ci.strong]) },
          { key: "last", label: tr("Last"), align: "l", width: "84px", hideBelow: 380, value: (r) => r.dx[ci.last_date], text: (r) => r.dx[ci.last_date] || "–" },
        ],
        sort: { key: "total", dir: "desc" },
        onHover: (r) => link.hover(r ? rowsHighlight(counties, [counties.byKey.get(r.key)]) : null),
        onClick: (r) => counties.focus(counties.byKey.get(r.key)),
      });
    }
    // Storm lists.
    const stormList = (title, list) => {
      if (!list?.length) return;
      dSec.insertAdjacentHTML("beforeend", `<h4 class="adv-h4">${esc(title)}</h4>`);
      createTable(dSec, {
        caption: title, maxHeight: 220, rowKey: (r) => `${r.name}-${r.date}`, rows: list,
        columns: [
          { key: "date", label: tr("Date"), align: "l", width: "84px", value: (r) => r.date, text: (r) => r.date || "–" },
          { key: "name", label: tr("Storm"), align: "l", width: "minmax(0,1fr)", value: (r) => r.name, text: (r) => r.name || tr("Unnamed") },
          { key: "max_kt", label: tr("Peak"), value: (r) => r.max_kt, text: (r) => (fin(r.max_kt) ? `${int(r.max_kt)} kt` : "–"), title: tr("Peak sustained wind near Vietnam (knots)") },
          { key: "prov", label: tr("Provinces"), align: "l", width: "minmax(0,1.2fr)", hideBelow: 380, value: (r) => (r.provinces || []).length, text: (r) => (r.provinces || []).join(", ") },
        ],
        sort: { key: "date", dir: "desc" },
        onHover: (r) => link.hover(r ? provHighlight(r.provinces || [], `${r.name} (${r.season})`) : null),
      });
    };
    stormList(tr("The strongest"), nat.strongest);
    stormList(tr("Most recent"), nat.recent);
  }

  const api = {
    onMapHover(h) {
      const owner = h.cell >= 0 ? app.w.raw.owner[h.cell] : -1;
      const sr = owner >= 0 ? stLevel.rows[owner] : null;
      dState?.setHot(sr ? sr.key : null, false);
      const c = h.cell >= 0 && counties ? counties.rowAtCell(h.cell) : null;
      dCounty?.setHot(c ? c.key : null, false);
      if (h.item?.kind === "wonder") for (const w of wonderBars) w.setHot(h.item.data?.id ?? null);
    },
    onMapClick(ev) {
      if (ev.item?.kind !== "wonder") return false;
      flyTo(wonders.find((w) => w.id === ev.item.data?.id));
      return true;
    },
  };
  return api;

  function active() { return el.isConnected; }
}

function metricText(w) {
  const m = w.metrics || {};
  if (fin(m.inscribed)) return tr("inscribed {year}", { year: m.inscribed });
  if (fin(m.area_km2)) return `${int(m.area_km2)} km²`;
  if (fin(m.founded)) return tr("founded {year}", { year: m.founded });
  if ("founded" in m) return tr("founding year not in Wikidata"); // Đại học Thái Nguyên: its item has no inception date
  return w.curated ? tr("hand-picked") : "–";
}
const w0curated = (list) => list.every((w) => w.curated);

/** A small SVG column chart (one column per item). */
function columnChart(items, val, label) {
  const W = 400, H = 110, m = { l: 4, r: 4, t: 6, b: 18 };
  const max = Math.max(1, ...items.map(val));
  const bw = (W - m.l - m.r) / items.length;
  const div = document.createElement("div");
  div.className = "adv-hist adv-cols-chart";
  const first = items[0]?.year, last = items[items.length - 1]?.year;
  div.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" role="img" aria-label="${esc(tr("Storms per year"))}">
    ${items.map((it, i) => { const h = (val(it) / max) * (H - m.t - m.b); return `<g class="bin"><rect class="hit" x="${(m.l + i * bw).toFixed(2)}" y="${m.t}" width="${bw.toFixed(2)}" height="${H - m.t - m.b}"/><rect class="bar" x="${(m.l + i * bw + 0.4).toFixed(2)}" y="${(H - m.b - h).toFixed(2)}" width="${Math.max(0.5, bw - 0.8).toFixed(2)}" height="${h.toFixed(2)}" fill="#4f9ad6"/><title>${esc(label(it))}</title></g>`; }).join("")}
    <line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b + 0.5}" y2="${H - m.b + 0.5}" class="axis"/>
    <text x="${m.l}" y="${H - 5}" class="tick">${esc(first ?? "")}</text><text x="${W - m.r}" y="${H - 5}" text-anchor="end" class="tick">${esc(last ?? "")}</text>
    <text x="${m.l + 2}" y="${m.t + 9}" class="tick">${esc(tr("{n} max", { n: max }))}</text>
  </svg>`;
  return div;
}

