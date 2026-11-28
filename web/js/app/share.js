// Share popover: copy a link to the current view, or download a 1600×900 PNG of it with a caption strip.
import { drawIcon, hasIcon } from "../icons.js";
import { icon } from "../ui/icon.js";
import { t, lang } from "../i18n.js";
import { kindOf } from "../format.js";
import { fmtYear, yearNum } from "../ui/infoPanel.js";
import { naturalEnd } from "../ui/lenses.js";

// The address printed on shared images. Set it to the published site (e.g. "example.com/vnciv"); when left
// empty, the page's own host and path are used, except on a local dev server, where SITE_FALLBACK is printed.
export const SITE_URL = "atlasvn.online";
const SITE_FALLBACK = "vnciv";

export function siteLabel() {
  if (SITE_URL) return SITE_URL;
  try {
    const { hostname, host, pathname } = location;
    const local = !hostname || /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/.test(hostname) || /\.(localhost|test|local)$/.test(hostname);
    if (local || !/^https?:$/.test(location.protocol)) return SITE_FALLBACK;
    const path = pathname.replace(/\/index\.html?$/, "/").replace(/\/$/, "");
    return (host.replace(/^www\./, "") + path).slice(0, 60);
  } catch {
    return SITE_FALLBACK;
  }
}

export const IMG_W = 1600;
export const IMG_H = 900;
export const CAPTION_H = 118;
const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';
const CREDIT = "Data: NSO Vietnam, WorldPop, ESA WorldCover, NOAA, WRI, Wikidata, Natural Earth, OCHA COD-AB, GeoNames, OpenFlights, © OpenStreetMap contributors";

/** "CHELSA" / "Hansen/UMD/Google/USGS/NASA" for a lens source ({title, publisher}) that CREDIT does not already
 *  name (by any of its capitalised words: NOAA, WorldPop, NSO...), else "". */
export function lensCredit(src) {
  if (!src?.publisher) return "";
  const acro = /^([A-Z][A-Z0-9]{2,})\b/.exec(src.title || "")?.[1];
  const words = [...(src.publisher.match(/[A-Z]\w{2,}/g) || []), ...(acro ? [acro] : [])];
  if (words.some((w) => new RegExp(`\\b${w}\\b`).test(CREDIT))) return "";
  return acro || src.publisher.replace(/\s*\(.*?\)/g, "").trim();
}

async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function spaced(ctx, px) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = px + "px";
}

/**
 * Compose the share image.
 * info: {renderMap(canvas, w, h) → bool, lens (lens object or null), formatValue(lens, t) → string,
 *        selection: {kind, name, sub} | null, year (lens data year or timeline year) | null, note (a line in place of the tagline) | null}
 */
export function composeImage(info, { height = IMG_H } = {}) {
  const imgH = Math.max(CAPTION_H + 100, Math.round(height)); // a shorter frame serves 1.91:1 social cards
  const cv = document.createElement("canvas");
  cv.width = IMG_W;
  cv.height = imgH;
  const ctx = cv.getContext("2d");
  const mapH = imgH - CAPTION_H;

  // --- map ---
  ctx.fillStyle = "#0d2a47";
  ctx.fillRect(0, 0, IMG_W, mapH);
  const map = document.createElement("canvas");
  map.width = IMG_W;
  map.height = mapH;
  let ok = false;
  try {
    ok = info.renderMap(map, IMG_W, mapH);
  } catch (err) {
    console.warn("share: map render failed", err);
  }
  if (ok) ctx.drawImage(map, 0, 0);

  // --- caption strip ---
  const y0 = mapH;
  const g = ctx.createLinearGradient(0, y0, 0, imgH);
  g.addColorStop(0, "#24364a");
  g.addColorStop(1, "#111a25");
  ctx.fillStyle = g;
  ctx.fillRect(0, y0, IMG_W, CAPTION_H);
  ctx.fillStyle = "#c9a45c";
  ctx.fillRect(0, y0, IMG_W, 3);
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(0, y0 + 3, IMG_W, 1);
  ctx.fillStyle = "rgba(236,208,142,.25)";
  ctx.fillRect(0, y0 + 7, IMG_W, 1);
  const cy = y0 + CAPTION_H / 2 + 3;

  // Emblem (the national flag, 3:2, star 3/5 of the height across) + title
  const ex = 64, fw = 60, fh = 40;
  ctx.fillStyle = "#120d06";
  ctx.fillRect(ex - fw / 2 - 3, cy - fh / 2 - 3, fw + 6, fh + 6);
  ctx.fillStyle = "#c9a45c";
  ctx.fillRect(ex - fw / 2 - 1.5, cy - fh / 2 - 1.5, fw + 3, fh + 3);
  ctx.fillStyle = "#DA251D";
  ctx.fillRect(ex - fw / 2, cy - fh / 2, fw, fh);
  star(ctx, ex, cy, fh * 0.3, fh * 0.3 * 0.382, "#FFFF00");

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ecd08e";
  ctx.font = `bold 36px ${SERIF}`;
  spaced(ctx, 5);
  ctx.fillText("VIỆT NAM", 112, cy + 2);
  spaced(ctx, 0);
  ctx.fillStyle = "#b9ab88";
  ctx.font = `italic 17px ${SERIF}`;
  ctx.fillText(fit(ctx, info.note || t("A strategy-map atlas of the real economy"), 640 - 114 - 16), 114, cy + 28);

  // Lens + legend ramp
  const mx = 640;
  const lens = info.lens;
  // Room left of the right-hand credit line (translations run longer than the English).
  ctx.font = `14px ${SANS}`;
  // A credit line too long to leave the legend 200 px (the Vietnamese one) breaks at the comma nearest its middle.
  let credit = [t(CREDIT)];
  if (IMG_W - 44 - ctx.measureText(credit[0]).width - 24 - (mx + 50) < 200) {
    const parts = credit[0].split(", "), half = ctx.measureText(credit[0]).width / 2;
    let k = 1;
    while (k < parts.length - 1 && ctx.measureText(parts.slice(0, k + 1).join(", ")).width < half) k++;
    credit = [parts.slice(0, k).join(", ") + ",", parts.slice(k).join(", ")];
  }
  const room = IMG_W - 44 - Math.max(...credit.map((l) => ctx.measureText(l).width)) - 24 - (mx + 50);
  const iconOk = (id) => id && hasIcon(id);
  const lensIcon = lens ? (iconOk(lens.icon) ? lens.icon : null) : "terrain";
  if (lensIcon) drawIcon(ctx, lensIcon, mx + 20, cy - 16, 40, { shadow: true });
  ctx.fillStyle = "#ecd08e";
  ctx.font = `24px ${SERIF}`;
  spaced(ctx, 1.5);
  // The year shown (the lens's data year, or the timeline's year) always survives the truncation of a long name.
  // (as the tooltip does: "31/12/2025", "Jan–Sep 2026", left out when the name already holds that year, as a
  // timeline view's "Forest loss in 2001" does)
  const inName = lens && t(lens.name).includes(yearNum(info.year));
  const yr = info.year != null && info.year !== "" && !inName ? ` · ${fmtYear(info.year)}` : "";
  let title = (lens ? t("{name} lens", { name: t(lens.name) }) : t("Terrain")).toUpperCase();
  // ...and stops short of the selection's name on the right.
  const selName = info.selection?.name || "";
  ctx.font = `bold 24px ${SERIF}`;
  const selW = selName ? Math.min(460, ctx.measureText(selName).width) + 24 : 0;
  ctx.font = `24px ${SERIF}`;
  const titleW = Math.min(520, IMG_W - 44 - selW - (mx + 50));
  if (lens && ctx.measureText(title + yr).width > titleW) title = t(lens.name).toUpperCase(); // drop "lens" before the name
  // A long name ("TĂNG TRƯỞNG 9 THÁNG 2026 (ƯỚC TÍNH)") steps the font down to 18 px before it is cut.
  for (let px = 23; px >= 18 && ctx.measureText(title + yr).width > titleW; px--) ctx.font = `${px}px ${SERIF}`;
  ctx.fillText(fit(ctx, title, titleW - ctx.measureText(yr).width) + yr, mx + 50, cy - 8);
  spaced(ctx, 0);
  const cats = lens?.format === "category" && Array.isArray(lens.categories) && lens.categories.length ? lens.categories : null;
  if (cats) {
    // A categorical lens: one block per category, its name under it (as the dock's legend).
    // Each block is as wide as its name (plus a gap), scaled to the legend's width.
    const rx = mx + 50, ry = cy + 4, rw = Math.max(200, Math.min(330, room)), rh = 12;
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
    ctx.font = `12px ${SANS}`;
    const nw = cats.map((c) => ctx.measureText(t(c.name)).width + 8), k = rw / nw.reduce((a, b) => a + b, 0);
    if (k < 1) ctx.font = `11px ${SANS}`;
    ctx.textAlign = "center";
    let bx = rx;
    cats.forEach((c, i) => {
      const bw = nw[i] * k;
      ctx.fillStyle = c.color || lens.ramp?.[i] || "#888888";
      ctx.fillRect(bx, ry, bw, rh);
      ctx.fillStyle = "#d8cba8";
      ctx.fillText(fit(ctx, t(c.name), bw - 2), bx + bw / 2, ry + rh + 18);
      bx += bw;
    });
    ctx.textAlign = "left";
  } else if (lens?.ramp?.length) {
    const rx = mx + 50, ry = cy + 4, rw = Math.max(200, Math.min(330, room)), rh = 12;
    const rg = ctx.createLinearGradient(rx, 0, rx + rw, 0);
    lens.ramp.forEach((c, i) => rg.addColorStop(i / (lens.ramp.length - 1), c));
    ctx.fillStyle = "rgba(0,0,0,.6)";
    ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
    ctx.fillStyle = rg;
    ctx.fillRect(rx, ry, rw, rh);
    // The two end labels share the ramp's width: long units ("1,3K mm mỗi năm") shrink the font, then truncate.
    // (no "≤" on a ramp that starts at 0, as the legend: "≤ 0 storms" reads as if a count could be negative)
    let lo = (naturalEnd(lens, 0) || lens.domain?.[0] === 0 ? "" : "≤ ") + info.formatValue(lens, 0);
    const hi = (naturalEnd(lens, 1) ? "" : "≥ ") + info.formatValue(lens, 1);
    let px = 14;
    const both = () => (ctx.font = `${px}px ${SANS}`, ctx.measureText(lo).width + ctx.measureText(hi).width + 12);
    if (both() > rw) lo = lo.slice(0, lo.length - sharedUnit(lo, hi).length); // the unit once, after the top value
    while (px > 11 && both() > rw) px--;
    const cut = both() > rw ? (x) => fit(ctx, x, rw / 2 - 6) : (x) => x;
    ctx.fillStyle = "#d8cba8";
    ctx.textAlign = "left";
    ctx.fillText(cut(lo), rx, ry + rh + 18);
    ctx.textAlign = "right";
    ctx.fillText(cut(hi), rx + rw, ry + rh + 18);
    ctx.textAlign = "left";
  } else {
    ctx.font = `15px ${SANS}`;
    ctx.fillStyle = "#b9ab88";
    // Two lines when one does not fit left of the credit.
    const words = t("Land cover, relief, rivers and power plants").split(" ");
    let k = words.length;
    while (k > 1 && ctx.measureText(words.slice(0, k).join(" ")).width > room) k--;
    const rest = words.slice(k).join(" ");
    ctx.fillText(words.slice(0, k).join(" "), mx + 50, rest ? cy + 10 : cy + 16);
    if (rest) ctx.fillText(fit(ctx, rest, room), mx + 50, cy + 29);
  }

  // Selection, credits, site
  const rx = IMG_W - 44;
  ctx.textAlign = "right";
  const sel = info.selection;
  if (sel?.name) {
    ctx.font = `13px ${SANS}`;
    ctx.fillStyle = "#b9ab88";
    spaced(ctx, 2);
    ctx.fillText(sel.kind === "state" ? kindOf(sel.abbr).toLocaleUpperCase(lang) : t("CITY"), rx, cy - 30);
    spaced(ctx, 0);
    ctx.font = `bold 24px ${SERIF}`;
    ctx.fillStyle = "#f3e6c4";
    ctx.fillText(fit(ctx, sel.name, 460), rx, cy - 6);
  }
  ctx.font = `14px ${SANS}`;
  ctx.fillStyle = "#b9ab88";
  if (credit.length > 1) {
    ctx.fillText(credit[0], rx, cy + 12);
    ctx.fillText(credit[1], rx, cy + 27);
  } else ctx.fillText(credit[0], rx, cy + 20);
  ctx.font = `bold 17px ${SERIF}`;
  ctx.fillStyle = "#c9a45c";
  spaced(ctx, 1);
  ctx.fillText(siteLabel(), rx, cy + 42);
  const siteW = ctx.measureText(siteLabel()).width;
  spaced(ctx, 0);
  // The lens's own source when the fixed credit line does not name it (e.g. Hansen/UMD/Google/USGS/NASA, CC BY),
  // on the site line so the legend's room is unchanged.
  const extra = lensCredit(info.lensSource);
  if (extra) {
    ctx.font = `14px ${SANS}`;
    ctx.fillStyle = "#b9ab88";
    ctx.fillText(fit(ctx, extra + " ·", Math.max(0, rx - siteW - 12 - (mx + 50 + 340))), rx - siteW - 8, cy + 42);
  }
  ctx.textAlign = "left";

  // Thin gold frame around the whole picture
  ctx.strokeStyle = "rgba(201,164,92,.85)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, IMG_W - 2, imgH - 2);
  return cv;
}

/** " mm mỗi năm" for ("≤ 1,3K mm mỗi năm", "≥ 3,4K mm mỗi năm"): the common trailing words, from a space. */
export function sharedUnit(a, b) {
  let k = 0;
  while (k < a.length && k < b.length && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  const tail = a.slice(a.length - k), sp = tail.indexOf(" ");
  const unit = sp < 0 ? "" : tail.slice(sp);
  return !unit.trim() || /\d/.test(unit) ? "" : unit;
}

function fit(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 3 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

function star(ctx, x, y, R, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r : R;
    ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * opts: {button, getInfo() → composeImage info, fileName() → string, onToast(msg)}
 */
export function initShare(opts) {
  const btn = opts.button;
  const pop = document.getElementById("share-pop");
  if (!btn || !pop) return { close() {}, get isOpen() { return false; } };
  let restore = null;

  pop.innerHTML = `
    <div class="sp-title">${t("Share this view")}</div>
    <button class="sp-item" data-act="copy">${icon("share", "🔗", { size: 16 })}<span>${t("Copy link")}</span></button>
    <button class="sp-item" data-act="image">${icon("terrain", "🖼️", { size: 16 })}<span>${t("Download image")} <span class="muted">1600×900 PNG</span></span></button>
    <div class="sp-status" role="status" aria-live="polite"></div>
    <input class="sp-url" type="text" readonly hidden aria-label="${t("Link to this view")}">`;
  const status = pop.querySelector(".sp-status");
  const urlBox = pop.querySelector(".sp-url");

  function position() {
    const r = btn.getBoundingClientRect();
    const w = pop.offsetWidth || 250;
    pop.style.top = r.bottom + 8 + "px";
    pop.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + "px";
  }
  function open() {
    restore = document.activeElement;
    status.textContent = "";
    urlBox.hidden = true;
    pop.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    position();
    pop.querySelector(".sp-item")?.focus();
  }
  function close(restoreFocus = true) {
    if (pop.hidden) return;
    pop.hidden = true;
    btn.setAttribute("aria-expanded", "false");
    if (restoreFocus && restore && document.contains(restore)) restore.focus();
  }
  btn.addEventListener("click", () => (pop.hidden ? open() : close()));
  document.addEventListener("pointerdown", (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) close(false);
  });
  window.addEventListener("resize", () => !pop.hidden && position());

  pop.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    if (b.dataset.act === "copy") {
      opts.beforeCopy?.();
      const link = location.href;
      if (await copyText(link)) {
        status.textContent = t("Link copied to the clipboard");
        opts.onToast?.(t("Link copied"));
      } else {
        status.textContent = t("Copy this link:");
        urlBox.hidden = false;
        urlBox.value = link;
        urlBox.focus();
        urlBox.select();
      }
    } else if (b.dataset.act === "image") {
      status.textContent = t("Drawing the map…");
      await new Promise((r) => setTimeout(r, 30)); // let the status paint
      try {
        const cv = composeImage(opts.getInfo());
        const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
        if (!blob) throw new Error("toBlob failed");
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = opts.fileName();
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        status.textContent = t("Saved {file}", { file: a.download });
      } catch (err) {
        console.warn(err);
        status.textContent = t("Could not create the image in this browser.");
      }
    }
  });

  return {
    open,
    close,
    get isOpen() { return !pop.hidden; },
  };
}
