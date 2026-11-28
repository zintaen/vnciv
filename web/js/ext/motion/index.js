// Ambient map motion (sea shimmer, coastal surf, flowing rivers, drifting cloud shadows) and chart entrances.
// Everything runs through app.motion (main.js): nothing animates under prefers-reduced-motion, with Effects off or in
// a background tab, and every chart and map has a still, complete end state. The motion is illustrative: it shows no
// weather, current or flow data (the Map-menu toggle says so).
import { t } from "../../i18n.js";
import { createAmbient } from "./ambient.js";
import { installChartMotion } from "./charts.js";

export function install(app) {
  const M = app.motion;
  if (!M?.register) return; // an older main.js without app.motion: the map stays still
  const phone = !!app.isMobile?.();
  let on = true; // on by default, phones too (frames are capped at 30 fps and stop after a minute idle)
  const ambient = createAmbient(app);
  const perf = app.perf ? (app.perf.ambient = []) : []; // ms per ambient draw (window.__app.perf.ambient)
  // Battery: ambient frames are capped (30 fps) and stop after a minute without input (M.idle). Between
  // the capped frames active() is false, so the loop idles; a timer asks for the next one (M.frameCap). Any frame the
  // app draws meanwhile (hover, a tween) still shows the motion, at its own clock, so it never blinks.
  const cap = M.frameCap(1000 / 30);
  let clock = 0, clockAt = 0;
  const shows = () => on && !app.state.lens && !app.shownLens?.(); // terrain view only: a lens's data comes first
  const running = () => shows() && !M.idle;
  const f2 = { t: 0, lowPower: false, moving: false };
  M.register({
    id: "motion-ambient", z: 20,
    active: () => running() && cap.due(),
    draw(ctx, cam, a, f) {
      if (!M.enabled || !shows()) return;
      const now = performance.now();
      if (running()) { clock += clockAt ? Math.min(now - clockAt, 250) : 0; clockAt = now; } else clockAt = 0; // paused: frozen
      f2.t = clock / 1000; f2.lowPower = f.lowPower; f2.moving = f.moving;
      cap.drew();
      ambient.draw(ctx, cam, f2);
      if (perf.push(performance.now() - now) > 120) perf.shift();
    },
  });
  app.ui?.addMapToggle?.({
    id: "ambient", group: "nature", icon: "🌊", default: true,
    label: t("Living map"),
    title: t("Sea shimmer, surf, flowing rivers and drifting cloud shadows. Illustrative only: not weather, currents or real-time data. Off with Effects off or reduced motion."),
    get: () => on,
    set: (v) => { on = !!v; app.requestDraw(); },
  });
  installChartMotion(M);
}
