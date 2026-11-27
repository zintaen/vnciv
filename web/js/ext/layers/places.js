// Place names (places.json): the Hoàng Sa and Trường Sa archipelagos with the slogan between them, their islands,
// well-known coastal islands and towns that are not one of the 63 city banners. Drawn in screen space into the
// cached map; labels never overlap each other (first placed wins, in priority order).
import { t, lang } from "../../i18n.js";

const SERIF = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';
const SANS = '-apple-system, "Segoe UI", system-ui, sans-serif';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SLOGAN_W = 3600; // map units (720 km): the slogan's widest line never spans more of the sea than this

// Zoom (hex radius in css px) from which each kind of label appears.
const MIN_RPX = { archipelago: 0, slogan: 0, arch_island: 9, coastal: 5, tourist: 7, town: 11 };

function halo(ctx, text, x, y, { fill, stroke, width }) {
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export function placesLayer(getData, on) {
  return {
    id: "places", z: 92,
    visible: () => !!getData(),
    sig: () => `${on.places ? 1 : 0}`,
    draw(ctx, vp, w, o) {
      const d = getData();
      if (!d) return;
      o.screen();
      const W = ctx.canvas.width / (o.dpr || 1), H = ctx.canvas.height / (o.dpr || 1);
      const placed = [];
      const free = (b) => !placed.some((p) => b[0] < p[2] && p[0] < b[2] && b[1] < p[3] && p[1] < b[3]);
      const onScreen = (x, y, m = 200) => x > -m && y > -m && x < W + m && y < H + m;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // 1. The slogan, always: two lines in the sea between the archipelagos, sized to stay readable at the home view.
      const s = d.slogan;
      if (s) {
        const [x, y] = o.toScreen(s.x, s.y);
        if (onScreen(x, y, 400)) {
          let px = clamp(o.Rpx * 3.2, 24, 60);
          const [l1, l2] = s.text.split(/,\s*/);
          const lines = [l1 + ",", l2];
          ctx.font = `bold ${px}px ${SERIF}`;
          let wMax = Math.max(...lines.map((l) => ctx.measureText(l).width));
          // Zoomed out below the home view (a phone's widest zoom, a docked advisor) the 24 px floor ran over the
          // archipelago names and the city banners: keep it inside SLOGAN_W of sea.
          const fit = (SLOGAN_W * o.s) / wMax;
          if (fit < 1) {
            px = Math.max(9, Math.floor(px * fit));
            ctx.font = `bold ${px}px ${SERIF}`;
            wMax = Math.max(...lines.map((l) => ctx.measureText(l).width));
          }
          lines.forEach((l, k) => halo(ctx, l, x, y + (k - 0.5) * px * 1.15, { fill: "#d6202f", stroke: "rgba(255,236,170,.95)", width: Math.max(3, px * 0.16) }));
          const box = [x - wMax / 2 - 6, y - px * 1.2, x + wMax / 2 + 6, y + px * 1.2];
          if (lang !== "vi" && s.en) {
            const sub = clamp(px * 0.42, 8, 16);
            ctx.font = `italic ${sub}px ${SERIF}`;
            halo(ctx, s.en, x, y + px * 1.25 + sub * 0.6, { fill: "#fff6dc", stroke: "rgba(20,30,45,.85)", width: 3 });
            box[3] += sub * 1.4;
          }
          placed.push(box);
        }
      }

      // 2. Archipelago names, always.
      for (const a of d.archipelagos || []) {
        const [x, y] = o.toScreen(a.x, a.y);
        if (!onScreen(x, y)) continue;
        const px = clamp(o.Rpx * 1.05, 11, 22);
        ctx.font = `bold ${px}px ${SERIF}`;
        const label = a.name.toUpperCase();
        const wd = ctx.measureText(label).width;
        const ly = y - Math.max(18, o.Rpx * 1.6);
        halo(ctx, label, x, ly, { fill: "#ffe39a", stroke: "rgba(15,30,50,.9)", width: Math.max(3, px * 0.22) });
        ctx.font = `italic ${clamp(px * 0.62, 9, 13)}px ${SERIF}`;
        const sub = t("({owner}, Vietnam)", { owner: a.owner });
        halo(ctx, sub, x, ly + px * 0.95, { fill: "#f4ead2", stroke: "rgba(15,30,50,.85)", width: 3 });
        placed.push([x - wd / 2 - 4, ly - px * 0.7, x + wd / 2 + 4, ly + px * 1.4]);
      }

      if (!on.places) { o.world(); return; }

      // 3. Islands and towns, by priority, when zoomed in enough, without overlaps.
      const items = [
        ...(d.islands || []).map((i) => ({ ...i, kind: i.group === "coastal" ? "coastal" : "arch_island" })),
        ...(d.towns || []).map((tw) => ({ ...tw, kind: tw.kind === "tourist" ? "tourist" : "town" })),
      ].filter((it) => o.Rpx >= MIN_RPX[it.kind]);
      const prio = { coastal: 0, tourist: 1, arch_island: 2, town: 3 };
      items.sort((a, b) => prio[a.kind] - prio[b.kind] || (b.population || 0) - (a.population || 0));
      for (const it of items) {
        const [x, y] = o.toScreen(it.x, it.y);
        if (!onScreen(x, y, 40)) continue;
        const island = it.kind === "coastal" || it.kind === "arch_island";
        const px = clamp(o.Rpx * (island ? 0.62 : 0.55), 10, 15);
        ctx.font = island ? `italic 600 ${px}px ${SERIF}` : `600 ${px}px ${SANS}`;
        const wd = ctx.measureText(it.name).width;
        const ly = y + px * (island ? 1.1 : 1.0);
        const box = [x - wd / 2 - 3, ly - px * 0.65, x + wd / 2 + 3, ly + px * 0.65];
        if (!free(box)) continue;
        placed.push(box);
        if (!island) {  // a town dot
          ctx.beginPath();
          ctx.arc(x, y, Math.max(2, px * 0.2), 0, Math.PI * 2);
          ctx.fillStyle = "#2b2116";
          ctx.fill();
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = "rgba(255,248,230,.9)";
          ctx.stroke();
        }
        halo(ctx, it.name, x, ly, island ? { fill: "#e9f6ff", stroke: "rgba(10,40,70,.85)", width: 3 }
          : { fill: "#2b2116", stroke: "rgba(255,248,230,.88)", width: 3 });
      }
      o.world();
    },
  };
}
