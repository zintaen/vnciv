// City View "Citizens" rows: the former province's people as rows of small figures (citizens.json v2, NSO).
//
//   citizensHtml(m, data) → HTML      the rows (placeholders for the figure canvases)
//   mountCitizens(host, m, data)       paints the figures and wires the hover / focus read-out
//
// The rows, their labels and categories come from the file (rows, groups, figures); each category's icon (c-*) picks
// the figure. Each row: N figures, a caption ("each figure ≈ 950K residents"), a read-out line that a hovered or
// focused figure fills ("8 in 10 residents in X are city dwellers (VN: 4 in 10)") and a thin Vietnam bar for
// comparison. Below: life expectancy and migration. A row NSO has no figure for is said so, never drawn as zeros.
import { dec, esc, fixed, int, pct } from "../../format.js";
import { compact } from "./fmt.js";
import { t } from "../../i18n.js";
import { CATEGORY_COLOR, figureCanvas, loadPainter } from "./figures.js";

// Nouns per row ([singular, plural]) for the caption and read-out; a row not listed reads "people".
const NOUN = {
  residence: ["resident", "residents"], work: ["worker", "workers"], skills: ["worker", "workers in the labour force"],
  households: ["household", "households"],
};
const noun = (rid) => (NOUN[rid] || ["person", "people"]).map((w) => t(w));

/** Largest-remainder rounding of counts into n figures (for rows without figures). */
export function largestRemainder(counts, keys, n) {
  const tot = keys.reduce((a, k) => a + (counts[k] || 0), 0);
  if (!(tot > 0)) return null;
  const raw = keys.map((k) => ((counts[k] || 0) / tot) * n);
  const out = raw.map(Math.floor);
  let left = n - out.reduce((a, v) => a + v, 0);
  const order = raw.map((v, j) => [v - Math.floor(v), j]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return Object.fromEntries(keys.map((k, j) => [k, out[j]]));
}

/** "1 in 7", "3 in 10", "fewer than 1 in 1,000". */
export function oneIn(share) {
  if (share == null || !Number.isFinite(share)) return null;
  if (share <= 0) return { text: t("none"), plural: true };
  if (share < 0.001) return { text: t("fewer than 1 in 1,000"), plural: false };
  if (share >= 0.3) {
    const k = Math.round(share * 10);
    return k >= 10 ? { text: t("nearly all"), plural: true } : { text: t("{k} in 10", { k }), plural: k !== 1 };
  }
  const n = Math.round(1 / share);
  return { text: t("1 in {n}", { n: int(n) }), plural: false };
}

function sentence(rid, label, share, natShare, cityName) {
  const a = oneIn(share);
  if (!a) return "";
  const vn = oneIn(natShare);
  const lead = a.text.charAt(0).toUpperCase() + a.text.slice(1);
  return t("{share} {noun} in {city}: {label}", { share: lead, noun: noun(rid)[1], city: cityName, label: label.toLowerCase() }) + (vn ? ` (VN: ${vn.text})` : "");
}

const colorOf = (rid, k) => CATEGORY_COLOR[rid]?.[k] || "#8a8a8a";

/** The Citizens rows. data = citizens.json (or null / undefined while loading). */
export function citizensHtml(m, data) {
  const c = m.city;
  if (data === undefined) return `<p class="muted cv-note">${t("Loading the citizen mix…")}</p>`;
  if (!data || !data.cities) return `<p class="muted cv-note">${t("The citizen mix is not available.")}</p>`;
  const row0 = data.cities[c.id];
  if (!row0) return `<p class="muted cv-note">${t("NSO publishes no citizen figures for {name}, so there are none here.", { name: esc(c.name) })}</p>`;
  const nat = data.national || {};
  const groups = data.groups || {};
  const rows = Object.keys(data.rows || groups);
  const specs = new Map((row0.specialists || []).map((s) => [`${s.row}|${s.key}`, s]));
  const label = (rid, k) => t(groups[rid]?.find((g) => g.key === k)?.label || k);

  // Headline chips: life expectancy and migration.
  const le = row0.life_expectancy, vle = nat.life_expectancy;
  const mig = row0.migration || {};
  const chip = (v, vn, fmt, lbl, tip) => (v == null ? "" : `<div class="cv-cz-chip" title="${esc(tip)}"><b>${fmt(v)}</b><span>${esc(t(lbl))}</span>${vn != null ? `<small>VN ${fmt(vn)}</small>` : ""}</div>`);
  const sgn = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fixed(Math.abs(v), 1)}`;
  const unit = t(mig.unit || "per 1,000 residents");

  // The "great person" call-out: the strongest over-represented category.
  const top = (row0.specialists || []).find((s) => s.ratio >= (data.rule?.specialist_high ?? 1.5));
  const great = top ? `<div class="cv-great" style="--fc:${esc(colorOf(top.row, top.key))}">
      <span class="cv-great-fig" data-great="${esc(top.row)}|${esc(top.key)}" aria-hidden="true"></span>
      <div><small>${t("Standout citizens")}</small><b>${esc(label(top.row, top.key))}</b>
      <span>${esc(t("{p} of {noun} here, {vn} nationally: {r}× Vietnam's share.", { p: pct(top.share, 1), noun: noun(top.row)[1], vn: pct(top.national, 1), r: fixed(top.ratio, 1) }))}</span></div></div>` : "";

  const html = rows.map((rid) => {
    const row = row0[rid];
    const head = `<div class="cv-cz-h"><b>${esc(t(data.rows?.[rid] || rid))}</b></div>`;
    if (!row) return `<div class="cv-cz-row missing" data-row="${esc(rid)}">${head}<p class="muted cv-note">${t("NSO has no figure for this row in {name}.", { name: esc(c.name) })}</p></div>`;
    const keys = (groups[rid] || []).map((g) => g.key);
    const n = data.figures?.[rid] ?? 10;
    const figs = row.figures || (row.counts ? largestRemainder(row.counts, keys, n) : largestRemainder(row.shares || {}, keys, n));
    if (!figs) return `<div class="cv-cz-row missing" data-row="${esc(rid)}">${head}<p class="muted cv-note">${t("No figures for this row.")}</p></div>`;
    const vn = nat[rid];
    const cells = [];
    for (const k of keys) {
      for (let j = 0; j < (figs[k] || 0); j++) {
        const sp = specs.get(`${rid}|${k}`);
        const mark = sp ? (sp.ratio >= 1 ? "up" : "down") : "";
        // One tab stop per category (its first figure), not one per figure.
        cells.push(`<span class="cv-fig${mark ? ` ${mark}` : ""}" tabindex="${j ? -1 : 0}" role="img" data-k="${esc(k)}" aria-label="${esc(label(rid, k))}"></span>`);
      }
    }
    // Legend: every category with its share, Vietnam's and a chevron for standouts; zero-figure ones greyed. The whole
    // percents are rounded by largest remainder too, so a row reads 100% (96.5/3.5 → 96%/4%, not 97%/4%).
    const whole = largestRemainder(row.shares || {}, keys, 100);
    const legend = keys.map((k) => {
      const sh = row.shares?.[k], v = vn?.shares?.[k];
      const sp = specs.get(`${rid}|${k}`);
      const chev = sp ? `<em class="${sp.ratio >= 1 ? "up" : "down"}" title="${t("{r}× Vietnam's share", { r: fixed(sp.ratio, 1) })}">${sp.ratio >= 1 ? "▲" : "▼"}</em>` : "";
      return `<span class="cv-cz-k${figs[k] ? "" : " zero"}" data-k="${esc(k)}" title="${esc(label(rid, k))}: ${sh != null ? pct(sh, 1) : "–"}${v != null ? ` (VN ${pct(v, 1)})` : ""}${figs[k] ? "" : ". " + t("Rounds to no figure.")}"><i style="background:${esc(colorOf(rid, k))}"></i>${esc(label(rid, k))} <small>${sh != null ? pct((whole?.[k] ?? sh * 100) / 100, 0) : "–"}</small>${chev}</span>`;
    }).join("");
    const vnBar = vn?.shares ? `<div class="cv-cz-us" title="${t("Vietnam's mix, same order")}"><span>VN</span><div>${keys.map((k) => {
      const s = vn.shares[k] || 0;
      return s > 0 ? `<i style="flex:${s};background:${esc(colorOf(rid, k))}" title="${esc(t("{label}: {p} in Vietnam", { label: label(rid, k), p: pct(s, 1) }))}"></i>` : "";
    }).join("")}</div></div>` : "";
    const cap = Number.isFinite(row.total)
      ? t("Each figure ≈ {n} {noun} · {total} in all", { n: compact(row.total / n), noun: noun(rid)[1], total: compact(row.total) })
      : t("Each figure = {p}% of {noun}", { p: Math.round(100 / n), noun: noun(rid)[1] });
    return `<div class="cv-cz-row" data-row="${esc(rid)}" style="--n:${n}">${head}
      <div class="cv-figs" role="group" aria-label="${esc(t(data.rows?.[rid] || rid))}: ${esc(keys.filter((k) => figs[k]).map((k) => t("{a} of {n} {label}", { a: figs[k], n, label: label(rid, k) })).join(", "))}">${cells.join("")}</div>
      ${vnBar}
      <div class="cv-cz-out" aria-live="polite" data-default="${esc(cap)}">${esc(cap)}</div>
      <div class="cv-cz-legend">${legend}</div>
    </div>`;
  }).join("");

  const unreliable = row0.reliable === false ? `<p class="cv-warn">${t("Some of these shares are survey estimates with wide margins here: read them as rough.")}</p>` : "";
  return `
    <div class="cv-cz-top">
      ${chip(le, vle, (v) => fixed(v, 1), "life expectancy", t("Life expectancy at birth, years (NSO)"))}
      ${chip(mig.in, nat.migration?.in, (v) => fixed(v, 1), "moved in", t("In-migrants {unit} (NSO)", { unit }))}
      ${chip(mig.out, nat.migration?.out, (v) => fixed(v, 1), "moved out", t("Out-migrants {unit} (NSO)", { unit }))}
      ${chip(mig.net, nat.migration?.net, sgn, "net migration", t("Net migration {unit} (NSO)", { unit }))}
    </div>
    ${great}
    ${unreliable}
    <div class="cv-cz${row0.reliable === false ? " unreliable" : ""}">${html}</div>
    <p class="cv-note">${esc(t(data.vintage || "NSO"))}. ${esc(t(data.note || ""))} ${t("Figures are rounded (largest remainder) so each row adds up; hover or tap a figure for its share.")} ${t("▲▼ = at least {hi}× or at most {lo}× Vietnam's share.", { hi: dec(data.rule?.specialist_high ?? 1.5), lo: dec(data.rule?.specialist_low ?? 0.67) })}</p>`;
}

function paintInto(el, rid, k, iconOf, dpr) {
  const src = figureCanvas(rid, k, 36, dpr, iconOf(rid, k));
  const cv = document.createElement("canvas");
  cv.width = src.width;
  cv.height = src.height;
  cv.getContext("2d").drawImage(src, 0, 0);
  el.replaceChildren(cv);
}

/** Paint the figure canvases and wire the read-outs. */
export function mountCitizens(host, m, data) {
  if (!host || !data?.cities?.[m.city.id]) return;
  const row0 = data.cities[m.city.id];
  const nat = data.national || {};
  const groups = data.groups || {};
  // A category's figure is people.js's kind of its key, else of its suggested icon (c-*), else a plain person.
  const iconOf = (rid, k) => groups[rid]?.find((g) => g.key === k)?.icon || null;
  const label = (rid, k) => t(groups[rid]?.find((g) => g.key === k)?.label || k);
  const dpr = Math.min(3, Math.max(1, Math.round((devicePixelRatio || 1) * 2) / 2));
  const paintAll = () => {
    host.querySelectorAll(".cv-cz-row[data-row]").forEach((rowEl) => {
      rowEl.querySelectorAll(".cv-fig").forEach((el) => paintInto(el, rowEl.dataset.row, el.dataset.k, iconOf, dpr));
    });
    const g = host.querySelector("[data-great]");
    if (g) {
      const [rid, k] = g.dataset.great.split("|");
      paintInto(g, rid, k, iconOf, dpr);
    }
  };
  paintAll();
  // Once the citizen painter (render/art/people.js) loads, repaint the figures.
  loadPainter().then(() => { if (host.isConnected) paintAll(); });

  host.querySelectorAll(".cv-cz-row[data-row]").forEach((rowEl) => {
    const rid = rowEl.dataset.row;
    const row = row0[rid];
    const out = rowEl.querySelector(".cv-cz-out");
    if (!row || !out) return;
    const show = (k) => {
      rowEl.querySelectorAll("[data-k]").forEach((el) => el.classList.toggle("lit", el.dataset.k === k));
      rowEl.classList.toggle("focus", !!k);
      if (!k) {
        out.textContent = out.dataset.default;
        out.classList.remove("on");
        return;
      }
      const sh = row.shares?.[k], vn = nat[rid]?.shares?.[k];
      out.innerHTML = `${esc(sentence(rid, label(rid, k), sh, vn, m.city.name))}<small>${t("{p} here", { p: sh != null ? pct(sh, 1) : "–" })}${vn != null ? ` · ${t("{p} in Vietnam", { p: pct(vn, 1) })}` : ""}${row.counts?.[k] != null ? ` · ≈${compact(row.counts[k])} ${noun(rid)[1]}` : ""}</small>`;
      out.classList.add("on");
    };
    let pinned = null;
    rowEl.addEventListener("pointerover", (e) => {
      const el = e.target.closest("[data-k]");
      if (el && rowEl.contains(el)) show(el.dataset.k);
    });
    rowEl.addEventListener("pointerleave", () => show(pinned));
    rowEl.addEventListener("focusin", (e) => {
      const el = e.target.closest("[data-k]");
      if (el) show(el.dataset.k);
    });
    rowEl.addEventListener("focusout", () => show(pinned));
    // A tap pins the category (phones have no hover); another tap on it lets go.
    rowEl.addEventListener("click", (e) => {
      const el = e.target.closest("[data-k]");
      if (!el) return;
      pinned = pinned === el.dataset.k ? null : el.dataset.k;
      show(pinned);
    });
  });
}
