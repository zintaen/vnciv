// The trailer's "stage": the app's real data and renderer, loaded headlessly (no app shell, no DOM UI), the same way
// web/dev/gallery.js reuses the art modules. Every frame is drawn by render/snapshot.js renderToCanvas() with the
// app's own static layers (ext/layers: roads, rail, ports & airports, military, wonders, trade) and, for the city
// shot, the City View's own map layer (ext/cityView/mapLayer.js) and highlight.
//
//   loadStage(dataUrl) → stage
//   stage.render(canvas, view)   view = {x, y (world km), rpx (hex radius in css px), lens (id | null),
//                                 layers: {roads, rail, hubs, military, wonders, trade} (booleans; default all off),
//                                 banners = true, resources = true, labels = true (state names),
//                                 city (id: City View on that metro) = null, cityAnimMs (ms into the City View
//                                 border animation; default: settled)}
//   The canvas is laid out at canvas.width / stage.dpr css px: stage.dpr sets how big labels and banners read.
import { Camera } from "../../js/camera.js";
import { prepareWorld, applyLens } from "../../js/world.js";
import { renderToCanvas } from "../../js/render/snapshot.js";
import { OCEAN_BG } from "../../js/render/map.js";
import { createModel } from "../../js/ext/layers/model.js";
import { makeLayers } from "../../js/ext/layers/layers.js";
import { buildModel, placeDistricts } from "../../js/ext/cityView/model.js";
import { cityDistricts, badgeOf } from "../../js/ext/cityView/districts.js";
import { createMapLayer } from "../../js/ext/cityView/mapLayer.js";
import { formatLensTick } from "../../js/ui/lenses.js";

const LAYER_KEYS = ["roads", "rail", "hubs", "military", "wonders", "trade"];

async function json(base, name) {
  const r = await fetch(`${base}${name}.json`);
  if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
  return r.json();
}

export async function loadStage(base = "../data/") {
  const names = ["world", "cities", "nation", "lenses", "sources", "resources", "states", "infrastructure",
    "military", "wonders", "trade", "districts", "citizens", "disasters"];
  const vals = await Promise.all(names.map((n) => json(base, n)));
  const data = Object.fromEntries(names.map((n, i) => [n, vals[i]]));
  const w = prepareWorld(data.world, data.cities, { resources: data.resources });
  const cityById = new Map(data.cities.map((c) => [c.id, c]));
  const lensById = new Map(data.lenses.lenses.map((l) => [l.id, l]));

  // Map-art layers, exactly as ext/layers/index.js builds them; `on` is read live at draw time.
  const model = createModel(w);
  for (const n of ["infrastructure", "military", "wonders", "trade"]) model.setData(n, data[n]);
  const on = Object.fromEntries(LAYER_KEYS.map((k) => [k, false]));
  const layers = makeLayers(model, on, { app: null });

  // City-type badges on the banners, as the City View extension hands them to render/banners.js.
  const cityBadges = new Map();
  for (const c of data.cities) {
    const b = badgeOf(data.districts, c.id);
    if (b && b.district) cityBadges.set(c.id, { label: b.label, color: b.color });
  }

  const cam = new Camera(data.world.width, data.world.height);
  const state = {
    cities: data.cities, lens: null, band: null, hoverCell: -1, selectedCity: null, selectedState: null,
    showResources: !!w.resources, highlight: null, resourceFilter: null, cityBadges, bannerFocus: null,
  };
  // The small slice of the app API that the renderer, the layers and the City View map layer read.
  const overlays = [];
  const app = {
    data: { ...data, counties: null }, w, cam, state, cityById, lensById,
    registerOverlay(o) { overlays.push(o); overlays.sort((a, b) => (a.z ?? 0) - (b.z ?? 0)); return () => {}; },
    requestDraw() {}, invalidate() {},
    staticLayers: () => layers,
  };
  const cvLayer = createMapLayer(app, {});
  const cityViews = new Map(); // id → {model, highlight}

  function cityView(id) {
    if (cityViews.has(id)) return cityViews.get(id);
    const city = cityById.get(id);
    if (!city) throw new Error(`no city ${id}`);
    const m = buildModel(app, city);
    m.cityList = data.cities;
    m.landColor = cvLayer.landColor;
    placeDistricts(m, cityDistricts(data.districts, id));
    const highlight = {
      cells: new Set(m.footprint), resources: new Set(m.sites.map((s) => s.index)), dimOthers: true,
      color: `rgb(${m.stateRGB.map((v) => v | 0).join(",")})`,
    };
    const v = { city, model: m, highlight };
    cityViews.set(id, v);
    return v;
  }

  let curLens; // undefined: no colours applied yet (prepareWorld leaves w.colors unset)
  const R = w.grid.R;
  const stage = {
    data, w, cityById, lensById, layers, on, app, model, formatLensTick, dpr: 1.5, R,
    cityView,
    render(canvas, view) {
      const lens = view.lens ? lensById.get(view.lens) : null;
      if (view.lens && !lens) throw new Error(`no lens ${view.lens}`);
      if (lens !== curLens) {
        applyLens(w, lens, null);
        curLens = lens;
      }
      for (const k of LAYER_KEYS) on[k] = !!view.layers?.[k];
      const cv = view.city ? cityView(view.city) : null;
      // The City View border animation runs on performance.now() from set(); here it follows trailer time instead:
      // the layer is re-opened every frame with its clock started view.cityAnimMs ago (default: long settled).
      cvLayer.set(null);
      if (cv) {
        const realNow = performance.now;
        const t0 = realNow.call(performance) - (view.cityAnimMs ?? 1e7);
        performance.now = () => t0;
        try { cvLayer.set(cv.model); } finally { performance.now = realNow; }
      }
      const st = {
        ...state, lens, showResources: view.resources !== false && !!w.resources,
        highlight: cv ? cv.highlight : null,
        selectedCity: cv ? cv.city : null,
        bannerFocus: cv ? cv.city : null,
      };
      const dpr = view.dpr ?? stage.dpr;
      const cssW = canvas.width / dpr, cssH = canvas.height / dpr;
      cam.resize(cssW, cssH);
      const scale = view.rpx / R;
      cam.scale = scale;
      cam.x = view.x;
      cam.y = view.y;
      cam.fitScale = scale;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = OCEAN_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // labels: false hides the big state names (renderToCanvas has no switch for them, so the list is emptied
      // for this one draw and put back).
      const labels = w.stateLabels;
      if (view.labels === false) w.stateLabels = [];
      let res;
      try {
        res = renderToCanvas(canvas, cam, w, st, data.nation, {
          dpr, fit: "same", scale, x: view.x, y: view.y, app, banners: view.banners !== false,
          staticLayers: layers, overlays: cv ? overlays.filter((o) => o.snapshot) : [],
        });
      } finally {
        w.stateLabels = labels;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return res.cam;
    },
  };
  return stage;
}
