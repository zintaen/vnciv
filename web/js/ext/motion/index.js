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
  let on = !phone; // phones: off by default (battery), on with the Map-menu toggle
  const ambient = createAmbient(app);
  const perf = app.perf ? (app.perf.ambient = []) : []; // ms per ambient draw (window.__app.perf.ambient)
  // Battery: ambient frames are capped (30 fps, 20 on phones) and stop after a minute without input. Between the
  // capped frames active() is false, so the loop idles; a timer asks for the next one. Any frame the app draws
  // meanwhile (hover, a tween) still shows the motion, at its own clock, so it never blinks.
  const GAP = 1000 / (phone ? 20 : 30), IDLE_MS = 60000;
  let lastInput = performance.now(), lastDraw = 0, timer = 0, clock = 0, clockAt = 0;
  const wake = () => {
    const idle = performance.now() - lastInput > IDLE_MS;
    lastInput = performance.now();
    if (idle) app.requestDraw();
  };
  for (const ev of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) addEventListener(ev, wake, { passive: true, capture: true });
  const shows = () => on && !app.state.lens && !app.shownLens?.(); // terrain view only: a lens's data comes first
  const running = () => shows() && performance.now() - lastInput < IDLE_MS;
  // The timer re-checks on firing: a frame drawn meanwhile (hover, a tween) moved lastDraw, so it waits again.
  const arm = (wait) => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      const w = lastDraw + GAP - performance.now();
      if (w <= 9) app.requestDraw(); else arm(w);
    }, wait - 8); // rAF then waits for vsync
  };
  const f2 = { t: 0, lowPower: false, moving: false };
  M.register({
    id: "motion-ambient", z: 20,
    active() {
      if (!running()) return false;
      const wait = lastDraw + GAP - performance.now();
      if (wait <= 9) return true; // within about half a 60 Hz frame: the next one is close enough
      arm(wait);
      return false;
    },
    draw(ctx, cam, a, f) {
      if (!M.enabled || !shows()) return;
      const now = performance.now();
      if (running()) { clock += clockAt ? Math.min(now - clockAt, 250) : 0; clockAt = now; } else clockAt = 0; // paused: frozen
      f2.t = clock / 1000; f2.lowPower = f.lowPower; f2.moving = f.moving;
      lastDraw = now;
      ambient.draw(ctx, cam, f2);
      if (perf.push(performance.now() - now) > 120) perf.shift();
    },
  });
  app.ui?.addMapToggle?.({
    id: "ambient", group: "nature", icon: "🌊", default: !phone,
    label: t("Living map"),
    title: t("Sea shimmer, surf, flowing rivers and drifting cloud shadows. Illustrative only: not weather, currents or real-time data. Off with Effects off or reduced motion."),
    get: () => on,
    set: (v) => { on = !!v; app.requestDraw(); },
  });
  installChartMotion(M);
}
