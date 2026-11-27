// Everyday life & heritage layers (poi.json, relics.json): hospitals, universities & colleges, markets, places of
// worship, special national relics, beaches, protected areas, urban rail and major bridges. Each is a static layer
// with a switch in the Layers menu. Glyphs are small canvas medallions drawn in screen space, zoom-gated per kind and
// decluttered on a screen grid (first in priority order wins a slot), so a few thousand points cost about a millisecond.
// relics.json (small) loads at start because relics are on by default; poi.json loads when any other switch turns on.
import { t, lang } from "../../i18n.js";
import { esc, int, fixed } from "../../format.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Religion index (poi.json "religions") → [label, colour, glyph]
const RELIGION = {
  buddhist: ["Buddhist pagoda or temple", "#c98a1b", "pagoda"], christian: ["Church", "#6a4fb3", "cross"],
  caodaism: ["Cao Đài temple", "#2e8b57", "eye"], hoahaoism: ["Hòa Hảo place of worship", "#3f7f9f", "eye"],
  muslim: ["Mosque", "#1f8a70", "crescent"], hindu: ["Hindu temple", "#d0632a", "pagoda"],
  folk: ["Communal house, shrine or temple (folk religion)", "#9a4f2a", "roof"], other: ["Place of worship", "#6f6a64", "roof"],
};

// One entry per switch. kind = poi.json points key (or "metro" / "relic"); minRpx = zoom (hex radius in css px)
// from which glyphs show; style(row) → {color, glyph, prio (lower = drawn later / first to give way), minRpx?}.
const KINDS = [
  { id: "relics", kind: "relic", group: "culture", label: "Special national relics", icon: "w-landmark", def: true, minRpx: 0, z: 64,
    title: "The special national relics (di tích quốc gia đặc biệt) ranked by the Prime Minister, from the Vietnamese Wikipedia list",
    style: () => ({ color: "#8c1c13", glyph: "star", ring: "#f2c94c" }) },
  { id: "worship", kind: "worship", group: "culture", label: "Places of worship", icon: "l-faith", def: false, minRpx: 9, z: 62,
    title: "Pagodas, churches, temples and communal houses mapped in OpenStreetMap",
    style: (r, d) => { const s = RELIGION[d.religions[r[4]]] || RELIGION.other; return { color: s[1], glyph: s[2] }; } },
  { id: "hospitals", kind: "hospital", group: "living", label: "Hospitals", icon: "i-health", def: false, minRpx: 5, z: 63,
    title: "Hospitals mapped in OpenStreetMap (health centres and stations from a closer zoom)",
    style: (r) => ({ color: r[4] ? "#d23b3b" : "#e07a7a", glyph: "plus", minRpx: r[4] ? 5 : 12 }) },
  { id: "universities", kind: "university", group: "living", label: "Universities & colleges", icon: "w-university", def: false, minRpx: 6, z: 63,
    title: "University and college campuses mapped in OpenStreetMap",
    style: (r) => ({ color: r[4] ? "#2f5fb3" : "#5a83c9", glyph: "cap" }) },
  { id: "markets", kind: "market", group: "living", label: "Markets", icon: "i-retail", def: false, minRpx: 10, z: 62,
    title: "Markets (chợ) mapped in OpenStreetMap",
    style: () => ({ color: "#d9822b", glyph: "basket" }) },
  { id: "beaches", kind: "beach", group: "nature", label: "Beaches", icon: "w-park", def: false, minRpx: 4, z: 62,
    title: "Named beaches mapped in OpenStreetMap",
    style: () => ({ color: "#d9a520", glyph: "wave" }) },
  { id: "reserves", kind: "protected", group: "nature", label: "Nature reserves", icon: "l-forest", def: false, minRpx: 2.5, z: 61,
    title: "Nature reserves and other protected areas of 10 km² or more mapped in OpenStreetMap (national parks are under Wonders)",
    style: () => ({ color: "#3e8e41", glyph: "tree" }) },
  { id: "metro", kind: "metro", group: "transport", label: "Urban rail", icon: "t-rail", def: false, minRpx: 3, z: 61,
    title: "Metro and urban rail lines of Hà Nội and TP. Hồ Chí Minh mapped in OpenStreetMap" },
  { id: "bridges", kind: "bridge", group: "transport", label: "Major bridges", icon: "t-road", def: false, minRpx: 5, z: 63,
    title: "Named road bridges 500 m or longer on expressways, national and primary roads, mapped in OpenStreetMap",
    style: () => ({ color: "#5b6670", glyph: "arch" }) },
];

// Relic categories come in Vietnamese from the list ("Di tích lịch sử, khảo cổ"); English mode names each part.
const RELIC_CAT_EN = { "lịch sử": "history", "kiến trúc nghệ thuật": "architecture and art", "khảo cổ": "archaeology",
  "khảo cố": "archaeology", "danh lam thắng cảnh": "scenic landscape" };
function relicCategory(s) {
  if (!s || lang === "vi") return s || "";
  const parts = s.toLowerCase().replace(/^di tích /, "").split(/,\s*/).map((p) => RELIC_CAT_EN[p]);
  if (parts.some((p) => !p)) return s;
  const en = parts.join(", ");
  return en[0].toUpperCase() + en.slice(1);
}

const KIND_LABEL = {
  relic: "Special national relic", hospital: "Hospital", university: "University", market: "Market", beach: "Beach",
  protected: "Protected area", bridge: "Bridge", metro: "Urban rail line",
};

// --- glyphs (screen px, white on a coloured disk) --------------------------------------------------------------
function glyph(ctx, g, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 20, s / 20); // drawn on a 20-unit box centred on 0
  ctx.fillStyle = ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.2;
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.beginPath();
  switch (g) {
    case "plus": ctx.fillRect(-1.8, -6, 3.6, 12); ctx.fillRect(-6, -1.8, 12, 3.6); break;
    case "cross": ctx.fillRect(-1.3, -7, 2.6, 14); ctx.fillRect(-4.5, -3.5, 9, 2.6); break;
    case "star":
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 2.9 : 6.8;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill(); break;
    case "pagoda":
      ctx.moveTo(-7, -1); ctx.quadraticCurveTo(0, -3, 7, -1); ctx.lineTo(4, -4); ctx.lineTo(-4, -4); ctx.closePath();
      ctx.moveTo(-6, 4); ctx.quadraticCurveTo(0, 2, 6, 4); ctx.lineTo(3.5, 1); ctx.lineTo(-3.5, 1); ctx.closePath();
      ctx.fill(); ctx.fillRect(-0.9, -7, 1.8, 3); ctx.fillRect(-2.5, 4, 5, 3); break;
    case "roof":
      ctx.moveTo(-7.5, 0); ctx.quadraticCurveTo(0, -3.5, 7.5, 0); ctx.lineTo(4, -5); ctx.lineTo(-4, -5); ctx.closePath(); ctx.fill();
      ctx.fillRect(-5, 0, 2.2, 6); ctx.fillRect(2.8, 0, 2.2, 6); break;
    case "eye":
      ctx.moveTo(-7, 0); ctx.quadraticCurveTo(0, -7, 7, 0); ctx.quadraticCurveTo(0, 7, -7, 0); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill(); break;
    case "crescent":
      ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = "destination-out"; ctx.beginPath(); ctx.arc(2.6, -1.2, 5, 0, Math.PI * 2); ctx.fill(); break;
    case "cap":
      ctx.moveTo(0, -6); ctx.lineTo(8, -2); ctx.lineTo(0, 2); ctx.lineTo(-8, -2); ctx.closePath(); ctx.fill();
      ctx.fillRect(-4.5, 0, 9, 4.5); ctx.fillRect(6, -2, 1.4, 6); break;
    case "basket":
      ctx.moveTo(-7, -1); ctx.lineTo(7, -1); ctx.lineTo(5, 6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.arc(0, -1, 4.5, Math.PI, 0); ctx.stroke(); break;
    case "wave":
      for (const dy of [-2.5, 3]) { ctx.moveTo(-7, dy); ctx.bezierCurveTo(-3.5, dy - 4, -3.5, dy + 3, 0, dy); ctx.bezierCurveTo(3.5, dy - 4, 3.5, dy + 3, 7, dy); }
      ctx.stroke(); break;
    case "tree":
      ctx.moveTo(0, -7.5); ctx.lineTo(6, 2); ctx.lineTo(-6, 2); ctx.closePath(); ctx.fill(); ctx.fillRect(-1.2, 2, 2.4, 5); break;
    case "arch":
      ctx.moveTo(-8, 2); ctx.lineTo(8, 2); ctx.moveTo(-7, 2); ctx.quadraticCurveTo(0, -9, 7, 2); ctx.stroke(); break;
  }
  ctx.restore();
}

function paintMedallion(ctx, st, x, y, s) {
  ctx.beginPath();
  ctx.arc(x, y, s / 2, 0, Math.PI * 2);
  ctx.fillStyle = st.color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.strokeStyle = st.ring || "rgba(255,250,236,.95)";
  ctx.stroke();
  if (s >= 9) glyph(ctx, st.glyph, x, y, s * 0.8);
}

// Sprites per (style, size, device scale): painting paths for thousands of glyphs costs ms, a drawImage does not.
const sprites = new Map();
function medallion(ctx, st, x, y, s, dpr = 1) {
  const sz = Math.round(s * 2) / 2;
  const key = `${st.color}|${st.glyph}|${st.ring || ""}|${sz}|${dpr}`;
  let c = sprites.get(key);
  if (!c) {
    const px = Math.ceil((sz + 4) * dpr);
    c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.scale(dpr, dpr);
    paintMedallion(g, st, (sz + 4) / 2, (sz + 4) / 2, sz);
    if (sprites.size > 400) sprites.clear();
    sprites.set(key, c);
  }
  ctx.drawImage(c, x - (sz + 4) / 2, y - (sz + 4) / 2, sz + 4, sz + 4);
}

// --- point layers ----------------------------------------------------------------------------------------------
function pointLayer(app, spec, get, on) {
  const R = () => app.w.grid.R;
  let drawn = []; // [{row, x, y, r (world units)}] from the last cache render, for hit tests
  return {
    id: `poi-${spec.id}`, z: spec.z, minRpx: spec.minRpx,
    visible: () => !!on[spec.id] && !!get(),
    sig: () => (get() ? "1" : "0"),
    draw(ctx, vp, w, o) {
      const d = get();
      const rows = spec.kind === "relic" ? d.relics : d.points[spec.kind];
      const s = o.Rpx / R();
      const size = clamp(o.Rpx * (spec.id === "relics" ? 0.7 : 0.55), spec.id === "relics" ? 7 : 9, 20);
      // Declutter: a glyph is drawn only if no glyph already placed (earlier = higher priority) has its centre within
      // gap px. Bucketed on a world-anchored grid of gap-sized cells (3×3 neighbours checked), so a pan doesn't
      // reshuffle the winners. (A plain one-glyph-per-cell grid let two glyphs either side of a cell edge overlap.)
      const gap = size * (o.Rpx < 14 ? 1.7 : 1.15); // sparser when zoomed out
      const pad = (gap + size) / s;
      const cells = new Map();
      const near = (gx, gy, px, py) => {
        for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) {
          for (const q of cells.get(i * 100003 + j) || []) if ((q[0] - px) ** 2 + (q[1] - py) ** 2 < gap * gap) return true;
        }
        return false;
      };
      drawn = [];
      o.screen();
      for (const r of rows) {
        if (r[0] < vp.x0 - pad || r[0] > vp.x1 + pad || r[1] < vp.y0 - pad || r[1] > vp.y1 + pad) continue;
        const st = spec.style(r, d);
        if (st.minRpx && o.Rpx < st.minRpx) continue;
        const px = r[0] * s, py = r[1] * s, gx = Math.floor(px / gap), gy = Math.floor(py / gap);
        if (near(gx, gy, px, py)) continue;
        const key = gx * 100003 + gy;
        if (cells.has(key)) cells.get(key).push([px, py]); else cells.set(key, [[px, py]]);
        const [sx, sy] = o.toScreen(r[0], r[1]);
        medallion(ctx, st, sx, sy, size, o.dpr || 1);
        drawn.push({ row: r, x: r[0], y: r[1], r: (size / 2 + 2) / s, kind: spec.kind });
      }
      o.world();
    },
    hit(x, y) {
      let best = null, bd = Infinity;
      for (const it of drawn) {
        const dd = (it.x - x) ** 2 + (it.y - y) ** 2;
        if (dd <= it.r * it.r && dd < bd) { best = it; bd = dd; }
      }
      return best;
    },
    drawn: () => drawn,
    tooltip: (it) => tip(app, it, get()),
    click(it) {
      app.flyTo(it.x, it.y, Math.max(app.cam.scale, 22 / R()), 700);
      return true;
    },
  };
}

// --- metro & bridge lines ---------------------------------------------------------------------------------------
function segDist2(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  const u = l ? clamp(((px - x1) * dx + (py - y1) * dy) / l, 0, 1) : 0;
  return (px - x1 - u * dx) ** 2 + (py - y1 - u * dy) ** 2;
}

function lineLayer(app, spec, get, on) {
  const R = () => app.w.grid.R;
  let bbox = null; // per line [x0, y0, x1, y1]
  const lines = () => {
    const d = get();
    if (spec.kind === "metro") return d.metro;
    return []; // bridges are drawn as spans under their glyphs (see bridgeSpans)
  };
  return {
    id: `poi-${spec.id}`, z: spec.z, minRpx: spec.minRpx,
    visible: () => !!on[spec.id] && !!get(),
    sig: () => (get() ? "1" : "0"),
    draw(ctx, vp, w, o) {
      const ls = lines();
      if (!bbox) bbox = ls.map((l) => {
        const b = [Infinity, Infinity, -Infinity, -Infinity];
        for (const p of l.paths) for (let k = 0; k < p.length; k += 2) {
          b[0] = Math.min(b[0], p[k]); b[1] = Math.min(b[1], p[k + 1]); b[2] = Math.max(b[2], p[k]); b[3] = Math.max(b[3], p[k + 1]);
        }
        return b;
      });
      const s = o.Rpx / R();
      ctx.lineCap = ctx.lineJoin = "round";
      ls.forEach((l, i) => {
        const b = bbox[i];
        if (b[2] < vp.x0 || b[0] > vp.x1 || b[3] < vp.y0 || b[1] > vp.y1) return;
        for (const [wid, col] of [[clamp(o.Rpx * 0.32, 3, 7) + 2.5, "rgba(255,255,255,.9)"], [clamp(o.Rpx * 0.32, 3, 7), l.colour || "#c2185b"]]) {
          ctx.lineWidth = wid / s;
          ctx.strokeStyle = col;
          ctx.beginPath();
          for (const p of l.paths) {
            ctx.moveTo(p[0], p[1]);
            for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
          }
          ctx.stroke();
        }
      });
    },
    hit(x, y, Rpx) {
      const s = Rpx / R(), tol = (8 / s) ** 2;
      for (const l of lines()) for (const p of l.paths) for (let k = 2; k < p.length; k += 2) {
        if (segDist2(x, y, p[k - 2], p[k - 1], p[k], p[k + 1]) <= tol) return { kind: "metro", line: l, x, y };
      }
      return null;
    },
    tooltip: (it) => tip(app, it, get()),
    click(it) { app.flyTo(it.x, it.y, Math.max(app.cam.scale, 14 / R()), 700); return true; },
  };
}

// Bridge spans: a grey bar between the bridge's mapped ends, under its glyph.
function bridgeSpans(app, get, on) {
  const R = () => app.w.grid.R;
  return {
    id: "poi-bridge-spans", z: 56.5, minRpx: 8,
    visible: () => !!on.bridges && !!get(),
    sig: () => (get() ? "1" : "0"),
    draw(ctx, vp, w, o) {
      const s = o.Rpx / R();
      ctx.lineCap = "round";
      ctx.strokeStyle = "#4a535b";
      ctx.lineWidth = clamp(o.Rpx * 0.22, 2.5, 6) / s;
      ctx.beginPath();
      for (const r of get().points.bridge) {
        const [x1, y1, x2, y2] = r[5];
        if (Math.max(x1, x2) < vp.x0 || Math.min(x1, x2) > vp.x1 || Math.max(y1, y2) < vp.y0 || Math.min(y1, y2) > vp.y1) continue;
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    },
  };
}

// --- tooltips --------------------------------------------------------------------------------------------------
const muted = (s) => `<span class="muted">${s}</span>`;

function provName(app, d, idx) {
  const abbr = d?.states?.[idx];
  return app.data.world?.states?.find((s) => s.abbr === abbr)?.name || abbr || "";
}

function tip(app, it, d) {
  if (it.kind === "metro") {
    const l = it.line;
    const name = l.name || t("Urban rail line");
    return [`<b>${esc(name)}</b>`, `${esc(t(KIND_LABEL.metro))}${l.ref ? ` · ${esc(l.ref)}` : ""} · ${t("{n} km mapped", { n: fixed(l.km, 1) })}`,
      muted(t("OpenStreetMap (ODbL). Lines mapped as operating rail; lines under construction are not shown."))].join("<br>");
  }
  const r = it.row;
  const place = esc(provName(app, d, r[3]));
  let kind = t(KIND_LABEL[it.kind] || it.kind);
  const lines = [];
  let src = t("OpenStreetMap (ODbL); coverage depends on volunteer mappers.");
  if (it.kind === "hospital") {
    kind = t(r[4] ? "Hospital" : "Health facility tagged as a hospital");
    if (r[5]) lines.push(t("{n} beds", { n: int(r[5]) }));
    if (r[6]) lines.push(t("Operator: {name}", { name: esc(r[6]) }));
  } else if (it.kind === "university") {
    kind = t(r[4] ? "University campus" : "College campus");
  } else if (it.kind === "worship") {
    const rel = d.religions[r[4]];
    kind = t(r[5] === "catholic" ? "Catholic church" : r[5] === "protestant" ? "Protestant church" : (RELIGION[rel] || RELIGION.other)[0]);
  } else if (it.kind === "protected") {
    lines.push(t("Mapped outline {n} km²", { n: r[4] >= 100 ? int(r[4]) : fixed(r[4], 1) }));
    if (r[5]) lines.push(t("IUCN-style protect_class {c}", { c: esc(r[5]) }));
  } else if (it.kind === "bridge") {
    lines.push(t("About {n} m end to end", { n: int(r[4]) }));
  } else if (it.kind === "relic") {
    lines.push(esc(relicCategory(r[5])));
    lines.push(t("Ranked in {year}", { year: esc(r[4]) }));
    src = t({
      list: "Vietnamese Wikipedia list of special national relics (CC BY-SA); position from the list.",
      wikidata: "Vietnamese Wikipedia list of special national relics (CC BY-SA); position from the relic's Wikidata item (CC0).",
      osm: "Vietnamese Wikipedia list of special national relics (CC BY-SA); position from a matching OpenStreetMap feature (ODbL).",
    }[r[7]] || "Vietnamese Wikipedia list of special national relics (CC BY-SA); position from the relic's article.");
  }
  const name = r[2] || kind;
  return [`<b>${esc(name)}</b> ${muted(place)}`, esc(kind), ...lines.filter(Boolean), muted(src)].join("<br>");
}

// --- install ---------------------------------------------------------------------------------------------------
export function install(app) {
  const on = Object.fromEntries(KINDS.map((k) => [k.id, k.def]));
  let poi = null, relics = null, asked = false;
  const getPoi = () => poi, getRelics = () => relics, layers = [];
  const loadPoi = () => {
    if (asked) return;
    asked = true;
    app.loadData("poi").then((d) => { poi = d; app.requestDraw(); }, (err) => console.warn("poi: poi.json failed to load", err));
  };
  app.loadData("relics").then((d) => { relics = d; app.requestDraw(); }, (err) => console.warn("poi: relics.json failed to load", err));

  for (const k of KINDS) {
    const get = k.kind === "relic" ? getRelics : getPoi;
    const l = k.kind === "metro" ? lineLayer(app, k, get, on) : pointLayer(app, k, get, on);
    layers.push(l);
    app.registerStaticLayer(l);
  }
  app.registerStaticLayer(bridgeSpans(app, getPoi, on));

  for (const k of KINDS) {
    app.ui.addMapToggle({
      id: k.id, label: t(k.label), icon: k.icon, title: t(k.title), default: k.def, group: k.group,
      get: () => on[k.id],
      set: (v) => {
        on[k.id] = !!v;
        if (v && k.kind !== "relic") loadPoi();
        app.requestDraw();
      },
    });
    if (on[k.id] && k.kind !== "relic") loadPoi();
  }
  app.poi = { on, data: () => ({ poi, relics }), drawn: () => layers.map((l) => [l.id, l.drawn?.() || []]) }; // debugging
}
