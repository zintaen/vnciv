// "Lịch mùa Việt Nam / Season calendar": a month-by-month panel and map layer of what is happening in Vietnam.
//   rice     the stage of the lowland rice in the North and the South (living.json crop calendar, USDA FAS)
//   flood    the Mekong flood season (living.json flood months: inflow, peak, recession)
//   storms   tropical storms near Vietnam since 1980 counted by month (seasons.json, from IBTrACS via timeline.json)
//   festival the month's festivals with their solar date this lunar year (seasons.json, lunar → solar from Hồ Ngọc
//            Đức's tables)
//   sights   flowers and terraced fields whose months a cited Vietnamese Wikipedia article gives (seasons.json)
// A switch in the Map panel (group living, off by default) shows the panel and the month's places on the map. The
// month starts at the current month in Vietnam time; ◀ ▶ step it. Clicking an item flies to its place.
import { t, lang } from "../../i18n.js";
import { esc, int, fixed } from "../../format.js";
import { vnParts, riceStage } from "../living/calendar.js";
import { addMonth } from "./geom.js";

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const STAGE_NAME = { plant: "Transplanting (flooded fields)", grow: "Green rice", ripe: "Ripening", harvest: "Harvest (gold)", fallow: "Fallow" };
const KIND_ICON = { flowers: "🌸", fields: "🌾", fruit: "🍑", festival: "🏮" };
const monthName = (m) => (lang === "vi" ? `Tháng ${m}` : MONTHS_EN[m - 1]);
const monthRange = (ms) => (ms.length === 1 ? monthName(ms[0]) : `${monthName(ms[0])} – ${monthName(ms[ms.length - 1])}`).replace(/Tháng (\d+) – Tháng/, "Tháng $1 –");
const dmy = (iso) => { const [y, m, d] = iso.split("-").map(Number); return lang === "vi" ? `${d}/${m}/${y}` : `${d} ${MONTHS_EN[m - 1].slice(0, 3)} ${y}`; };
const LUNAR_VI = ["Giêng", "Hai", "Ba", "Tư", "Năm", "Sáu", "Bảy", "Tám", "Chín", "Mười", "Một", "Chạp"];
const lunarText = (d, m) => (lang === "vi" ? `${d <= 10 ? "mùng " : ""}${d} tháng ${LUNAR_VI[m - 1]} âm lịch` : t("day {d} of lunar month {m}", { d, m }));

export function installSeasons(app) {
  const grid = app.w.grid;
  let on = false, S = null, L = null, loading = null;
  const now = vnParts(Date.now());
  let Y = now.y, Mo = now.m;
  let items = []; // the month's places on the map: [{x, y, icon, name, sub}]

  const panel = document.createElement("div");
  panel.className = "panel xp-cal";
  panel.hidden = true;
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", t("Season calendar"));
  document.body.appendChild(panel);

  async function ensure() {
    loading ||= Promise.all([app.loadData("seasons"), app.loadData("living")]).then(([s, l]) => { S = s; L = l; });
    await loading;
  }
  const range = () => {
    const ys = S?.lunar_years || [Y];
    return [ys[0], ys[ys.length - 1]];
  };

  function festivalsOf(y, m) {
    const key = `${y}-${String(m).padStart(2, "0")}`, out = [];
    for (const f of S?.festivals || []) for (const d of Object.values(f.solar || {})) if (d.startsWith(key)) out.push({ ...f, date: d });
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.n.localeCompare(b.n));
  }

  function render() {
    if (!S || !L) { panel.innerHTML = `<p class="xp-help">${esc(t("Loading…"))}</p>`; return; }
    const m = Mo, [y0, y1] = range();
    const sec = (title, body) => (body ? `<section><h4>${esc(title)}</h4><ul>${body}</ul></section>` : "");
    const li = (go, icon, name, sub, extra = "") => `<li><button type="button" class="xp-go" data-go="${esc(go)}"><span aria-hidden="true">${icon}</span>
      <span><b>${esc(name)}</b><small>${sub}</small></span></button>${extra}</li>`;
    items = [];
    // rice
    const cc = L.crop_calendar, regions = Object.entries(cc?.regions || {});
    let rice = "";
    regions.forEach(([id, r]) => {
      const st = riceStage(r.seasons, m);
      const acts = [];
      for (const s of r.seasons) {
        if (s.plant.includes(m)) acts.push(t("{season}: planting", { season: t(s.name) }));
        if (s.harvest.includes(m)) acts.push(t("{season}: harvest", { season: t(s.name) }));
      }
      rice += li(`rice:${id}`, "🌾", `${t(r.name)}: ${t(STAGE_NAME[st])}`, esc(acts.join(" · ") || t("Between seasons")));
    });
    // flood
    const lv = L.flood?.months?.[String(m)] || 0, peak = Math.max(...Object.values(L.flood?.months || { 0: 0 }));
    const flood = lv ? li("flood", "💧", t("Mekong flood season (mùa nước nổi)"),
      esc(lv >= peak ? t("The peak of the season") : t("Water level {p}% of the peak (illustrative)", { p: int(lv / peak * 100) }))) : "";
    // storms
    const sm = S.storms.months[String(m)], st = S.storms;
    let storms = "";
    if (sm) {
      const names = (sm.top || []).map(([a]) => app.w.raw.states.find((s) => s.abbr === a)?.name).filter(Boolean);
      const sub = t("{n} storms came near Vietnam in this month {a}–{b} ({p} a year on average, {s} of typhoon strength)", { n: int(sm.count), a: st.since, b: st.until, p: fixed(sm.per_year, 2), s: int(sm.strong) })
        + (names.length ? ` · ${t("most often: {list}", { list: names.join(", ") })}` : "");
      storms = li(sm.count && sm.top?.length ? `storm:${sm.top[0][0]}` : "storm:", "🌀", sm.per_year >= 0.25 ? t("Storm season") : t("Storms are rare this month"), esc(sub));
    }
    // festivals
    const fest = festivalsOf(Y, m).map((f, k) => {
      items.push({ x: f.x, y: f.y, icon: "🏮", name: f.n, sub: `${dmy(f.date)} (${lunarText(f.day, f.month)})` });
      return li(`fest:${k}`, "🏮", f.n, esc(`${dmy(f.date)} · ${lunarText(f.day, f.month)}`));
    }).join("");
    const festNote = Y < y0 || Y > y1 ? `<li class="xp-help">${esc(t("Solar dates computed for {a}–{b} only.", { a: y0, b: y1 }))}</li>` : "";
    // sights
    const sights = (S.sights || []).filter((s) => s.months.includes(m)).map((s) => {
      const name = lang === "vi" ? s.vi : s.en, place = lang === "vi" ? s.place_vi : s.place_en;
      items.push({ x: s.x, y: s.y, icon: KIND_ICON[s.kind] || "🌸", name, sub: monthRange(s.months) });
      return li(`sight:${s.id}`, KIND_ICON[s.kind] || "🌸", name, `${esc(place)} · ${esc(monthRange(s.months))}`,
        `<a class="xp-cite" href="${esc(s.source)}" target="_blank" rel="noopener" title="${esc(`“${s.quote}”`)}">${esc(t("Source: Wikipedia “{title}”", { title: s.source_title }))}</a>`);
    }).join("");
    const canPrev = Y * 12 + m > y0 * 12 + 1, canNext = Y * 12 + m < y1 * 12 + 12;
    panel.innerHTML = `<div class="xp-head"><b>🗓 ${esc(t("Season calendar"))}</b>
        <button type="button" class="icon-btn xp-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close"))}">✕</button></div>
      <div class="xp-step"><button type="button" class="tl-btn xp-pm" aria-label="${esc(t("Previous month"))}" title="${esc(t("Previous month"))}" ${canPrev ? "" : "disabled"}>◀</button>
        <span class="xp-mon" aria-live="polite">${esc(monthName(m))} ${Y}</span>
        <button type="button" class="tl-btn xp-nm" aria-label="${esc(t("Next month"))}" title="${esc(t("Next month"))}" ${canNext ? "" : "disabled"}>▶</button>
        <button type="button" class="tl-btn xp-today" ${Y === now.y && m === now.m ? "disabled" : ""}>${esc(t("This month"))}</button></div>
      <div class="xp-cal-body">
      ${sec(t("Rice"), rice)}${sec(t("Floods"), flood)}${sec(t("Tropical storms"), storms)}
      ${sec(t("Festivals (lunar calendar)"), fest + festNote) || `<section><h4>${esc(t("Festivals (lunar calendar)"))}</h4><p class="xp-help">${esc(t("No listed festival starts this month."))}</p></section>`}
      ${sec(t("Flowers and fields"), sights)}
      <p class="xp-note">${esc(t("Rice: USDA FAS crop calendar (North and South rows). Flood season: illustrative months from the Mekong Delta literature. Storms: IBTrACS tracks within 100 km of Vietnam's land, by the month they first came near (“storm season”: at least one storm every four years on average). Festivals: the placed festivals of the Vietnamese Wikipedia list; solar dates from Hồ Ngọc Đức's lunar calendar. Flowers and fields: only those whose months a Vietnamese Wikipedia article states (linked). Typical seasons, not forecasts."))}</p>
      </div>`;
    app.invalidate?.();
  }

  function go(key) {
    const [k, id] = key.split(":");
    const fit = (cells) => {
      if (!cells.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const i of cells) { const x = grid.cx(i), y = grid.cy(i); x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      app.fitBounds(x0, y0, x1, y1);
    };
    const pt = (x, y, label) => { app.flyTo(x, y, Math.max(app.cam.scale, 14 / grid.R), 800); app.highlight?.({ x, y, label }); };
    if (k === "rice") { const ri = Object.keys(L.crop_calendar.regions).indexOf(id); fit(L.rice.cells.filter((_, j) => L.rice.region[j] === ri)); }
    else if (k === "flood") fit(L.flood.cells);
    else if (k === "storm" && id) app.selectState(id, { fly: true });
    else if (k === "fest") { const f = festivalsOf(Y, Mo)[+id]; if (f) pt(f.x, f.y, f.n); }
    else if (k === "sight") { const s = S.sights.find((x) => x.id === id); if (s) pt(s.x, s.y, lang === "vi" ? s.vi : s.en); }
  }
  panel.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("xp-x")) { app.ui.setMapToggle("seasoncal", false); return; }
    if (b.classList.contains("xp-pm") || b.classList.contains("xp-nm") || b.classList.contains("xp-today")) {
      if (b.classList.contains("xp-today")) [Y, Mo] = [now.y, now.m];
      else [Y, Mo] = addMonth(Y, Mo, b.classList.contains("xp-pm") ? -1 : 1);
      const cls = [...b.classList].find((c) => c.startsWith("xp-") && c !== "xp-go");
      render();
      const again = panel.querySelector(`.${cls}`);
      (again && !again.disabled ? again : panel.querySelector(".xp-today:not([disabled]), .xp-nm:not([disabled]), .xp-pm"))?.focus();
      return;
    }
    if (b.dataset.go) go(b.dataset.go);
  });

  // --- map layer: the month's festivals and sights ---------------------------------------------------------------------
  let drawn = [];
  app.registerStaticLayer({
    id: "seasoncal", z: 67, snapshot: true,
    visible: () => on && !!S,
    sig: () => `${Y}-${Mo}-${items.length}`,
    draw(ctx, vp, w, o) {
      drawn = [];
      o.screen();
      const size = Math.max(16, Math.min(24, o.Rpx * 1.1));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${Math.round(size * 0.72)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      for (const it of items) {
        if (it.x < vp.x0 - 40 || it.x > vp.x1 + 40 || it.y < vp.y0 - 40 || it.y > vp.y1 + 40) continue;
        const [sx, sy] = o.toScreen(it.x, it.y);
        ctx.beginPath(); ctx.arc(sx, sy, size / 2, 0, 7);
        ctx.fillStyle = "rgba(255,248,230,.92)"; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = "#8a6a2a"; ctx.stroke();
        ctx.fillStyle = "#000";
        ctx.fillText(it.icon, sx, sy + 1);
        drawn.push({ it, x: it.x, y: it.y, r: (size / 2 + 2) / o.s });
      }
      o.world();
    },
    hit(x, y) {
      let best = null, bd = Infinity;
      for (const d of drawn) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd <= d.r * d.r && dd < bd) { bd = dd; best = d.it; } }
      return best;
    },
    tooltip: (it) => `<b>${esc(it.name)}</b><br>${esc(it.sub)}<br><span class="muted">${esc(t("Season calendar"))}</span>`,
  });

  async function setOn(v) {
    on = !!v;
    panel.hidden = !on;
    document.body.classList.toggle("xp-cal-on", on);
    if (on) { await ensure(); if (on) render(); }
    app.invalidate?.();
  }
  app.ui?.addMapToggle?.({
    id: "seasoncal", group: "living", icon: "🗓", default: false,
    label: t("Season calendar"),
    title: t("Month by month: rice stages, the Mekong flood season, storms, festivals (lunar calendar) and flower seasons, each from a cited source. Click an item to fly there."),
    get: () => on,
    set: (v) => { setOn(v); },
  });
  return { get on() { return on; }, get month() { return [Y, Mo]; }, setMonth: (y, m) => { Y = y; Mo = m; if (on && S) render(); }, festivalsOf, panel, ensure };
}

export const SEASONS_CSS = `
.xp-cal { position: fixed; right: calc(10px + var(--dock-right, 0px)); top: calc(var(--topbar-h, 40px) + 54px); z-index: 16; width: min(340px, calc(100vw - 20px)); max-height: calc(100vh - var(--topbar-h, 40px) - 140px); overflow: auto; padding: 8px 12px 10px; font-size: 12.5px; color: var(--ink); box-sizing: border-box; }
.xp-cal[hidden] { display: none; }
.xp-step { display: flex; align-items: center; gap: 6px; margin: 6px 0; }
.xp-mon { font: 600 16px var(--serif); color: var(--gold-bright); min-width: 120px; text-align: center; }
.xp-cal .tl-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; min-width: 30px; height: 28px; padding: 0 8px; font: inherit; }
.xp-cal .tl-btn:disabled { opacity: .4; cursor: default; }
.xp-cal .tl-btn:hover:not(:disabled), .xp-cal .tl-btn:focus-visible { background: rgba(201,164,92,.15); }
.xp-cal h4 { margin: 8px 0 3px; font: 600 12px var(--sans); color: var(--ink-dim); text-transform: uppercase; letter-spacing: .04em; }
.xp-cal ul { list-style: none; margin: 0; padding: 0; }
.xp-cal li { margin: 0 0 3px; }
.xp-go { display: flex; gap: 7px; align-items: flex-start; width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 4px; color: var(--ink); cursor: pointer; padding: 3px 4px; font: inherit; }
.xp-go:hover, .xp-go:focus-visible { border-color: var(--line); background: rgba(201,164,92,.08); }
.xp-go b { display: block; font-weight: 600; color: var(--ink); }
.xp-go small { display: block; color: var(--ink-dim); font-size: 11px; line-height: 1.35; }
.xp-cite { display: inline-block; margin: 0 0 2px 28px; font-size: 10.5px; color: var(--ink-dim); }
.xp-cite:hover, .xp-cite:focus-visible { color: var(--gold-bright); }
@media (max-width: 700px) { .xp-cal { top: auto; bottom: 8px; left: 6px; right: 6px; width: auto; max-height: 48vh; } }`;
