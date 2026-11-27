// The trailer's soundtrack, composed and synthesised in code (no samples): a short, warm score in D major whose
// chord changes, hits and chimes are placed from the storyboard's own shot times and cues, so a re-timed
// storyboard stays in sync.
//
//   buildScore(sb) → Promise<{buffer: AudioBuffer, stats}>    renders offline at 48 kHz stereo, then normalises to
//                                                             about -16 LUFS with a true-peak ceiling of -1 dBTP
//   loudness(channels, sr) → {lufs, truePeak, samplePeak}     BS.1770 integrated loudness (K-weighted, gated)
//   toWav(buffer) → Blob                                      24-bit PCM WAV
//
// The motif (A–D–E–A–F#: up a fourth, a step, a fourth, down a third, always in the rhythm long–short–short–long–
// held) is only hinted at the title (three bells), sounded by the horn as the lenses come in, echoed in the city
// screen, and stated whole by horn and bells as a pickup out of trade whose last note lands on the end card.
import { fadeOf } from "./storyboard.js";

export const SR = 48000;
const TARGET_LUFS = -16;
const CEILING_DB = -1.2; // true-peak ceiling (a little under -1 dBTP leaves room for the AAC encode)

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const dbToGain = (db) => 10 ** (db / 20);

/** Small seeded PRNG so every render is the same. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- the plan: chords, hits and chimes on the storyboard's clock ---------------------------------------------------

/** Times (absolute seconds) the music hangs on, read from the storyboard. */
function clock(sb) {
  const S = Object.fromEntries(sb.shots.map((s) => [s.id, s]));
  const need = ["title", "rockies", "cities", "lenses", "improvements", "city", "trade", "end"];
  for (const id of need) if (!S[id]) throw new Error(`score: storyboard has no "${id}" shot`);
  // where a transition actually lands on screen: a dip is darkest half-way, a punch cuts at 40% of its length
  const hit = (id) => {
    const s = S[id], f = fadeOf(sb, s);
    return s.t0 + (s.trans === "dip" ? f * 0.5 : s.trans === "punch" ? f * 0.4 : 0);
  };
  const at = (id, f) => S[id].t0 + (S[id].t1 - S[id].t0) * f;
  const cue = (id, k, fb) => S[id].t0 + (S[id].cues?.[k] ?? fb);
  return { S, hit, at, cue, end: sb.duration };
}

// Voicings are listed voice by voice (each array index is one voice), so a voice that keeps its note across a
// change is tied rather than struck again.
const D_ADD9 = [57, 62, 64, 66], D = [57, 62, 66, 69], BM7 = [59, 62, 66, 69], G_ADD9 = [59, 62, 67, 69];
const EM7 = [59, 62, 64, 67], ASUS = [57, 62, 64, 69], A = [57, 61, 64, 69];
const DMAJ9 = [57, 61, 64, 66], GMAJ9 = [57, 59, 62, 66], ASUS9 = [57, 59, 62, 64];
const A1 = 33, B1 = 35, D2 = 38, E2 = 40, FS2 = 42, G2 = 43, A2 = 45;
// chord roots (pitch class): the brass only plays a chord's root and fifth, never the added seconds and suspensions
const ROOT = new Map([[D_ADD9, 2], [D, 2], [DMAJ9, 2], [BM7, 11], [G_ADD9, 7], [GMAJ9, 7], [EM7, 4], [ASUS, 9], [A, 9], [ASUS9, 9]]);
const isRootOrFifth = (pad, m) => [0, 7].includes((((m - ROOT.get(pad)) % 12) + 12) % 12);

// The motif A–D–E–A–F# always in one rhythmic cell, long–short–short–long–held (2:1:1:2:4 units), each statement
// choosing only its unit length.
export const MOTIF = [69, 74, 76, 81, 78];
const CELL = [0, 2, 3, 4, 6]; // onsets in units
const motifAt = (t0, unit, n = 5) => CELL.slice(0, n).map((u) => t0 + u * unit);

function plan(sb) {
  const { S, hit, at, cue, end } = clock(sb);
  const t = (id, k) => S[id][k];
  // chords: t (when it should be fully there), bass, pad voices, up (violins double these voices an octave up:
  // true = the top two)
  const chords = [
    { t: 0, bass: D2, pad: D_ADD9 },
    { t: hit("rockies") + 0.1, bass: B1, pad: BM7 },
    { t: at("rockies", 0.5), bass: G2, pad: G_ADD9 },
    { t: hit("cities"), bass: D2, pad: D },
    { t: at("cities", 0.35), bass: E2, pad: EM7 },
    { t: t("cities", "t1") - 1.6, bass: A1, pad: ASUS }, // bass falls to A1 against the rising top (no hidden octaves)
    { t: t("cities", "t1") - 0.9, bass: A1, pad: A },
    { t: t("lenses", "t0"), bass: D2, pad: D_ADD9, up: true },
    { t: cue("lenses", 1, 2.3), bass: B1, pad: BM7, up: true },
    { t: cue("lenses", 2, 3.8), bass: G2, pad: G_ADD9, up: true },
    { t: t("lenses", "t1") - 0.9, bass: A2, pad: A, up: true }, // G → A → D/F#: contrary motion against the bass
    { t: t("improvements", "t0"), bass: FS2, pad: D, up: [3] }, // no violin F#: the third is already in the bass
    { t: cue("improvements", 1, 1.85), bass: G2, pad: G_ADD9, up: true },
    { t: cue("improvements", 3, 3.25), bass: E2, pad: EM7, up: true },
    { t: t("improvements", "t1") - 0.6, bass: A1, pad: ASUS, up: true },
    { t: t("city", "t0") + 0.2, bass: D2, pad: DMAJ9 },
    { t: cue("city", 0, 1.1), bass: G2, pad: GMAJ9 },
    { t: at("city", 0.64), bass: B1, pad: GMAJ9 },
    { t: t("city", "t1") - 0.9, bass: A2, pad: ASUS9 },
    { t: hit("trade"), bass: G2, pad: G_ADD9, up: true },
    { t: at("trade", 0.43), bass: A2, pad: ASUS, up: true },
    { t: t("trade", "t1") - 0.85, bass: A2, pad: A, up: true },
    { t: t("end", "t0"), bass: D2, pad: D, up: true, last: true },
  ];
  // timpani-like hits: [time, midi, velocity]. The lenses cut is an accent (the chord lands with it, the strings dip
  // just before it); the improvements cut is camera-continuous and has none.
  const timp = [
    [0.04, D2, 0.26],
    [hit("rockies"), B1 + 12, 0.4],
    [hit("cities"), D2, 0.8],
    [t("lenses", "t0"), D2, 0.64],
    [hit("trade"), G2, 0.82],
    [t("end", "t0"), D2, 0.9],
  ];
  // soft noise swells into the big cuts: [hit time, length, level]
  const risers = [[hit("cities"), 0.7, 1], [hit("trade"), 0.8, 1], [t("end", "t0"), 0.9, 0.55]]; // softer under the horn
  // bells / chimes: [time, midi, velocity, decay scale]
  const bells = [];
  // title: the motif's first three notes, softly
  motifAt(0.3, 0.35, 3).forEach((x, i) => bells.push([x, MOTIF[i], i ? 0.5 : 0.55, i === 2 ? 1.6 : 1.3]));
  bells.push(
    // new lenses
    [cue("lenses", 1, 2.3), 78, 0.45, 1], [cue("lenses", 2, 3.8), 83, 0.42, 1],
    // map layers appearing (roads, hubs, military, wonders), climbing the D pentatonic
    [cue("improvements", 0, 1.15), 81, 0.5, 1], [cue("improvements", 1, 1.85), 83, 0.5, 1],
    [cue("improvements", 2, 2.55), 86, 0.5, 1], [cue("improvements", 3, 3.25), 88, 0.55, 1.2],
    [cue("improvements", 3, 3.25) + 0.11, 93, 0.25, 1.2],
    // the city screen opening
    [cue("city", 0, 1.1), 86, 0.35, 1.2],
  );
  // ... then the motif echoed quietly
  motifAt(cue("city", 1, 1.3) + 0.9, 0.3, 3).forEach((x, i) => bells.push([x, MOTIF[i], i ? 0.3 : 0.32, i === 2 ? 1.5 : 1.2]));
  // horn lines: [time, midi, length, velocity]. The horn sits an octave above the pad brass so the line reads.
  const horn = [];
  const lu = 0.25;
  motifAt(t("lenses", "t0") + 0.08, lu, 3).forEach((x, i) => horn.push([x, MOTIF[i], i === 2 ? 1.2 : (CELL[i + 1] - CELL[i]) * lu + 0.06, 0.5]));
  // the whole motif as a pickup across the end of trade, its last note (F#, the third of D) landing on the end card
  // with the timpani, then held while the chord rings out
  const e0 = t("end", "t0"), eu = 0.26, lastEnd = end - 1.0;
  const eon = motifAt(e0 - CELL[4] * eu, eu);
  MOTIF.forEach((m, i) => {
    const len = i === 4 ? lastEnd - e0 : eon[i + 1] - eon[i] + 0.06;
    horn.push([eon[i], m, len, i === 4 ? 0.72 : 0.66]);
    bells.push([eon[i], m, i === 4 ? 0.62 : 0.5, i === 4 ? 1.8 : 1.1]);
  });
  // bus levels over time (the dynamic arc): [time, level]
  const city0 = t("city", "t0"), lens0 = t("lenses", "t0"), wond = cue("improvements", 3, 3.25);
  const levels = {
    strings: [[0, 0.2], [t("rockies", "t0"), 0.26], [hit("rockies") + 0.8, 0.52], [hit("cities"), 0.56], [lens0 - 0.4, 0.62],
      [lens0 - 0.02, 0.5], [lens0 + 0.35, 0.8], [t("improvements", "t0"), 0.82], [t("improvements", "t1") - 0.3, 0.92],
      [city0 + 0.6, 0.3], [t("city", "t1") - 0.5, 0.38], [hit("trade"), 0.85], [t("end", "t0"), 1.0], [end, 1.0]],
    brass: [[0, 0], [hit("cities"), 0], [hit("cities") + 1.2, 0.35], [lens0 - 0.4, 0.45], [lens0 - 0.02, 0.38], [lens0 + 0.4, 0.6],
      [t("improvements", "t0"), 0.58], [wond, 0.72], [t("improvements", "t1") - 0.4, 0.68],
      [city0 + 0.8, 0], [t("city", "t1") - 0.4, 0], [hit("trade") + 0.5, 0.75], [t("end", "t0"), 1.0], [end, 1.0]],
    drone: [[0, 0.32], [hit("rockies"), 0.7], [lens0, 0.85], [city0 + 0.5, 0.5], [t("end", "t0"), 1], [end, 1]],
  };
  return { chords, timp, risers, bells, horn, levels, end, lastEnd, fadeFrom: end - 0.65 };
}

// --- instruments ---------------------------------------------------------------------------------------------------

/** Raised-cosine ramp from a to b (click-free envelope segment). */
function rc(a, b, n = 64) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) c[i] = a + (b - a) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  return c;
}
/** A held note's envelope: rise over att from t0, hold, fall over rel from t1 (always back to exactly 0). */
function sustainEnv(param, t0, t1, att, rel, peak) {
  att = Math.max(0.005, Math.min(att, t1 - t0));
  param.value = 0;
  param.setValueCurveAtTime(rc(0, peak), t0, att);
  param.setValueCurveAtTime(rc(peak, 0), Math.max(t1, t0 + att + 1e-3), rel);
}
/** A struck envelope as one curve: fast raised-cosine attack, exponential decay, faded to 0 over the last 15%. */
function strikeEnv(param, t0, att, tau, len, peak) {
  const n = Math.max(32, Math.round(len * 1000));
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * len;
    const a = x < att ? 0.5 - 0.5 * Math.cos((Math.PI * x) / att) : 1;
    const tail = i > 0.85 * n ? 0.5 + 0.5 * Math.cos((Math.PI * (i - 0.85 * n)) / (0.15 * n)) : 1;
    c[i] = peak * a * Math.exp(-Math.max(0, x - att) / tau) * tail;
  }
  c[n - 1] = 0;
  param.value = 0;
  param.setValueCurveAtTime(c, t0, len);
}

function makeIR(ctx, rnd, seconds = 3.2) {
  const n = Math.round(seconds * SR);
  const ir = ctx.createBuffer(2, n, SR);
  const pre = Math.round(0.014 * SR);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let y = 0, e = 0;
    for (let i = pre; i < n; i++) {
      const tt = (i - pre) / SR;
      const x = (rnd() * 2 - 1) * Math.exp(-tt / 0.45); // ~ -60 dB at 3.1 s (RT60 ≈ 3 s)
      const k = 0.85 - 0.62 * Math.min(1, tt / 2.2); // the tail darkens as it decays
      y += k * (x - y);
      d[i] = y;
    }
    // a few early reflections, slightly different per side
    for (let r = 0; r < 9; r++) {
      const at = pre + Math.round((0.006 + rnd() * 0.07) * SR);
      d[at] += (rnd() < 0.5 ? -1 : 1) * (0.25 + 0.3 * rnd()) * (1 - r / 12);
    }
    // fade the last 30% to exactly zero; remove DC; then unit energy
    const f0 = Math.round(n * 0.7);
    for (let i = f0; i < n; i++) d[i] *= 0.5 + 0.5 * Math.cos((Math.PI * (i - f0)) / (n - f0));
    for (let i = 0; i < n; i++) e += d[i] * d[i];
    let m = 0;
    for (let i = 0; i < n; i++) m += d[i];
    m /= n;
    const s = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) d[i] = (d[i] - m) * s;
  }
  return ir;
}

class Synth {
  constructor(ctx, rnd) {
    this.ctx = ctx;
    this.rnd = rnd;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 38; hp.Q.value = 0.6; // below what laptops and phones reproduce anyway
    const air = ctx.createBiquadFilter(); // a gentle lift for presence and air
    air.type = "highshelf"; air.frequency.value = 3000; air.gain.value = 2;
    this.master = ctx.createGain();
    air.connect(hp).connect(this.master).connect(ctx.destination);
    this.mix = ctx.createGain();
    this.mix.connect(air);
    this.verb = ctx.createConvolver();
    this.verb.normalize = false;
    this.verb.buffer = makeIR(ctx, rnd);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    const verbIn = ctx.createBiquadFilter(); // keep the low end out of the reverb (no mud)
    verbIn.type = "highpass"; verbIn.frequency.value = 160; verbIn.Q.value = 0.5;
    verbIn.connect(this.verb).connect(wet).connect(air);
    this.verbIn = verbIn;
    // white noise, shared by the percussion
    const nb = ctx.createBuffer(1, SR * 2, SR);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
    this.noise = nb;
    this.count = 0;
  }
  /** A bus with its own level automation, reverb send and dry level. */
  bus(points, send, dry = 1) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(points[0][1], 0);
    for (const [t, v] of points.slice(1)) g.gain.linearRampToValueAtTime(v, t);
    const d = this.ctx.createGain();
    d.gain.value = dry;
    g.connect(d).connect(this.mix);
    const s = this.ctx.createGain();
    s.gain.value = send;
    g.connect(s).connect(this.verbIn);
    return g;
  }
  osc(type, f, t0, t1, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.start(t0);
    o.stop(t1);
    this.count++;
    return o;
  }
  /** Vibrato: a sine LFO in cents that fades in after `delay`. */
  vibrato(t0, t1, delay, cents, rate) {
    const l = this.osc("sine", rate, t0, t1);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.setValueAtTime(0, t0 + delay);
    g.gain.linearRampToValueAtTime(cents, t0 + delay + 0.8);
    l.connect(g);
    return g;
  }
  /** Section strings: five saws at uneven, narrow detunes and levels spread across the stereo field (an ensemble,
   *  not a supersaw), each with its own delayed vibrato at its own rate and phase (players are never in step), two
   *  gentle low-passes and a slow attack. */
  strings(dest, m, t0, t1, { vel = 1, att = 0.8, rel = 1.3, bright = 1, pan = 0, spread = 1, vib = 4 } = {}) {
    const f = mtof(m), end = t1 + rel + 0.05;
    const out = this.ctx.createGain();
    sustainEnv(out.gain, t0, t1, att, rel, vel * 0.045);
    const lp1 = this.ctx.createBiquadFilter(), lp2 = this.ctx.createBiquadFilter();
    lp1.type = lp2.type = "lowpass";
    const fc = Math.min(7000, (600 + 2.4 * f) * bright);
    lp1.frequency.value = fc; lp1.Q.value = 0.5;
    lp2.frequency.value = fc * 1.5; lp2.Q.value = 0.4;
    lp1.connect(lp2).connect(out).connect(dest);
    [-7, -3, 0, 4, 8].forEach((dt, i) => {
      const o = this.osc("sawtooth", f, t0, end, (dt + (this.rnd() - 0.5) * 3) * spread);
      // its own LFO, started at a random point in its cycle
      const rate = 4.5 + this.rnd() * 1.5;
      this.vibrato(Math.max(0, t0 - this.rnd() / rate), end, 0.4, vib * (0.6 + 0.5 * this.rnd()), rate).connect(o.detune);
      const g = this.ctx.createGain();
      g.gain.value = 0.7 + 0.3 * this.rnd();
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan + (i - 2) * 0.2));
      o.connect(g).connect(p).connect(lp1);
    });
  }
  /** Soft brass: two saws and a square, the low-pass opening with the swell. */
  brass(dest, m, t0, t1, { vel = 1, att = 0.9, rel = 1.1, pan = 0, bright = 1 } = {}) {
    const f = mtof(m), end = t1 + rel + 0.05;
    const out = this.ctx.createGain();
    sustainEnv(out.gain, t0, t1, att, rel, vel * 0.05);
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.Q.value = 0.7;
    const top = Math.min(5000, (500 + 2.2 * f) * bright);
    lp.frequency.setValueAtTime(220, 0);
    lp.frequency.setValueAtTime(220, t0);
    lp.frequency.exponentialRampToValueAtTime(top, t0 + Math.max(0.1, att));
    lp.frequency.setTargetAtTime(top * 0.75, t0 + Math.max(0.1, att), 0.6);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    lp.connect(out).connect(p).connect(dest);
    const vib = this.vibrato(t0, end, 0.5, 5, 5.1);
    for (const [type, k, dt, g] of [["sawtooth", 1, -5, 1], ["sawtooth", 1, 6, 1], ["square", 1, 0, 0.3]]) {
      const o = this.osc(type, f * k, t0, end, dt);
      vib.connect(o.detune);
      const og = this.ctx.createGain();
      og.gain.value = g;
      o.connect(og).connect(lp);
    }
  }
  /** Low strings + a sine an octave under them. */
  bass(dest, m, t0, t1, { vel = 1, att = 0.7, rel = 1.2 } = {}) {
    this.strings(dest, m, t0, t1, { vel: vel * 1.05, att, rel, bright: 0.6, pan: 0, spread: 0.3, vib: 2.5 });
    const f = mtof(m), end = t1 + rel + 0.05;
    const g = this.ctx.createGain();
    sustainEnv(g.gain, t0, t1, att, rel, vel * 0.035);
    this.osc("sine", f, t0, end).connect(g).connect(dest);
  }
  /** Timpani-like hit: inharmonic membrane partials with a small pitch drop (a few tenths of a semitone, as a real
   *  head settles), a filtered-noise mallet with a short bright stick-contact layer. */
  timp(dest, m, t, vel) {
    const f = mtof(m);
    const ratios = [1, 1.5, 1.98, 2.44, 2.9], amps = [1, 0.5, 0.3, 0.16, 0.08];
    ratios.forEach((r, i) => {
      const tau = (0.85 / r ** 0.8) * (0.6 + 0.6 * vel);
      const len = Math.min(5, tau * 7);
      const o = this.osc("sine", f * r, t, t + len + 0.02);
      o.frequency.setValueAtTime(f * r * 1.018, t);
      o.frequency.exponentialRampToValueAtTime(f * r, t + 0.08);
      const g = this.ctx.createGain();
      strikeEnv(g.gain, t, 0.004, tau, len, vel * 0.27 * amps[i]);
      o.connect(g).connect(dest);
    });
    if (vel > 0.6) { // weight under the big ones
      const len = 2.4;
      const o = this.osc("sine", f / 2, t, t + len + 0.02);
      o.frequency.setValueAtTime(f * 0.505, t);
      o.frequency.exponentialRampToValueAtTime(f / 2, t + 0.08);
      const g = this.ctx.createGain();
      strikeEnv(g.gain, t, 0.008, 0.45, len, vel * 0.19);
      o.connect(g).connect(dest);
    }
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 220 + 160 * vel; bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    strikeEnv(g.gain, t, 0.002, 0.035, 0.3, vel * 0.22);
    n.connect(bp).connect(g).connect(dest);
    n.start(t, this.rnd());
    n.stop(t + 0.32);
    // stick contact
    const n2 = this.ctx.createBufferSource();
    n2.buffer = this.noise;
    const bp2 = this.ctx.createBiquadFilter();
    bp2.type = "bandpass"; bp2.frequency.value = 2000; bp2.Q.value = 0.8;
    const g2 = this.ctx.createGain();
    strikeEnv(g2.gain, t, 0.001, 0.008, 0.06, vel * 0.08);
    n2.connect(bp2).connect(g2).connect(dest);
    n2.start(t, this.rnd());
    n2.stop(t + 0.08);
  }
  /** Bell / chime: struck sine partials at bell-like inharmonic ratios, a detuned twin for a slow shimmer. */
  bell(dest, m, t, vel, decay = 1) {
    const f = mtof(m);
    const p = this.ctx.createStereoPanner();
    p.pan.value = (this.rnd() - 0.5) * 0.7;
    p.connect(dest);
    const parts = [[1, 1, 2.4], [1.0009, 0.5, 2.4], [2.0, 0.28, 1.4], [2.76, 0.32, 0.95], [4.07, 0.14, 0.55], [5.43, 0.07, 0.35]];
    for (const [r, a, tau0] of parts) {
      if (f * r > 14000) continue;
      const tau = tau0 * decay;
      const len = Math.min(6, tau * 6);
      const o = this.osc("sine", f * r, t, t + len + 0.02);
      const g = this.ctx.createGain();
      strikeEnv(g.gain, t, 0.003, tau, len, vel * 0.075 * a);
      o.connect(g).connect(p);
    }
  }
  /** A filtered-noise swell that rises into a hit and stops just after it. */
  riser(dest, t, len, vel = 1) {
    const t0 = Math.max(0, t - len);
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(350, t0);
    bp.frequency.exponentialRampToValueAtTime(2600, t);
    const g = this.ctx.createGain();
    const N = 128, c = new Float32Array(N), dur = t + 0.06 - t0;
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * dur;
      c[i] = x <= t - t0 ? ((x / (t - t0)) ** 2.5) * 0.05 * vel : 0.05 * vel * (0.5 + 0.5 * Math.cos((Math.PI * (x - (t - t0))) / 0.06));
    }
    c[N - 1] = 0;
    g.gain.value = 0;
    g.gain.setValueCurveAtTime(c, t0, dur);
    const pn = this.ctx.createStereoPanner();
    pn.pan.value = 0;
    n.connect(bp).connect(g).connect(pn).connect(dest);
    n.start(t0);
    n.stop(t + 0.1);
  }
  /** The drone: a soft D pedal (two octaves of triangles) under a low-pass, breathing slowly. It steps back under
   *  chords whose bass is not D (a low D against a low B, E or G only beats and muddies), per `duck` [[t, level]]. */
  drone(dest, fadeFrom, end, duck) {
    const lp = this.ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 420; lp.Q.value = 0.3;
    const g = this.ctx.createGain();
    sustainEnv(g.gain, 0, fadeFrom, 0.3, end - fadeFrom - 0.05, 0.045);
    const breathe = this.osc("sine", 0.11, 0, end);
    const bg = this.ctx.createGain(), bm = this.ctx.createGain();
    bg.gain.value = 0.2; // ±20 % before the envelope, so the envelope still ends at exactly 0
    breathe.connect(bg).connect(bm.gain);
    const dk = this.ctx.createGain();
    dk.gain.setValueAtTime(duck[0][1], 0);
    for (let i = 1; i < duck.length; i++) {
      const [t, v] = duck[i];
      dk.gain.setValueAtTime(duck[i - 1][1], Math.max(duck[i - 1][0], t - 0.6));
      dk.gain.linearRampToValueAtTime(v, t);
    }
    lp.connect(bm).connect(dk).connect(g).connect(dest);
    for (const [m, a, dt] of [[38, 1, 0], [50, 0.35, -3]]) {
      const o = this.osc("triangle", mtof(m), 0, end, dt);
      const og = this.ctx.createGain();
      og.gain.value = a;
      o.connect(og).connect(lp);
    }
  }
}

// --- render --------------------------------------------------------------------------------------------------------

/** opts (for checking the mix): {mute: [bus names: strings, brass, low, drone, perc, chimes, lead], master: false skips
 *  the loudness/limiter stage} */
export async function buildScore(sb, opts = {}) {
  const P = plan(sb);
  const len = Math.round(SR * P.end);
  const ctx = new OfflineAudioContext(2, len, SR);
  const rnd = prng(20261125);
  const S = new Synth(ctx, rnd);
  const strings = S.bus(P.levels.strings, 0.55);
  const brass = S.bus(P.levels.brass, 0.5);
  const low = S.bus(P.levels.strings.map(([t, v]) => [t, 0.08 + 0.72 * v]), 0.25); // the bass follows the strings' arc
  const drone = S.bus(P.levels.drone, 0.15);
  const perc = S.bus([[0, 1]], 0.35);
  const chimes = S.bus([[0, 1]], 0.7, 0.9);
  const lead = S.bus([[0, 1]], 0.5);
  for (const [name, b] of Object.entries({ strings, brass, low, drone, perc, chimes, lead })) {
    if (opts.mute?.includes(name)) { b.gain.cancelScheduledValues(0); b.gain.value = 0; }
  }

  const duck = [];
  for (const c of P.chords) {
    // the D pedal stays only under a D bass; under A it steps back, under anything else (F# included: a low D a
    // third under F#2 is mud) it all but stops
    const v = c.bass === D2 ? 1 : c.bass === A2 || c.bass === A1 ? 0.5 : 0.12;
    if (!duck.length || duck[duck.length - 1][1] !== v) duck.push([c.t, v]);
  }
  S.drone(drone, P.lastEnd, P.end, duck);

  // Chords. A voice is held while its note stays and struck again only when it moves. A moving voice crossfades
  // quickly (the new note starts 0.1 s early, the old one releases over 0.3 s from the change), so chords arrive
  // clean and short chords really sound; only the last chord takes a long release, and the reverb does the rest.
  const LEAD = 0.1, XREL = 0.3;
  const nChords = P.chords.length;
  /** Runs per voice from fn(chord) → notes (null = this voice rests in that chord): [[{m, t0, t1, k, enter, rel}]]. */
  const segs = (fn) => {
    const runs = [], open = [];
    P.chords.forEach((c, k) => {
      const notes = fn(c);
      const nv = Math.max(notes.length, open.length);
      for (let v = 0; v < nv; v++) {
        const m = notes[v] ?? null, cur = open[v];
        if (cur && cur.m === m) continue; // tied
        if (cur) { cur.t1 = c.t - 0.02; cur.rel = m === null ? 0.6 : XREL; open[v] = null; }
        if (m === null) continue;
        const r = { m, t0: Math.max(0, c.t - (k === 0 ? 0 : LEAD)), t1: P.lastEnd, k, enter: !cur, rel: 1.3 };
        (runs[v] ??= []).push(r);
        open[v] = r;
      }
    });
    return runs;
  };
  const upVoices = (c) => (c.up === true ? [2, 3] : Array.isArray(c.up) ? c.up : []);
  const pans = [-0.7, -0.25, 0.25, 0.7];
  const attOf = (r, slow) => (r.k === 0 ? 0.9 : r.k === nChords - 1 ? 0.5 : r.enter ? slow : 0.45);
  segs((c) => c.pad).forEach((runs, v) => {
    for (const r of runs) S.strings(strings, r.m, r.t0, r.t1, { vel: 0.85, att: attOf(r, 0.75), rel: r.rel, pan: pans[v] });
  });
  // violins an octave up
  segs((c) => c.pad.map((m, v) => (upVoices(c).includes(v) ? m + 12 : null))).forEach((runs, v) => {
    for (const r of runs) S.strings(strings, r.m, r.t0, r.t1, { vel: 0.45, att: attOf(r, 0.9) + 0.1, rel: r.rel, bright: 1.05, pan: -pans[v] });
  });
  // brass: root and fifth only
  segs((c) => c.pad.map((m) => (isRootOrFifth(c.pad, m) ? m : null))).forEach((runs, v) => {
    for (const r of runs) S.brass(brass, r.m, r.t0, r.t1, { vel: 0.8, att: r.k === nChords - 1 ? 0.6 : r.enter ? 0.9 : 0.5, rel: r.rel, pan: pans[v] * 0.6 });
  });
  segs((c) => [c.bass])[0].forEach((r) => S.bass(low, r.m, r.t0, r.t1, { vel: 0.9, att: r.k === 0 ? 0.5 : 0.45, rel: r.rel }));

  for (const [t, m, v] of P.timp) S.timp(perc, m, t, v);
  for (const [t, l, v] of P.risers) S.riser(perc, t, l, v);
  for (const [t, m, v, d] of P.bells) S.bell(chimes, m, t, v, d);
  for (const [t, m, l, v] of P.horn) {
    const t1 = Math.min(t + l, P.lastEnd);
    S.brass(lead, m, t, t1, { vel: v * 2.1, att: 0.09, rel: t1 >= P.lastEnd ? 1.0 : 0.25, pan: 0.1, bright: 1.35 });
  }

  // master: a short fade at the very end; the voices' own releases have already taken the chord most of the way
  const fadeLen = P.end - 0.02 - P.fadeFrom;
  S.master.gain.setValueAtTime(1, 0);
  S.master.gain.setValueCurveAtTime(rc(1, 0, 256), P.fadeFrom, fadeLen);

  const t0 = performance.now();
  const buffer = await ctx.startRendering();
  const renderMs = Math.round(performance.now() - t0);
  const stats = opts.master === false ? {} : master(buffer);
  return { buffer, stats: { ...stats, renderMs, nodes: S.count, chords: P.chords.map((c) => +c.t.toFixed(2)), hits: P.timp.map((h) => +h[0].toFixed(3)), bells: P.bells.map((b) => +b[0].toFixed(3)) } };
}

// --- mastering: loudness, true peak, limiter -------------------------------------------------------------------

/** BS.1770-4 K-weighting (48 kHz coefficients) of one channel. */
function kWeight(x) {
  const y = new Float32Array(x.length);
  const st = [
    [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585],
    [1, -2, 1, -1.99004745483398, 0.99007225036621],
  ];
  let src = x;
  for (const [b0, b1, b2, a1, a2] of st) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      const o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = v; y2 = y1; y1 = o;
      y[i] = o;
    }
    src = y;
  }
  return y;
}

/** 4× oversampled peak (windowed-sinc interpolation), as an estimate of true peak. */
function truePeak(x) {
  const taps = 12, R = 4;
  const k = [];
  for (let p = 1; p < R; p++) {
    const ph = [];
    for (let j = -taps + 1; j <= taps; j++) {
      const d = j - p / R;
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / taps);
      ph.push((Math.sin(Math.PI * d) / (Math.PI * d)) * w);
    }
    k.push(ph);
  }
  let pk = 0;
  for (let i = 0; i < x.length; i++) {
    pk = Math.max(pk, Math.abs(x[i]));
    // an inter-sample peak is never far above its neighbours: skip quiet stretches
    if (Math.max(Math.abs(x[i]), Math.abs(x[i + 1] || 0)) < pk * 0.5) continue;
    for (const ph of k) {
      let s = 0;
      for (let j = 0; j < ph.length; j++) {
        const idx = i + j - taps + 1;
        if (idx >= 0 && idx < x.length) s += ph[j] * x[idx];
      }
      if (Math.abs(s) > pk) pk = Math.abs(s);
    }
  }
  return pk;
}

export function loudness(chs, sr = SR, withTruePeak = true) {
  const kw = chs.map(kWeight);
  const blk = Math.round(0.4 * sr), hop = Math.round(0.1 * sr);
  const L = [];
  for (let s = 0; s + blk <= kw[0].length; s += hop) {
    let z = 0;
    for (const c of kw) {
      let e = 0;
      for (let i = s; i < s + blk; i++) e += c[i] * c[i];
      z += e / blk;
    }
    L.push(z);
  }
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = L.filter((z) => lk(z) > -70);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const rel = lk(mean(abs)) - 10;
  const gated = abs.filter((z) => lk(z) > rel);
  let sp = 0;
  for (const c of chs) for (let i = 0; i < c.length; i++) sp = Math.max(sp, Math.abs(c[i]));
  return { lufs: gated.length ? lk(mean(gated)) : -Infinity, samplePeak: 20 * Math.log10(sp), truePeak: withTruePeak ? 20 * Math.log10(Math.max(...chs.map(truePeak))) : null };
}

/** Gain to the target loudness, then a look-ahead peak limiter (smooth gain, no clicks) under the true-peak
 *  ceiling; the gain is re-trimmed so the loudness still lands on target after limiting. */
function master(buffer) {
  const out = [buffer.getChannelData(0), buffer.getChannelData(1)];
  // DC: remove any offset (there should be none, the high-pass sees to that)
  for (const c of out) {
    let m = 0;
    for (let i = 0; i < c.length; i++) m += c[i];
    m /= c.length;
    if (Math.abs(m) > 1e-6) for (let i = 0; i < c.length; i++) c[i] -= m;
  }
  const src = out.map((c) => c.slice());
  const before = loudness(src, SR, false);
  let gainDb = TARGET_LUFS - before.lufs, ceiling = dbToGain(CEILING_DB - 0.25), maxGR = 0, after;
  for (let pass = 0; pass < 5; pass++) {
    const g = dbToGain(gainDb);
    for (let k = 0; k < 2; k++) for (let i = 0; i < src[k].length; i++) out[k][i] = src[k][i] * g;
    maxGR = limit(out, ceiling);
    after = loudness(out);
    const off = TARGET_LUFS - after.lufs;
    if (after.truePeak > CEILING_DB) ceiling *= dbToGain(CEILING_DB - after.truePeak - 0.05);
    else if (Math.abs(off) < 0.05) break;
    gainDb += off;
  }
  // did it converge? (a miss would otherwise only show if someone reads the numbers)
  const masterOk = Math.abs(after.lufs - TARGET_LUFS) <= 0.3 && after.truePeak <= CEILING_DB + 0.01;
  if (!masterOk) console.warn(`score: mastering missed its targets (${after.lufs.toFixed(2)} LUFS, ${after.truePeak.toFixed(2)} dBTP)`);
  return { masterOk, inputLufs: +before.lufs.toFixed(2), gainDb: +gainDb.toFixed(2), limiterMaxGrDb: +maxGR.toFixed(2), lufs: +after.lufs.toFixed(2), truePeakDb: +after.truePeak.toFixed(2), samplePeakDb: +after.samplePeak.toFixed(2) };
}

function limit(chs, ceiling) {
  const n = chs[0].length, W = Math.round(0.003 * SR); // 3 ms look-ahead
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = Math.max(Math.abs(chs[0][i]), Math.abs(chs[1][i]));
    need[i] = p > ceiling ? ceiling / p : 1;
  }
  // g1[i] = min(need[i .. i+W]) (forward-looking minimum), g2 = moving average of g1 over W (a smooth ramp that
  // reaches the minimum by the peak), then a slow release.
  const g1 = new Float32Array(n);
  const dq = [];
  for (let i = n - 1; i >= 0; i--) {
    while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop();
    dq.push(i);
    while (dq[0] > i + W) dq.shift();
    g1[i] = need[dq[0]];
  }
  const rel = 1 - Math.exp(-1 / (0.12 * SR));
  let sum = W, g = 1, maxGR = 0; // the window starts full of 1s
  for (let i = 0; i < n; i++) {
    sum += g1[i] - (i >= W ? g1[i - W] : 1);
    const g2 = Math.min(1, sum / W);
    g = g2 < g ? g2 : g + (g2 - g) * rel;
    if (g < 1) {
      chs[0][i] *= g;
      chs[1][i] *= g;
      maxGR = Math.max(maxGR, -20 * Math.log10(g));
    }
  }
  return maxGR;
}

/** 24-bit PCM WAV of an AudioBuffer. */
export function toWav(buffer) {
  const nch = buffer.numberOfChannels, n = buffer.length, bps = 3;
  const data = new Uint8Array(44 + n * nch * bps);
  const dv = new DataView(data.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (data[o + i] = c.charCodeAt(0)));
  str(0, "RIFF"); dv.setUint32(4, 36 + n * nch * bps, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nch, true);
  dv.setUint32(24, buffer.sampleRate, true); dv.setUint32(28, buffer.sampleRate * nch * bps, true);
  dv.setUint16(32, nch * bps, true); dv.setUint16(34, 24, true);
  str(36, "data"); dv.setUint32(40, n * nch * bps, true);
  const chs = [...Array(nch)].map((_, c) => buffer.getChannelData(c));
  let p = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const v = Math.max(-8388608, Math.min(8388607, Math.round(chs[c][i] * 8388607)));
      data[p++] = v & 255; data[p++] = (v >> 8) & 255; data[p++] = (v >> 16) & 255;
    }
  }
  return new Blob([data], { type: "audio/wav" });
}
