// Timeline ("dòng thời gian"): a year control in the top bar (#turn) that steps the map through the years.
//  * lenses with a series in timeline.json (series[*].lens) are recoloured with that year's values (app.setLensView);
//    a province without a value that year is no-data grey, never interpolated; the domain is fixed over all years
//  * the typhoon lens ("disasters") shows only that season's storms (1980–) and lists them in a card
//  * forest_loss.json (if present) gives the "forest_loss" lens a per-year view
//  * city banners show that year's population (63 former provinces) and the top bar's population is that year's sum;
//    the other top-bar values stay the latest, labelled so
//  * before the 1 July 2025 merger the borders and names are the 63 former provinces (world.js adminBorders)
//  * events (timeline.json + history.json) as slider markers (inside the range) and a History list
// Hash key year= (absent = "now": the latest data, the lenses as published). [ and ] step; ▶ plays one year / 1.2 s.
import { t, lang } from "../../i18n.js";
import { esc, compact, int } from "../../format.js";
import { adminBorders } from "../../world.js";

const PLAY_MS = 1200;
const STORM_LENS = "disasters";
const FOREST_LENS = "forest_loss";
const STATUS = { final: "final", prel: "preliminary", est: "estimate" };
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export async function install(app) {
  const T = await app.loadData("timeline");
  if (!T || !Array.isArray(T.years)) return;
  const w = app.w, raw = w.raw, n = w.grid.size;
  const countyIso = (raw.counties || []).map((c) => c.geoid);
  const stateAbbr = raw.states.map((s) => s.abbr);
  const mergerYear = +String(T.merger?.date || "2025").slice(0, 4);
  const seasons = T.storms.map((s) => s.season);
  const stormRange = [Math.min(...seasons), Math.max(...seasons, ...T.years)];
  const seriesByLens = new Map(Object.values(T.series).filter((s) => s.lens).map((s) => [s.lens, s]));
  const pop63 = T.series.population?.levels?.["63"] || {};
  let history = null, forest = null;
  app.loadData("history").then((h) => { history = h; renderMarks(); if (card?.kind === "history") showHistory(); });

  let year = null; // null = now
  let asked = null; // the year last asked for (hash, slider, keys) before clamping: a lens with a wider range gets it back
  let playing = 0;

  // --- ranges ---------------------------------------------------------------------------------------------------
  const lensId = () => app.state.lens?.id || null;
  function range() {
    if (lensId() === STORM_LENS) return stormRange;
    if (lensId() === FOREST_LENS && forest?.years?.length) return [forest.years[0], forest.years.at(-1)];
    return [T.years[0], T.years.at(-1)];
  }
  const clamp = (y) => {
    if (y == null) return null;
    const [a, b] = range();
    return Math.max(a, Math.min(b, y));
  };

  // --- lens views -----------------------------------------------------------------------------------------------
  // Fixed domains, computed once per lens over every year (and both levels) so colours compare across years.
  const domains = new Map();
  function seriesDomain(lens, s) {
    if (domains.has(lens.id)) return domains.get(lens.id);
    let lo = Infinity, hi = -Infinity;
    for (const lv of Object.values(s.lens_values || {})) for (const byYear of Object.values(lv)) for (const v of Object.values(byYear)) {
      if (!Number.isFinite(v) || (lens.scale === "log" && v <= 0)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const d = Number.isFinite(lo) && hi > lo ? [lo, hi] : lens.domain;
    domains.set(lens.id, d);
    return d;
  }
  const hasYear = (lv, y) => !!lv && Object.values(lv).some((v) => v[y] != null);
  const statusText = (s, y) => (s.status?.[y] ? t(STATUS[s.status[y]] || s.status[y]) : "");
  const noteOf = (parts, lens) => [parts.filter(Boolean).join(" · "), lens.note ? t(lens.note) : ""].filter(Boolean).join(". ");

  function seriesView(lens, s, y) {
    const pref = String(lens.level || "63"), other = pref === "63" ? "34" : "63";
    const lvl = [pref, other].find((l) => hasYear(s.lens_values?.[l], String(y)));
    const values = new Array(n).fill(null);
    if (lvl) {
      const lv = s.lens_values[lvl], ys = String(y);
      const unit = lvl === "63" ? raw.county : raw.owner, keys = lvl === "63" ? countyIso : stateAbbr;
      for (let i = 0; i < n; i++) {
        if (raw.owner[i] < 0) continue;
        const v = lv[keys[unit[i]]]?.[ys];
        if (v != null) values[i] = v;
      }
    }
    const lvlText = lvl === "63" ? t("63 former provinces") : lvl === "34" ? t("34 provinces (2025 borders)") : t("no data for this year");
    // the lens description speaks of its latest year; a past year gets its own
    const description = lvl ? t("{name} in {year}, from NSO's yearly series ({level}).", { name: t(lens.name), year: y, level: lvlText })
      : t("{name}: NSO's yearly series has no figure for {year}.", { name: t(lens.name), year: y });
    return { ...lens, id: `${lens.id}@${y}`, values, domain: seriesDomain(lens, s), year: y, level: lvl || lens.level, description,
      note: noteOf([t("Year {year}", { year: y }), lvl && statusText(s, String(y)), lvlText], lens) };
  }

  let stormMax = 0;
  function stormCounts(y) {
    const c = new Uint8Array(n);
    for (const s of T.storms) if (s.season === y) for (const i of s.cells) c[i]++;
    return c;
  }
  function stormView(lens, y) {
    if (!stormMax) {
      for (let a = stormRange[0]; a <= stormRange[1]; a++) { const c = stormCounts(a); for (let i = 0; i < n; i++) if (c[i] > stormMax) stormMax = c[i]; }
    }
    const c = stormCounts(y);
    const values = new Array(n).fill(null);
    for (let i = 0; i < n; i++) if (raw.owner[i] >= 0) values[i] = c[i];
    const all = stormsOf(y), k = all.filter((s) => !offshoreOnly(s)).length, m = all.length - k;
    // ponytail: the top colour is "4 or more" (stormMax is 5, in a handful of hexes); a 0–5 ramp left 1-storm hexes nearly black
    return { ...lens, id: `${lens.id}@${y}`, values, domain: [0, Math.max(1, Math.min(4, stormMax))], unit: "storms that year", year: y,
      note: noteOf([t("Year {year}", { year: y }), t("{n} storms touched Vietnam", { n: k }), m ? t("{n} more only near Hoàng Sa or Trường Sa", { n: m }) : "", y < 2008 ? t("borders shown are the 63 provinces of 2008–2025") : ""], lens) };
  }

  let forestDomain = null;
  function forestView(lens, y) {
    const k = forest.years.indexOf(y);
    const values = new Array(n).fill(null);
    if (k >= 0) {
      const loss = forest.loss_ha[k];
      forest.cells.forEach((c, j) => { values[c] = forest.forest2000_ha[j] > 0 ? loss[j] / forest.forest2000_ha[j] : null; });
    }
    if (!forestDomain) {
      // ponytail: max over every year; a p99 clip if a few hexes wash the ramp out
      let hi = 0;
      for (const loss of forest.loss_ha) loss.forEach((v, j) => { const f = forest.forest2000_ha[j]; if (f > 0 && v / f > hi) hi = v / f; });
      forestDomain = [0, hi || 1];
    }
    // the lens's own name and description are the 2001–2025 total: a year's view says it is that year alone
    return { ...lens, id: `${lens.id}@${y}`, values, domain: forestDomain, scale: "linear", format: "pct", year: y,
      name: t("Forest loss in {year}", { year: y }),
      description: t("Share of the hex's year-2000 forest (tree canopy ≥ 30%) with stand-replacing loss in {year} alone (Hansen Global Forest Change v1.13, Landsat). Sensors and method changed over the years, so a step from one year to the next can be an artefact.", { year: y }),
      unit: "share of the 2000 forest lost that year",
      note: noteOf([t("Year {year}", { year: y }), k < 0 ? t("no data for this year") : ""], lens) };
  }

  let memo = { key: "", lens: null };
  function view(lens) {
    if (year == null || !lens) return null;
    const key = `${lens.id}|${year}`;
    if (memo.key === key) return memo.lens;
    let v = null;
    if (lens.id === STORM_LENS) v = stormView(lens, year);
    else if (lens.id === FOREST_LENS && forest) v = forestView(lens, year);
    else if (seriesByLens.has(lens.id)) v = seriesView(lens, seriesByLens.get(lens.id), year);
    else {
      v = { ...lens, id: `${lens.id}@static`,
        note: noteOf([t("No yearly series: this lens shows {when}", { when: lens.year ? String(lens.year) : t("its latest data") })], lens) };
    }
    memo = { key, lens: v };
    return v;
  }

  // --- banners + top bar ----------------------------------------------------------------------------------------
  const popSum = (y) => {
    const vals = Object.values(pop63).map((s) => s[String(y)]);
    return vals.length && vals.every(Number.isFinite) ? vals.reduce((a, b) => a + b, 0) : null;
  };
  function bannerPop(city) {
    if (year == null) return null;
    const v = pop63[city.counties?.[0]]?.[String(year)];
    return Number.isFinite(v) ? v : null;
  }

  function updateTopbar() {
    const bar = document.getElementById("yields");
    if (!bar) return;
    bar.querySelectorAll(".tl-chip").forEach((c) => c.remove());
    const sum = year == null ? null : popSum(year);
    let firstLatest = null;
    for (const b of bar.querySelectorAll(".yield")) {
      const val = b.children[1];
      if (!val) continue;
      if (val.dataset.latest == null) val.dataset.latest = val.textContent;
      const yearly = b.dataset.report === "population" && sum != null;
      val.textContent = yearly ? compact(sum) : val.dataset.latest;
      b.classList.toggle("tl-latest", year != null && !yearly);
      b.classList.toggle("tl-yearly", yearly);
      if (b.dataset.title == null) b.dataset.title = b.title;
      // (no year chip: the bar has no room for it at 1280 px; the dotted underline + tooltip mark the year value)
      b.title = yearly ? `${t("Average population in {year} (NSO), sum of the 63 former provinces", { year })}. ${b.dataset.title}` : b.dataset.title;
      if (!yearly && year != null && !firstLatest) firstLatest = b;
    }
    if (firstLatest) firstLatest.insertAdjacentHTML("beforebegin", `<span class="tl-chip" title="${esc(t("These values are the latest published, not {year}", { year }))}">${esc(t("latest"))}</span>`);
  }

  // --- 63 / 34 borders ------------------------------------------------------------------------------------------
  let shown63 = false;
  function setBorders(want63, animate) {
    if (want63 === shown63) return false;
    if (animate && !reduced()) fade();
    const b = adminBorders(w, want63 ? "63" : "34");
    w.bands = b.bands; w.stateLines = b.stateLines; w.bandColor = b.bandColor; w.stateLabels = b.stateLabels;
    shown63 = want63;
    return true;
  }
  function fade() {
    const src = document.getElementById("map");
    const c = document.createElement("canvas");
    c.width = src.width; c.height = src.height;
    c.className = "tl-fade";
    c.getContext("2d").drawImage(src, 0, 0);
    src.after(c);
    requestAnimationFrame(() => requestAnimationFrame(() => c.classList.add("out")));
    setTimeout(() => c.remove(), 900);
  }

  // --- events ---------------------------------------------------------------------------------------------------
  const wonderAt = (id) => app.data.wonders?.wonders?.find((x) => x.id === id) || null;
  const evYear = (e) => (Number.isFinite(e.year) ? e.year : parseInt(String(e.date), 10));
  function allEvents() {
    const out = T.events.map((e) => {
      const wd = e.wonder ? wonderAt(e.wonder) : null;
      return { ...e, year: evYear(e), x: wd?.x ?? null, y: wd?.y ?? null, cite: e.cite || null, place: wd ? wd.name : null };
    });
    for (const e of history?.events || []) {
      if (e.id === "provinces_34") continue; // the same event as timeline.json's merger_2025 (whose cite it lends)
      out.push({ ...e, year: evYear(e) });
    }
    const m = out.find((e) => e.id === "merger_2025");
    const h34 = history?.events?.find((e) => e.id === "provinces_34");
    if (m && h34) m.cite = h34.cite;
    return out.sort((a, b) => a.year - b.year || String(a.date).localeCompare(String(b.date)));
  }
  function fmtDate(e) {
    const s = String(e.date || e.year);
    if (e.year <= 0) return t("{n} BCE", { n: 1 - e.year });
    const [Y, M, D] = s.split("-").map(Number);
    if (!M) return String(Y);
    const d = new Date(Date.UTC(Y, M - 1, D || 1));
    return new Intl.DateTimeFormat(lang === "vi" ? "vi-VN" : "en-GB", { timeZone: "UTC", year: "numeric", month: D ? "numeric" : "long", ...(D ? { day: "numeric" } : {}) }).format(d);
  }
  // A list row names the site: nine rows of a bare "UNESCO World Heritage" told the sites apart only when opened
  const titleOf = (e) => (e.place ? `${t(e.title)}: ${e.place}` : t(e.title));
  const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//.test(u) ? u : null);
  function eventHtml(e) {
    const cite = safeUrl(e.cite);
    const host = cite ? new URL(cite).hostname.replace(/^www\./, "") : "";
    return `<div class="tl-ev-date">${esc(fmtDate(e))}</div><div class="tl-ev-title">${esc(t(e.title))}</div>
      <div class="tl-ev-text">${esc(t(e.text || ""))}</div>
      ${cite ? `<a class="tl-ev-cite" href="${esc(cite)}" target="_blank" rel="noopener noreferrer">${esc(t("Source"))}: ${esc(host)}</a>` : ""}
      ${e.x != null ? `<button type="button" class="tl-link tl-fly" data-x="${esc(e.x)}" data-y="${esc(e.y)}">${esc(t("Show on the map"))}</button>` : ""}`;
  }

  // --- card (storms of the year, an event, the history list) ----------------------------------------------------
  const cardEl = document.createElement("div");
  cardEl.className = "panel tl-card";
  cardEl.hidden = true;
  cardEl.setAttribute("role", "region");
  document.body.appendChild(cardEl);
  let card = null; // {kind: "event"|"storms"|"history", event?}
  let stormsDismissed = false;
  const stormsOf = (y) => T.storms.filter((s) => s.season === y);
  // A storm whose 100 km reach covers only Hoàng Sa / Trường Sa hexes: the national counts (disasters.json) leave it out
  const remote = new Set(raw.remote || []);
  const offshoreOnly = (s) => s.cells.length > 0 && s.cells.every((i) => remote.has(i));
  function renderCard() {
    if (!card && year != null && lensId() === STORM_LENS && !stormsDismissed) card = { kind: "storms" };
    if (card?.kind === "storms" && (year == null || lensId() !== STORM_LENS)) card = null;
    if (!card) { cardEl.hidden = true; return; }
    let head = "", body = "";
    if (card.kind === "event") {
      head = t("Event");
      body = eventHtml(card.event);
    } else if (card.kind === "storms") {
      const list = stormsOf(year);
      head = t("Storms of {year}", { year });
      body = list.length ? `<ul class="tl-storms">${list.map((s) => `<li><b>${esc(s.name && s.name !== "Unnamed" ? s.name : t("Unnamed"))}</b>
          <span>${esc(fmtDate({ date: s.date, year: s.season }))}</span><span>${offshoreOnly(s) ? esc(t("only near Hoàng Sa or Trường Sa")) : s.max_kt ? esc(t("{kt} kt max", { kt: int(s.max_kt) })) : esc(t("wind not recorded"))}</span></li>`).join("")}</ul>`
        : `<div class="tl-ev-text">${esc(t("No storm touched Vietnam this year."))}</div>`;
      body += `<div class="tl-foot">${esc(t("IBTrACS best tracks passing within 100 km of a hex; max wind while within 100 km of the mainland (JMA 10-minute wind; JTWC 1-minute only where JMA has none)."))}</div>`;
    } else {
      head = t("History");
      const evs = allEvents();
      body = `<ol class="tl-hist">${evs.map((e, k) => `<li><button type="button" class="tl-link tl-hist-item" data-k="${k}" aria-expanded="${card.open === k}">
          <span class="tl-ev-date">${esc(fmtDate(e))}</span> ${esc(titleOf(e))}</button>${card.open === k ? `<div class="tl-hist-body">${eventHtml(e)}</div>` : ""}</li>`).join("")}</ol>
        ${history?.rules?.legend ? `<div class="tl-foot">${esc(t(history.rules.legend))}</div>` : ""}`;
      card.events = evs;
    }
    cardEl.setAttribute("aria-label", head);
    cardEl.innerHTML = `<div class="tl-card-head"><span>${esc(head)}</span><button type="button" class="icon-btn tl-card-close" aria-label="${esc(t("Close"))}">✕</button></div><div class="tl-card-body">${body}</div>`;
    cardEl.hidden = false;
  }
  function showEvent(e) { card = { kind: "event", event: e }; renderCard(); }
  function showHistory(open = card?.kind === "history" ? card.open : -1) { card = { kind: "history", open }; renderCard(); }
  function closeCard() {
    if (card?.kind === "storms") stormsDismissed = true;
    const hadFocus = cardEl.contains(document.activeElement);
    card = null;
    renderCard();
    if (hadFocus) $(".tl-hist-btn")?.focus();
  }
  // Esc closes the card like its ✕ (after the active mode and the open dialogs: main.js escape()).
  app.on("escape", () => {
    if (cardEl.hidden) return false;
    closeCard();
    return true;
  });
  cardEl.addEventListener("click", (ev) => {
    if (ev.target.closest(".tl-card-close")) return closeCard();
    const fly = ev.target.closest(".tl-fly");
    if (fly) app.flyTo(+fly.dataset.x, +fly.dataset.y, Math.max(app.cam.scale, 1.2));
    const item = ev.target.closest(".tl-hist-item");
    if (item) {
      const k = +item.dataset.k;
      showHistory(card.open === k ? -1 : k);
      cardEl.querySelector(`.tl-hist-item[data-k="${k}"]`)?.focus();
    }
  });

  // --- the control ----------------------------------------------------------------------------------------------
  const turn = document.getElementById("turn");
  turn.classList.add("tl");
  turn.title = t(app.data.nation?.vintage || "");
  turn.innerHTML = `<button type="button" class="tl-btn tl-prev" aria-label="${esc(t("Previous year ([)"))}" title="${esc(t("Previous year ([)"))}">‹</button>
    <b class="tl-label" aria-live="polite"></b>
    <button type="button" class="tl-btn tl-next" aria-label="${esc(t("Next year (])"))}" title="${esc(t("Next year (])"))}">›</button>
    <span class="tl-track"><input type="range" class="tl-range" step="1" aria-label="${esc(t("Year"))}"><span class="tl-marks"></span></span>
    <button type="button" class="tl-btn tl-play" aria-pressed="false"></button>
    <button type="button" class="tl-btn tl-hist-btn" aria-label="${esc(t("History"))}" title="${esc(t("History: dated events with sources"))}">📜</button>`;
  const $ = (s) => turn.querySelector(s);
  const rangeEl = $(".tl-range"), label = $(".tl-label"), playBtn = $(".tl-play"), marks = $(".tl-marks");

  function renderControl() {
    const [a, b] = range();
    rangeEl.min = a;
    rangeEl.max = b + 1; // the last stop is "now"
    rangeEl.value = year == null ? b + 1 : year;
    const txt = year == null ? t("Now") : String(year);
    label.textContent = txt;
    rangeEl.setAttribute("aria-valuetext", txt);
    $(".tl-prev").disabled = year != null && year <= a;
    $(".tl-next").disabled = year == null;
    playBtn.textContent = playing ? "❚❚" : "▶";
    playBtn.setAttribute("aria-pressed", String(!!playing));
    const pl = playing ? t("Pause") : t("Play the years");
    playBtn.setAttribute("aria-label", pl);
    playBtn.title = pl;
  }
  let marksSig = "";
  function renderMarks() {
    const [a, b] = range();
    const evs = allEvents().filter((e) => e.year >= a && e.year <= b);
    const sig = `${a}-${b}-${evs.length}`;
    if (sig === marksSig) return;
    marksSig = sig;
    const span = b + 1 - a || 1;
    marks.innerHTML = evs.map((e) => {
      const p = ((e.year - a) / span) * 100;
      return `<button type="button" class="tl-mark" data-id="${esc(e.id)}" style="left:${p.toFixed(2)}%" title="${esc(`${fmtDate(e)}: ${titleOf(e)}`)}" aria-label="${esc(`${fmtDate(e)}: ${titleOf(e)}`)}"></button>`;
    }).join("");
  }
  marks.addEventListener("click", (ev) => {
    const m = ev.target.closest(".tl-mark");
    if (!m) return;
    const e = allEvents().find((x) => x.id === m.dataset.id);
    if (!e) return;
    setYear(e.year);
    showEvent(e);
    if (e.x != null) app.flyTo(e.x, e.y, Math.max(app.cam.scale, 1.2));
  });

  // --- year changes ---------------------------------------------------------------------------------------------
  function setYear(y, { fromHash = false, reclamp = false } = {}) {
    if (!reclamp) asked = y;
    y = clamp(y);
    const changed = y !== year;
    year = y;
    const want63 = year != null && year < mergerYear;
    const crossed = setBorders(want63, !fromHash);
    if (changed && (card?.kind === "storms" || card?.kind === "event")) card = null; // an event card is for the step that opened it
    stormsDismissed = changed ? false : stormsDismissed;
    const t0 = performance.now();
    if (changed || crossed) app.refreshLens(); // also invalidates the static cache (borders, labels)
    app.perf.timelineStep = performance.now() - t0;
    if (crossed && !fromHash && lensId() !== STORM_LENS) card = { kind: "event", event: allEvents().find((e) => e.id === "merger_2025") || null };
    if (card?.kind === "event" && !card.event) card = null;
    updateTopbar();
    renderControl();
    renderCard();
    app.requestDraw();
    if (changed) app.emit("year", { year }); // the advisors label their (latest) figures against it
    if (!fromHash) app.hash.update();
  }
  const step = (d) => {
    const [a, b] = range();
    if (d > 0) setYear(year == null ? null : year >= b ? null : year + 1);
    else setYear(year == null ? b : Math.max(a, year - 1));
  };

  function play(on) {
    clearInterval(playing);
    playing = 0;
    if (on) {
      if (year == null) setYear(range()[0]);
      playing = setInterval(() => {
        step(1);
        if (year == null) play(false);
      }, PLAY_MS);
    }
    renderControl();
  }

  $(".tl-prev").onclick = () => { play(false); step(-1); };
  $(".tl-next").onclick = () => { play(false); step(1); };
  playBtn.onclick = () => play(!playing);
  $(".tl-hist-btn").onclick = () => (card?.kind === "history" ? (card = null, renderCard()) : showHistory(-1));
  rangeEl.addEventListener("input", () => {
    const v = +rangeEl.value, [, b] = range(); // before play(false): its renderControl writes the old year back
    play(false);
    setYear(v > b ? null : v);
  });
  // Any other interaction pauses the play.
  const pause = (e) => { if (playing && !playBtn.contains(e.target)) play(false); };
  addEventListener("pointerdown", pause, true);
  addEventListener("wheel", pause, { capture: true, passive: true });
  addEventListener("keydown", (e) => {
    const tg = e.target;
    const typing = tg && (tg.tagName === "TEXTAREA" || tg.isContentEditable || (tg.tagName === "INPUT" && tg !== rangeEl) || tg.tagName === "SELECT");
    if ((e.key === "[" || e.key === "]") && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      play(false);
      step(e.key === "]" ? 1 : -1);
    } else if (playing && !(tg === playBtn && (e.key === " " || e.key === "Enter"))) play(false);
  }, true);

  function onLens() {
    if (lensId() === FOREST_LENS && !forest) {
      app.loadData("forest_loss").then((d) => {
        if (!d || !Array.isArray(d.years) || forest) return;
        forest = d;
        memo.key = "";
        if (lensId() === FOREST_LENS) { marksSig = ""; renderMarks(); setYear(asked, { reclamp: true }); app.refreshLens(); }
      });
    }
    marksSig = "";
    renderMarks();
    const y = clamp(asked);
    if (y !== year) setYear(y, { reclamp: true });
    else { renderControl(); renderCard(); }
  }
  app.on("lens", onLens);

  app.setLensView(view);
  app.bannerPopulation = bannerPop;
  injectStyle();
  renderMarks();
  renderControl();
  app.hash.register("year", {
    get: () => (year == null ? null : String(year)),
    set: (v) => {
      const y = v == null || !/^-?\d{1,4}$/.test(v) ? null : +v;
      setYear(y, { fromHash: true });
    },
  });
  onLens(); // a lens picked before this extension installed (#lens=forest_loss) still gets its year range and data
  app.timeline = { get year() { return year; }, setYear, play, data: T };
}

function injectStyle() {
  const css = `
#turn.tl { display: flex !important; align-items: center; gap: 4px; font-family: var(--serif); }
#turn.tl .tl-label { min-width: 44px; text-align: center; color: var(--gold-bright); font-size: 14px; }
#turn.tl .tl-btn { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer;
  min-width: 24px; height: 24px; padding: 0 5px; line-height: 20px; font-size: 13px; }
#turn.tl .tl-btn:hover:not(:disabled) { background: rgba(201,164,92,.15); }
#turn.tl .tl-btn:disabled { opacity: .35; cursor: default; }
#turn.tl .tl-track { position: relative; display: inline-block; width: 120px; height: 24px; }
#turn.tl .tl-range { width: 100%; margin: 0; height: 24px; accent-color: #c9a45c; cursor: pointer; }
#turn.tl .tl-marks { position: absolute; left: 7px; right: 7px; top: 0; height: 6px; pointer-events: none; }
#turn.tl .tl-mark { position: absolute; top: -1px; width: 7px; height: 7px; margin-left: -3px; border-radius: 50%; padding: 0;
  border: 1px solid #17110a; background: #ecd08e; cursor: pointer; pointer-events: auto; }
#yields .tl-chip { flex: none; align-self: center; font: 600 10px var(--sans); margin-right: -5px;
  color: var(--ink-dim); border: 1px solid var(--line); border-radius: 3px; padding: 0 3px; line-height: 14px; }
#yields .yield.tl-yearly > span:nth-child(2) { text-decoration: underline dotted var(--gold-bright); text-underline-offset: 3px; }
#yields .yield.tl-latest { opacity: .62; }
.tl-fade { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 1; transition: opacity .7s ease; }
.tl-fade.out { opacity: 0; }
.tl-card { position: fixed; top: calc(var(--topbar-h) + 10px); left: calc(12px + var(--dock-left, 0px)); width: 300px; max-height: min(60vh, 460px); overflow: auto;
  z-index: 20; padding: 8px 10px 10px; font-size: 13px; color: var(--ink); }
.tl-card-head { display: flex; justify-content: space-between; align-items: center; font-family: var(--serif); color: var(--gold-bright);
  font-size: 14px; margin-bottom: 6px; }
.tl-ev-date { color: var(--ink-dim); font-size: 12px; }
.tl-ev-title { font-family: var(--serif); font-size: 15px; color: var(--gold-bright); margin: 2px 0 4px; }
.tl-ev-text { line-height: 1.4; }
.tl-ev-cite { display: inline-block; margin-top: 6px; color: var(--gold-bright); font-size: 12px; }
.tl-link { background: none; border: 0; padding: 0; color: var(--gold-bright); cursor: pointer; text-align: left; font: inherit; }
.tl-fly { display: block; margin-top: 6px; font-size: 12px; text-decoration: underline; }
.tl-storms, .tl-hist { list-style: none; margin: 0; padding: 0; }
.tl-storms li { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; padding: 3px 0; border-bottom: 1px solid rgba(201,164,92,.18); }
.tl-storms li span { color: var(--ink-dim); font-size: 12px; }
.tl-hist li { padding: 4px 0; border-bottom: 1px solid rgba(201,164,92,.18); }
.tl-hist .tl-hist-item { color: var(--ink); }
.tl-hist-body { padding: 4px 0 2px 8px; }
.tl-foot { margin-top: 8px; color: var(--ink-dim); font-size: 11px; line-height: 1.35; }
/* Below ~1600 px the bar has no room left (yields + search + buttons): the control floats as a pill just under it. */
@media (max-width: 1600px) {
  #turn.tl { position: fixed; top: calc(var(--topbar-h) + 6px); left: calc(12px + var(--dock-left, 0px)); z-index: 12; padding: 3px 4px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 2px 6px rgba(0,0,0,.4); }
  .tl-card { top: calc(var(--topbar-h) + 46px); }
}
@media (max-width: 700px) {
  #turn.tl { left: 8px; gap: 2px; }
  #turn.tl .tl-track { display: none; }
  #turn.tl .tl-label { min-width: 38px; font-size: 13px; }
  .tl-card { top: calc(var(--topbar-h) + 46px); left: 8px; right: 8px; width: auto; max-height: 40vh; }
}`;
  const el = document.createElement("style");
  el.id = "tl-style";
  el.textContent = css;
  document.head.appendChild(el);
}
