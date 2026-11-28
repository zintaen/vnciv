// Ambient sound, synthesised with WebAudio (no audio files): surf near the coast, wind over the mountains, a soft hum
// when zoomed into a city, mixed by what is on screen. Off by default; starts only after a user gesture (the toggle
// click is one); fades out when the switch, Effects or the tab goes away, or after a minute without input
// (app.motion.idle). No frames: the mix is re-read by a 1 s timer that runs only while the switch is on.
const MAX = 0.05; // master volume ceiling (quiet)
const FADE = 0.8; // s, setTargetAtTime constant

export function createSound(app) {
  const M = app.motion, w = app.w, grid = w.grid;
  let on = false, ac = null, master = null, gains = null, timer = 0, armed = false;

  function build() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let k = 0; k < len; k++) d[k] = Math.random() * 2 - 1;
    const noise = () => { const s = ac.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const lfo = (hz, depth, target) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = hz; g.gain.value = depth;
      o.connect(g).connect(target); o.start();
    };
    master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const ch = () => { const g = ac.createGain(); g.gain.value = 0; g.connect(master); return g; };
    gains = { waves: ch(), wind: ch(), city: ch() };
    // waves: low-passed noise swelling every ~9 s
    const wf = ac.createBiquadFilter(); wf.type = "lowpass"; wf.frequency.value = 520;
    const swell = ac.createGain(); swell.gain.value = 0.6; lfo(0.11, 0.4, swell.gain);
    noise().connect(wf).connect(swell).connect(gains.waves);
    // wind: band-passed noise whose pitch wanders
    const bf = ac.createBiquadFilter(); bf.type = "bandpass"; bf.frequency.value = 700; bf.Q.value = 1.2; lfo(0.07, 260, bf.frequency);
    const gust = ac.createGain(); gust.gain.value = 0.7; lfo(0.05, 0.3, gust.gain);
    noise().connect(bf).connect(gust).connect(gains.wind);
    // city: a muffled rumble of traffic + a faint mains-like drone
    const cf = ac.createBiquadFilter(); cf.type = "lowpass"; cf.frequency.value = 180;
    noise().connect(cf).connect(gains.city);
    const drone = ac.createOscillator(), dg = ac.createGain();
    drone.frequency.value = 100; dg.gain.value = 0.08; drone.connect(dg).connect(gains.city); drone.start();
    return true;
  }

  /** What is on screen → {waves, wind, city} in 0..1. ~400 samples over the view, so the cost is flat. */
  function mix() {
    const cam = app.cam, v = cam.view(), Rpx = grid.R * cam.scale;
    let sea = 0, land = 0, elev = 0;
    const sx = (v.x1 - v.x0) / 20, sy = (v.y1 - v.y0) / 20;
    for (let y = v.y0 + sy / 2; y < v.y1; y += sy) for (let x = v.x0 + sx / 2; x < v.x1; x += sx) {
      const c = grid.cellAt(x, y);
      if (c < 0) continue;
      if (w.water[c] === 1 || w.water[c] === 2) sea++;
      else if (!w.water[c]) { land++; elev += Math.max(0, w.raw.elev[c]); }
    }
    const n = sea + land || 1;
    const coast = Math.min(sea, land) / n * 2; // a view that straddles the shore (1 = half sea, half land)
    const mountains = land ? Math.min(1, Math.max(0, (elev / land - 300) / 900)) : 0; // mean land height 300 → 1200 m
    let city = 0;
    if (Rpx >= 6) {
      const cx = (v.x0 + v.x1) / 2, cy = (v.y0 + v.y1) / 2, rad = Math.min(v.x1 - v.x0, v.y1 - v.y0) / 2;
      for (const c of app.state.cities || []) {
        const d = Math.hypot(c.x - cx, c.y - cy) / rad;
        if (d < 1) city = Math.max(city, (1 - d) * Math.min(1, Math.log10(Math.max(1, c.population || 0)) / 7));
      }
      city *= Math.min(1, (Rpx - 6) / 10);
    }
    return { waves: Math.min(1, coast * 1.2), wind: mountains, city };
  }

  const audible = () => on && armed && M.userEnabled !== false && !document.hidden && !M.idle;
  function update() {
    if (!ac) return;
    const now = ac.currentTime;
    if (!audible()) {
      master.gain.setTargetAtTime(0, now, FADE / 2);
      if (ac.state === "running") setTimeout(() => { if (!audible() && ac?.state === "running") ac.suspend(); }, FADE * 3000);
      return;
    }
    if (ac.state !== "running") ac.resume();
    master.gain.setTargetAtTime(MAX, now, FADE);
    const m = mix();
    const lvl = { waves: m.waves, wind: 0.15 + 0.85 * m.wind, city: 0.8 * m.city }; // a faint breeze is the floor
    for (const k in lvl) gains[k].gain.setTargetAtTime(lvl[k], now, FADE);
  }

  // The first gesture after the switch went on (from the hash, say) is what may start audio.
  function gesture() {
    if (!on) return;
    armed = true;
    if (!ac && !build()) return;
    update();
  }
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, gesture, { capture: true, passive: true });
  document.addEventListener("visibilitychange", update);
  M.on?.("change", update);

  return {
    get on() { return on; },
    get playing() { return !!ac && ac.state === "running" && audible(); },
    set(v) {
      on = !!v;
      clearInterval(timer);
      if (on) {
        timer = setInterval(update, 1000);
        if (navigator.userActivation?.isActive) gesture(); // switched by a click / key: may start now
      }
      update();
    },
    mix,
  };
}
