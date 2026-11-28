// Living tiles: per-hex life and interaction, drawn as app.motion items above the cached static map (which is never
// redrawn for them).
//   hover     (mouse only) the hex under the pointer lifts: a raised edge and a glow, still once it has faded in.
//             Its content reacts for ~1.4 s: trees rustle, paddies ripple, water rings; its 6 neighbours react more
//             faintly. Only that hex and its neighbours are drawn.
//   click     a ripple ring spreads from the hex, then a small card flips in beside it: terrain, elevation, land cover,
//             the rice-season stage (with "Rice seasons" on), province and commune, and a button that opens the
//             province panel. The card goes ALONGSIDE the click, which still selects the province or city as before
//             ("mapclick" handler that never consumes it). City tiles, layer sites and modes (City View, advisors)
//             keep their own clicks and get no card. Phones: a tap shows the card, no hover effects.
//   keyboard  the map has no keyboard hex focus (arrows pan), so I opens the card for the hex in the middle of the
//             map; focus moves to the card, Esc closes it (and goes on to do what Esc did before).
//   life      at close zoom (hex radius ≥ 44 css px) a buffalo or a farmer in a nón lá in some paddies, a boat on some
//             river hexes, ducks on some delta ponds: few, deterministic per hex, illustrative (life.js).
// Frames: a frame cap (30 fps desktop, 20 phone) while a hover or click effect runs, and for the life while it is on
// screen, motion is on and the map is not idle (app.motion.idle, 60 s): zero frames otherwise. Effects off or reduced
// motion: the lift and the life are drawn still, no rustle, ripples or ring.
import { t } from "../../i18n.js";
import { esc, int } from "../../format.js";
import { hexAt, lodFor } from "../../render/art/lod.js";
import { STAMP_KIND, drawTerrainGlyphs, isFieldCell } from "../../render/art/terrain.js";
import { bucketPx, getSprite, drawSprite } from "../../render/art/sprites.js";
import { hash01 } from "../../hex.js";
import { lifeAt, riverSpots, LIFE_SPRITES } from "./life.js";

const LIFE_MIN_RPX = 44, HOVER_MS = 1400, RING_MS = 750, MAX_STAMPS = 160;
const PCT = [["forest", "Forest"], ["crop", "Cropland"], ["pasture", "Pasture"], ["grass", "Grassland"], ["shrub", "Shrubland"],
  ["wetland", "Wetland"], ["developed", "Built-up"]];
const STAGE_NAME = { plant: "Transplanting (flooded fields)", grow: "Green rice", ripe: "Ripening", harvest: "Harvest (gold)", fallow: "Fallow" };
const SWAYS = new Set(["tree", "clump", "palm"]);

export function install(app) {
  const M = app.motion;
  if (!M?.register) return;
  const w = app.w, grid = w.grid, R = grid.R, raw = w.raw;
  const phone = !!app.isMobile?.();
  const perf = app.perf ? (app.perf.hexlife = []) : [];
  let on = true, mouse = false;
  const canvas = document.getElementById("map");
  canvas?.addEventListener("pointermove", (e) => { mouse = e.pointerType === "mouse"; }, { passive: true });
  const lensOn = () => !!(app.state.lens || app.shownLens?.());
  const cap = M.frameCap(1000 / (phone ? 20 : 30));

  // --- hover: the hex and its neighbours ----------------------------------------------------------------------------
  const hv = { cell: -1, at: 0, cells: [], key: "" };
  // recorded tree stamps of the hovered hex (weight 1) and its neighbours (weight .45), redrawn sheared while rustling
  const stamps = [];
  const recCv = document.createElement("canvas");
  recCv.width = recCv.height = 1;
  const rec = recCv.getContext("2d");
  const fake = { width: 1, height: 1 };
  Object.defineProperty(rec, "canvas", { value: fake });
  let recW = 1;
  rec.drawImage = (img, x, y, dw, dh) => {
    if (!SWAYS.has(STAMP_KIND.get(img)) || stamps.length >= MAX_STAMPS) return;
    stamps.push({ img, x, y, w: dw, h: dh, a: rec.globalAlpha, b: y + dh * 0.84, wgt: recW, ph: hash01(Math.round(x * 7 + y * 13), 21) * 6.283 });
  };
  function record(cam, dpr) {
    const s = cam.scale, Rpx = R * s, key = `${hv.cell}|${s}|${Math.round(cam.x)}|${Math.round(cam.y)}`;
    if (key === hv.key) return;
    hv.key = key;
    stamps.length = 0;
    if (hv.cell < 0 || Rpx < 18 || lensOn()) return;
    fake.width = Math.ceil(cam.w * dpr); fake.height = Math.ceil(cam.h * dpr);
    rec.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cam.w / 2 - cam.x * s), dpr * (cam.h / 2 - cam.y * s));
    const opt = { Rpx, s, lod: lodFor(Rpx), bridges: true }; // bridges as in the cache, so the same stamps come back
    const land = (i) => i >= 0 && !w.water[i];
    recW = 1;
    if (land(hv.cell)) drawTerrainGlyphs(rec, [hv.cell], w, opt);
    recW = 0.45;
    const nb = hv.cells.slice(1).filter(land);
    if (nb.length) drawTerrainGlyphs(rec, nb, w, opt);
  }
  function setHover(cell) {
    if (cell === hv.cell) return;
    hv.cell = cell;
    hv.at = performance.now();
    hv.key = "";
    hv.cells = cell < 0 ? [] : [cell];
    for (let d = 0; d < 6 && cell >= 0; d++) {
      const j = grid.neighbour(cell, d);
      if (j >= 0) hv.cells.push(j);
    }
    app.requestDraw();
  }
  app.on("hover", (h) => {
    if (!on || phone || !mouse) { if (hv.cell >= 0) setHover(-1); return; }
    setHover(h?.cell ?? -1);
  });

  // --- click: the ripple ring and the card -----------------------------------------------------------------------
  const ring = { cell: -1, at: -1e9 };
  const card = document.createElement("div");
  card.className = "panel hl-card";
  card.hidden = true;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", t("Hex details"));
  document.body.appendChild(card);
  let cardCell = -1, cardTimer = 0;

  app.on("mapclick", (ev) => {
    if (!on || app.mode || ev.city || ev.layer || !(ev.cell >= 0)) return false;
    open(ev.cell, false);
    return false; // never consumes it: the click still selects the province as before
  });
  function open(cell, focus) {
    ring.cell = cell;
    ring.at = performance.now();
    clearTimeout(cardTimer);
    app.requestDraw();
    // the card flips in as the ring spreads (at once with Effects off)
    if (M.enabled) cardTimer = setTimeout(() => showCard(cell, focus), 220);
    else showCard(cell, focus);
  }
  function hideCard() {
    clearTimeout(cardTimer);
    if (card.hidden) return;
    card.hidden = true;
    cardCell = -1;
  }

  function cardHtml(i) {
    const rows = [];
    const row = (k, v) => rows.push(`<dt>${esc(k)}</dt><dd>${v}</dd>`);
    const name = (table, id) => t(table.find((x) => x.id === id)?.name || "");
    let title;
    if (w.water[i]) {
      title = name(w.tables.water, w.water[i]) || t("Water");
      if (raw.elev[i] < 0) row(t("Elevation"), esc(t("{n} m deep", { n: int(-raw.elev[i]) })));
    } else {
      title = [w.cover[i] > 0 ? name(w.tables.cover, w.cover[i]) : "", w.relief[i] > 0 ? name(w.tables.relief, w.relief[i]) : ""].filter(Boolean).join(" · ") || t("Land");
      if (!(raw.remote || []).includes(i)) row(t("Elevation"), `${esc(int(raw.elev[i]))} m`);
      if (w.pct) {
        const parts = PCT.map(([k, label]) => [label, w.pct[k]?.[i] || 0]).filter((p) => p[1] >= 5).sort((a, b) => b[1] - a[1]).slice(0, 3);
        if (parts.length) row(t("Land cover"), parts.map(([label, p]) => `${esc(t(label))} ${esc(int(p))}%`).join(" · "));
      }
      const stage = riceStage(i);
      if (stage) row(t("Rice season"), `<i class="hl-sw" style="background:${esc(stage.color)}"></i>${esc(t(STAGE_NAME[stage.id]))}`);
    }
    const o = raw.owner[i];
    if (o >= 0) {
      row(t("Province"), esc(raw.states[o].name));
      const c = commune(i);
      if (c) row(t("Commune"), esc(c));
    } else if (o === -2) rows.push(`<dd class="hl-muted">${esc(t("Beyond the borders (not mapped)"))}</dd>`);
    const btn = o >= 0 ? `<button type="button" class="hl-open">${esc(t("Open {name}", { name: raw.states[o].name }))}</button>` : "";
    return `<div class="hl-in"><button type="button" class="hl-x" aria-label="${esc(t("Close"))}" title="${esc(t("Close"))}">×</button>
      <div class="hl-title">${esc(title)}</div><dl>${rows.join("")}</dl>${btn}
      <div class="hl-note">${esc(t("Farm and village motifs on the map are illustrative."))}</div></div>`;
  }
  let riceIdx = null;
  function riceStage(i) {
    const L = app.living?.data, S = app.living?.seasons;
    if (!L?.rice || !S || !app.living.on?.seasons) return null;
    riceIdx ||= new Map(L.rice.cells.map((c, k) => [c, k]));
    const k = riceIdx.get(i);
    if (k == null) return null;
    const id = S.stageOf(app.living.month())[L.rice.region[k]];
    return id ? { id, color: { plant: "#86c2b4", grow: "#47a838", ripe: "#b9c23a", harvest: "#e7b532", fallow: "#a4855a" }[id] } : null;
  }
  function commune(i) {
    const st = app.communes?.state;
    if (!st?.model) {
      // communes.json is lazy (0.4 MB): load it once a card asks, then fill the line in
      app.communes?.load?.().then(() => { if (cardCell === i && !card.hidden) fill(i); });
      return null;
    }
    const layer = app.staticLayers?.().find((l) => l.id === "communes");
    return layer?.hit?.(grid.cx(i), grid.cy(i))?.full || null;
  }
  function fill(i) {
    card.innerHTML = cardHtml(i);
    app.emit("hexcard", { cell: i, el: card.querySelector(".hl-in") }); // extensions add to the card (ext/explore: photos)
  }
  function showCard(cell, focus) {
    cardCell = cell;
    fill(cell);
    card.hidden = false;
    card.classList.remove("hl-flip");
    void card.offsetWidth; // restart the flip
    card.classList.add("hl-flip");
    place();
    if (focus) (card.querySelector(".hl-open") || card.querySelector(".hl-x"))?.focus();
  }
  // beside the hex, inside the part of the map free of panels and docks; hidden when the hex leaves it
  function place() {
    if (card.hidden || cardCell < 0) return;
    const cam = app.cam, a = app.visibleArea?.() || { x0: 0, y0: 0, x1: innerWidth, y1: innerHeight };
    const [sx, sy] = cam.toScreen(grid.cx(cardCell), grid.cy(cardCell));
    if (sx < a.x0 || sx > a.x1 || sy < a.y0 || sy > a.y1) { card.style.visibility = "hidden"; return; }
    card.style.visibility = "";
    const cw = card.offsetWidth, ch = card.offsetHeight, r = R * cam.scale;
    let x = sx + r + 10;
    if (x + cw > a.x1 - 6) x = sx - r - 10 - cw;
    x = Math.max(a.x0 + 6, Math.min(x, a.x1 - cw - 6));
    let y = Math.max(a.y0 + 6, Math.min(sy - ch / 2, a.y1 - ch - 6));
    // visibleArea() leaves the minimap corner in: keep the card off it (lift it above, or beside it if no room)
    const mm = document.getElementById("minimap-wrap")?.getBoundingClientRect();
    if (mm && mm.width && x < mm.right && x + cw > mm.left && y < mm.bottom && y + ch > mm.top) {
      if (mm.top - ch - 6 >= a.y0 + 6) y = mm.top - ch - 6; else x = Math.min(mm.right + 6, a.x1 - cw - 6);
    }
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
  }
  card.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.classList.contains("hl-x")) hideCard();
    else if (b.classList.contains("hl-open") && raw.owner[cardCell] >= 0) {
      app.selectState(raw.owner[cardCell], { fly: false });
      hideCard();
    }
  });
  app.on("camera", place);
  app.on("escape", () => { hideCard(); return false; }); // closes the card and lets Esc go on as before
  app.on("mode", hideCard);
  window.addEventListener("keydown", (e) => {
    if (!on || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (e.key !== "i" && e.key !== "I")) return;
    const tg = e.target;
    if (tg && (/^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName) || tg.isContentEditable)) return;
    if ([...document.querySelectorAll('[aria-modal="true"]')].some((m) => m.offsetParent)) return; // a dialog is up
    const a = app.visibleArea?.(), cell = a ? app.cellAt((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2) : -1;
    if (cell < 0) return;
    e.preventDefault();
    open(cell, true);
  });

  // --- close-zoom life ---------------------------------------------------------------------------------------------
  let rivers = null, lifeKey = "";
  const life = [];
  function collectLife(cam) {
    const s = cam.scale, Rpx = R * s, v = cam.view();
    const key = `${s}|${Math.round(v.x0)}|${Math.round(v.y0)}|${Math.round(v.x1)}|${Math.round(v.y1)}`;
    if (key === lifeKey) return;
    lifeKey = key;
    life.length = 0;
    if (Rpx < LIFE_MIN_RPX) return;
    rivers ||= riverSpots(w);
    const g = grid.range(v.x0 - R, v.y0 - R, v.x1 + R, v.y1 + R);
    for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
      const i = r * grid.cols + c;
      const it = i >= 0 && i < grid.size ? lifeAt(w, i, rivers, Rpx) : null;
      if (it) { it.ph = hash01(i, 820) * 6.283; life.push(it); }
    }
  }
  function drawLife(ctx, cam, dpr, tt) {
    const upx = bucketPx(R * dpr * cam.scale, { min: 6, max: 256 }), k = R;
    const spr = (kind) => getSprite(`hexlife:${kind}`, upx, LIFE_SPRITES[kind].box, LIFE_SPRITES[kind].paint);
    for (const it of life) {
      const p = it.ph, x = it.x, y = it.y;
      if (it.kind === "buffalo") drawSprite(ctx, spr("buffalo"), x + Math.sin(tt * 0.22 + p) * 0.05 * R, y, k);
      else if (it.kind === "farmer") drawSprite(ctx, spr("farmer"), x + Math.sin(tt * 0.4 + p) * 0.012 * R, y, k);
      else if (it.kind === "boat") {
        const d = Math.sin(tt * 0.16 + p) * 0.12 * R;
        drawSprite(ctx, spr("boat"), x + Math.cos(it.ang) * d, y + Math.sin(it.ang) * d + Math.sin(tt * 1.7 + p) * 0.006 * R, k);
      } else {
        const d = spr("duck");
        for (let q = 0; q < 4; q++) {
          const a = tt * 0.3 + p + (q * Math.PI) / 2 + (q % 2) * 0.4;
          drawSprite(ctx, d, x + Math.cos(a) * 0.07 * R, y + Math.sin(a) * 0.03 * R, k);
        }
      }
    }
  }

  // --- the motion item ---------------------------------------------------------------------------------------------
  const hovering = (now) => hv.cell >= 0 && now - hv.at < HOVER_MS && !lensOn();
  const ringing = (now) => ring.cell >= 0 && now - ring.at < RING_MS;
  const lifeMoves = () => life.length > 0 && !M.idle && !lensOn();
  let clock = 0, clockAt = 0;
  M.register({
    id: "hexlife", z: 32,
    active: () => {
      if (!on || !M.enabled) return false;
      const now = performance.now();
      return (hovering(now) || ringing(now) || lifeMoves()) && cap.due();
    },
    draw(ctx, cam, a, f) {
      if (!on) return;
      const t0 = performance.now();
      const still = f.still || !M.enabled;
      const animate = !still && (hovering(t0) || ringing(t0) || lifeMoves());
      if (animate) { clock += clockAt ? Math.min(t0 - clockAt, 250) : 0; clockAt = t0; cap.drew(); } else clockAt = 0;
      const tt = clock / 1000;
      if (!f.moving) collectLife(cam);
      if (life.length && !lensOn() && !f.moving) drawLife(ctx, cam, f.dpr, tt);
      if (hv.cell >= 0 && !phone) {
        const te = (t0 - hv.at) / 1000;
        if (!still && !f.moving && hovering(t0)) {
          record(cam, f.dpr);
          react(ctx, cam, f, te);
        }
        lift(ctx, cam, hv.cell, still ? 1 : Math.min(1, te / 0.16));
      }
      if (!still && ringing(t0)) drawRing(ctx, cam, (t0 - ring.at) / RING_MS);
      if (perf.push(performance.now() - t0) > 120) perf.shift();
    },
  });

  const K = grid.corners;
  function edges(ctx, x, y, from, n, f = 1, dx = 0, dy = 0) {
    ctx.beginPath();
    for (let q = 0; q <= n; q++) {
      const c = K[(from + q) % 6];
      const px = x + c[0] * f + dx, py = y + c[1] * f + dy;
      q ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
  }
  /** The raised hex: a glow, a shadow under the lower-right edges, a lit rim on the upper-left ones. */
  function lift(ctx, cam, i, p) {
    const x = grid.cx(i), y = grid.cy(i), s = cam.scale;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    hexAt(ctx, x, y, R, 1);
    ctx.strokeStyle = `rgba(255,222,140,${0.22 * p})`;
    ctx.lineWidth = Math.max(6 / s, R * 0.16);
    ctx.stroke();
    // corners: 0 upper right, 1 lower right, 2 bottom, 3 lower left, 4 upper left, 5 top
    edges(ctx, x, y, 0, 3, 1.02, R * 0.03, R * 0.05);
    ctx.strokeStyle = `rgba(20,16,8,${0.4 * p})`;
    ctx.lineWidth = Math.max(3 / s, R * 0.07);
    ctx.stroke();
    edges(ctx, x, y, 3, 3, 0.95);
    ctx.strokeStyle = `rgba(255,250,226,${0.75 * p})`;
    ctx.lineWidth = Math.max(1.5 / s, R * 0.035);
    ctx.stroke();
  }
  /** Trees rustle, paddies ripple, water rings: the hovered hex (weight 1) and its neighbours (fainter, later). */
  function react(ctx, cam, f, te) {
    const s = cam.scale, a = f.dpr * s, e = f.dpr * (cam.w / 2 - cam.x * s), fy = f.dpr * (cam.h / 2 - cam.y * s);
    for (const st of stamps) {
      const t1 = te - (st.wgt < 1 ? 0.12 : 0);
      if (t1 <= 0) continue;
      const shx = st.wgt * 0.07 * Math.exp(-t1 * 2.4) * Math.sin(t1 * 15 + st.ph);
      ctx.globalAlpha = st.a;
      ctx.setTransform(a, 0, -a * shx, a, e + a * shx * st.b, fy);
      ctx.drawImage(st.img, st.x, st.y, st.w, st.h);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(a, 0, 0, a, e, fy);
    const fade = Math.max(0, 1 - te / (HOVER_MS / 1000));
    hv.cells.forEach((i, n) => {
      const wgt = n ? 0.45 : 1, t1 = te - (n ? 0.12 : 0);
      if (t1 <= 0) return;
      const water = !!w.water[i], field = !water && isFieldCell(w, i, R * s);
      if (!water && !field) return;
      const x = grid.cx(i), y = grid.cy(i);
      ctx.save();
      ctx.beginPath();
      hexAt(ctx, x, y, R, 0.97);
      ctx.clip();
      ctx.lineWidth = R * (water ? 0.025 : 0.1);
      if (field) {
        // wind over the rice: two soft light bands running across the hex
        for (let q = 0; q < 2; q++) {
          const u = ((t1 * 1.1 + q * 0.6) % 1.6) - 0.8;
          ctx.strokeStyle = `rgba(255,252,220,${0.28 * wgt * fade})`;
          ctx.beginPath();
          for (let k = -10; k <= 10; k++) {
            const px = x + k * R * 0.1, py = y + u * R * 1.6 + Math.sin(k * 0.7 + t1 * 3) * R * 0.05 - k * R * 0.04;
            k > -10 ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.stroke();
        }
      } else {
        // rings on the water at three spots
        for (let q = 0; q < 3; q++) {
          const cx = x + (hash01(i, 830 + q) - 0.5) * R, cy = y + (hash01(i, 840 + q) - 0.5) * R;
          const p = ((t1 * 0.8 + q * 0.33) % 1);
          ctx.strokeStyle = `rgba(235,248,255,${0.6 * wgt * fade * (1 - p)})`;
          ctx.beginPath();
          ctx.ellipse(cx, cy, R * (0.06 + p * 0.3), R * (0.03 + p * 0.15), 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }
  function drawRing(ctx, cam, p) {
    const x = grid.cx(ring.cell), y = grid.cy(ring.cell);
    for (const [d, a] of [[0, 0.85], [0.18, 0.5]]) {
      const q = Math.max(0, Math.min(1, (p - d) / (1 - d)));
      if (q <= 0 || q >= 1) continue;
      ctx.beginPath();
      hexAt(ctx, x, y, R, 0.6 + q * 2.6);
      ctx.strokeStyle = `rgba(255,236,170,${a * (1 - q)})`;
      ctx.lineWidth = Math.max(2 / cam.scale, R * 0.06 * (1 - q * 0.6));
      ctx.stroke();
    }
  }

  // --- the switch ----------------------------------------------------------------------------------------------------
  app.ui?.addMapToggle?.({
    id: "hexlife", group: "display", icon: "⬡", hash: false, default: true,
    label: t("Living tiles"),
    title: t("The hex under the pointer lifts and its trees, paddies or water stir; a click or tap (or I for the middle of the map) shows a card about the hex beside the usual selection. Up close, a few buffaloes, farmers, boats and ducks: illustrative, not real data."),
    get: () => on,
    set: (v) => { on = !!v; if (!on) { hideCard(); setHover(-1); } lifeKey = ""; app.requestDraw(); },
  });
  injectStyle();
  app.hexlife = { get on() { return on; }, get life() { return life.length; }, get stamps() { return stamps.length; }, open: (cell) => open(cell, false), hideCard, place, get cell() { return card.hidden ? -1 : cardCell; }, perf };
}

function injectStyle() {
  const s = document.createElement("style");
  s.id = "hl-style";
  s.textContent = `
.hl-card { position: fixed; z-index: 17; width: min(250px, calc(100vw - 20px)); padding: 0; font-size: 12px; color: var(--ink); box-sizing: border-box; perspective: 600px; }
.hl-card[hidden] { display: none; }
.hl-in { position: relative; padding: 8px 10px 7px; }
.hl-flip .hl-in { animation: hl-flip .32s cubic-bezier(.2,.8,.3,1) both; transform-origin: left center; }
@keyframes hl-flip { from { transform: rotateY(-88deg); opacity: .2; } to { transform: none; opacity: 1; } }
.no-motion .hl-flip .hl-in { animation: none; }
@media (prefers-reduced-motion: reduce) { .hl-flip .hl-in { animation: none; } }
.hl-title { font: 600 14px var(--serif); color: var(--gold-bright); padding-right: 22px; margin-bottom: 4px; }
.hl-card dl { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; margin: 0 0 6px; }
.hl-card dt { color: var(--ink-dim); }
.hl-card dd { margin: 0; }
.hl-muted { color: var(--ink-dim); grid-column: 1 / -1; }
.hl-sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 5px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.35); }
.hl-x { position: absolute; top: 4px; right: 4px; background: none; border: 0; color: var(--ink-dim); font-size: 17px; line-height: 1; cursor: pointer; padding: 2px 6px; }
.hl-x:hover, .hl-x:focus-visible { color: var(--gold-bright); }
.hl-open { background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--gold-bright); cursor: pointer; font: inherit; padding: 3px 8px; }
.hl-open:hover, .hl-open:focus-visible { background: rgba(201,164,92,.15); }
.hl-note { color: var(--ink-dim); font-size: 10.5px; margin-top: 5px; }
@media (max-width: 700px) { .hl-card { width: min(230px, calc(100vw - 12px)); font-size: 11.5px; } .hl-note { display: none; } }`;
  document.head.appendChild(s);
}
