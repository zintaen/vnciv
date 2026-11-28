// Map-art extension: tile improvements (expressways and national roads, railways, ports, airports) and wonders,
// each as a static layer
// drawn into the cached map (nothing animates; an idle map draws no frames), with a switch in the "Map" menu.
//
// Data: infrastructure.json, military.json (OpenStreetMap military land), wonders.json and trade.json (domestic air
// routes), loaded eagerly by main.js right after the first frame. Trade routes are off by default.
import { createModel } from "./model.js";
import { makeLayers } from "./layers.js";
import { tips } from "./tips.js";
import { placesLayer } from "./places.js";
import { t as tr } from "../../i18n.js";

const TOGGLES = [
  { id: "roads", group: "transport", label: "Roads", icon: "t-road", def: true, title: "Expressways and national roads (OpenStreetMap, November 2026)", layers: ["roads"] },
  { id: "rail", group: "transport", label: "Railways", icon: "t-rail", def: true, title: "The North–South railway and branch lines (OpenStreetMap, November 2026)", layers: ["rail"] },
  { id: "hubs", group: "transport", label: "Ports & airports", icon: "d-harbor", def: true, title: "Seaports of Decision 804/QĐ-TTg, sized by class (port areas from OpenStreetMap), and airports with scheduled flights, sized by passengers (ACV)", layers: ["hubs"] },
  { id: "trade", group: "transport", label: "Air routes (2026)", icon: "t-trade", def: false, title: "Domestic air routes flown by at least 3 airlines, and in pink the international routes to airports on the map flown by at least 2, as listed in the airlines-and-destinations tables of Wikipedia's airport articles (November 2026)", layers: ["trade"] },
  { id: "military", group: "military", label: "Military", icon: "m-army", def: true, title: "People's Army sites mapped in OpenStreetMap as forts; the largest as restricted ground", layers: ["forts", "restricted", "plates"] },
  { id: "wonders", group: "culture", label: "Wonders", icon: "w-landmark", def: true, title: "UNESCO World Heritage sites, national parks, the national and regional universities, landmarks", layers: ["wonders", "protected", "plates"] },
  { id: "places", group: "places", label: "Place names", icon: "pedia", def: true, title: "Islands (including Hoàng Sa and Trường Sa) and towns beyond the city banners", layers: ["places"] },
];

export function install(app) {
  const model = createModel(app.w);
  const on = Object.fromEntries(TOGGLES.map((t) => [t.id, t.def]));
  const layers = makeLayers(model, on, { tips, app });
  for (const l of layers) app.registerStaticLayer(l);
  // Place names; the archipelago names and the slogan stay on even when the switch is off.
  let places;
  app.registerStaticLayer(placesLayer(() => places, on));
  app.loadData("places").then((d) => { places = d; app.requestDraw(); }, (err) => console.warn("map layers: places failed to load", err));

  for (const t of TOGGLES) {
    app.ui.addMapToggle({
      id: t.id, label: tr(t.label), icon: t.icon, title: tr(t.title), default: t.def, group: t.group,
      get: () => on[t.id],
      set: (v) => {
        on[t.id] = !!v;
        app.requestDraw();
      },
    });
  }

  const apply = (name, data) => {
    model.setData(name, data);
    app.requestDraw();
  };
  for (const name of ["infrastructure", "military", "wonders", "trade"]) {
    if (app.data[name] !== undefined) apply(name, app.data[name]);
    else app.loadData(name).then((d) => apply(name, d), (err) => console.warn(`map layers: ${name} failed to load`, err));
  }

  // For debugging and the gallery: the model and switches.
  app.mapArt = { model, on, layers };
}
