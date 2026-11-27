// Trailer renderer: draws every frame offline (not in real time) with the app's renderer, encodes H.264 with
// WebCodecs and writes an MP4 with mp4.js. No installs, no server-side work.
//
// Console / automation API (window.__trailer):
//   preview(i)              draw frame i into the preview canvas
//   render({save, sound})   render + encode the whole trailer; save=true also POSTs trailer.mp4, the review stills and
//                           (with sound) trailer_audio.wav to a local receiver (RECEIVER below), when one is running.
//                           sound defaults to the "Sound" checkbox (on): the score from score.js, encoded as AAC
//   audio({save})           render only the score (no video): returns its stats; save=true POSTs trailer_audio.wav
//   progress, state         progress text and {phase, frame, frames, error, bytes, ms}
//   blob                    the last MP4 (Download MP4 saves it)
import { loadStage } from "./stage.js";
import { buildStoryboard, activeShots, CONFIG, W, H } from "./storyboard.js";
import { muxMp4, parseBoxes, findBox, tracksOf } from "./mp4.js";
import { runMp4SelfTest } from "./mp4.test.js";
import { smooth, easeOut } from "./overlays.js";
import { buildScore, toWav, SR } from "./score.js";

// Optional local receiver that writes POSTed files into the project's out/ folder (dev only).
const RECEIVER = "http://127.0.0.1:8799/";
const BITRATE = 5.6e6; // target (variable bitrate); ~6 Mbps keeps 30 s under ~25 MB for easy tweeting
const KEY_EVERY = 60; // frames (2 s)
const STILL_EVERY = 45; // frames (1.5 s) between review stills
const AUDIO_BITRATE = 192000;
const AAC_FRAME = 1024; // samples per AAC-LC frame

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const T = (window.__trailer = { progress: "loading", state: { phase: "loading" }, blob: null });
const say = (msg, err = false) => {
  statusEl.textContent = msg;
  statusEl.classList.toggle("err", err);
  T.progress = msg;
};

let stage, sb;
try {
  stage = await loadStage("../data/");
  sb = buildStoryboard(stage, CONFIG);
} catch (err) {
  say(`Could not load: ${err.message}`, true);
  T.state = { phase: "error", error: String(err.stack || err) };
  throw err;
}

// --- canvases --------------------------------------------------------------------------------------------------
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
let SS = 2; // supersampling factor for the map render
let hi = mk(W * SS, H * SS);
const bufs = [mk(W, H), mk(W, H), mk(W, H)];
const frameCv = mk(W, H);
const fctx = frameCv.getContext("2d");
const preview = $("preview");

function setSS(ss) {
  if (ss === SS) return;
  SS = ss;
  hi = mk(W * SS, H * SS);
}

function drawView(ctx, view, alpha) {
  const cam = stage.render(hi, { ...view, dpr: stage.dpr * SS });
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(hi, 0, 0, W, H);
  ctx.restore();
  return cam;
}

function composeShot(shot, sec, buf) {
  const ctx = buf.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  let cam = null;
  for (const l of shot.render(sec)) {
    const c = drawView(ctx, l.view, l.alpha ?? 1);
    cam ??= c;
  }
  const kx = W / cam.w, ky = H / cam.h;
  const frame = { cam, toScreen: (x, y) => [((x - cam.x) * cam.scale + cam.w / 2) * kx, ((y - cam.y) * cam.scale + cam.h / 2) * ky] };
  ctx.save();
  shot.overlay?.(ctx, sec, frame);
  ctx.restore();
}

function renderFrame(i) {
  const t = i / sb.fps;
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.globalAlpha = 1;
  fctx.fillStyle = "#000";
  fctx.fillRect(0, 0, W, H);
  const act = activeShots(sb, t);
  const top = act[act.length - 1];
  const trans = act.length > 1 && top.alpha < 1 ? top.shot.trans : null;
  if (trans === "dip") {
    // dip to dark: the old shot darkens over the first half, the new one rises out of it over the second
    const old = act[act.length - 2];
    const first = top.alpha < 0.5;
    const a = first ? old : top;
    composeShot(a.shot, a.sec, bufs[0]);
    fctx.drawImage(bufs[0], 0, 0);
    const dark = first ? smooth(top.alpha * 2) : 1 - smooth((top.alpha - 0.5) * 2); // symmetric: as long out as in
    fctx.fillStyle = `rgba(4,7,12,${0.92 * dark})`;
    fctx.fillRect(0, 0, W, H);
  } else if (trans === "punch") {
    // zoom-through cut: the old shot rushes towards the viewer (zoom blur + a little light), hard cut, and the new
    // one settles from 110% with the blur and light falling away. No double exposure.
    const old = act[act.length - 2];
    const u = top.alpha, M = 0.4;
    const e = u < M ? (u / M) ** 2 : 1 - easeOut((u - M) / (1 - M));
    const a = u < M ? old : top;
    composeShot(a.shot, a.sec, bufs[0]);
    zoomBlur(fctx, bufs[0], 1 + (u < M ? 0.16 : 0.1) * e, e);
    fctx.fillStyle = `rgba(255,244,222,${0.18 * e})`;
    fctx.fillRect(0, 0, W, H);
  } else {
    act.forEach((a, k) => {
      composeShot(a.shot, a.sec, bufs[k]);
      fctx.globalAlpha = a.alpha;
      fctx.drawImage(bufs[k], 0, 0);
    });
  }
  fctx.globalAlpha = 1;
  // the opening rises from half-dark (frame 0 already shows the map and the title coming in)
  const fadeIn = 0.5 * (1 - smooth(t / 0.7));
  if (fadeIn > 0) {
    fctx.fillStyle = `rgba(0,0,0,${fadeIn})`;
    fctx.fillRect(0, 0, W, H);
  }
  return frameCv;
}

/** Draw src scaled by s about the centre, with a radial zoom blur of strength b (0..1). */
function zoomBlur(ctx, src, s, b) {
  const draw = (k, a) => {
    ctx.globalAlpha = a;
    ctx.drawImage(src, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k);
  };
  ctx.save();
  ctx.imageSmoothingQuality = "high";
  draw(s, 1);
  for (let i = 1; i <= 4 && b > 0.02; i++) draw(s * (1 + 0.022 * i * b), 0.3 * b);
  ctx.restore();
}

function showPreview() {
  preview.getContext("2d").drawImage(frameCv, 0, 0);
}

T.preview = (i) => {
  renderFrame(Math.max(0, Math.min(sb.frames - 1, i | 0)));
  showPreview();
  $("time").textContent = `${(i / sb.fps).toFixed(2)} s`;
};

async function post(name, blob) {
  const r = await fetch(RECEIVER + name, { method: "POST", body: blob });
  if (!r.ok) throw new Error(`receiver: ${name}: HTTP ${r.status}`);
}
const jpeg = (cv, q = 0.9) => new Promise((res) => cv.toBlob(res, "image/jpeg", q));

/** Save a still of frame i to the receiver (for reviewing the look without encoding). */
T.snap = async (i, name = `prev_${String(i).padStart(3, "0")}.jpg`) => {
  T.preview(i);
  await post(name, await jpeg(frameCv));
  return name;
};

// Frames saved as review stills: every 1.5 s plus the first and last frame of each shot.
function stillFrames() {
  const set = new Set();
  for (let i = 0; i < sb.frames; i += STILL_EVERY) set.add(i);
  for (const s of sb.shots) {
    set.add(Math.min(sb.frames - 1, Math.round(s.t0 * sb.fps)));
    set.add(Math.min(sb.frames - 1, Math.round(s.t1 * sb.fps) - 1));
  }
  set.add(sb.frames - 1);
  return set;
}

async function pickConfig() {
  const base = { width: W, height: H, bitrate: BITRATE, framerate: sb.fps, avc: { format: "avc" }, latencyMode: "quality", bitrateMode: "variable" };
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
    for (const hw of ["no-preference", "prefer-software"]) {
      const c = { ...base, codec, hardwareAcceleration: hw };
      try {
        const s = await VideoEncoder.isConfigSupported(c);
        if (s.supported) return s.config;
      } catch { /* try the next */ }
    }
  }
  throw new Error("no supported H.264 encoder configuration");
}

// --- audio -------------------------------------------------------------------------------------------------------

const aacConfig = () => ({ codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, bitrate: AUDIO_BITRATE, bitrateMode: "constant" });
const bytesOf = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)));

/** Encode planar float channels as AAC-LC: {asc, chunks: [Uint8Array], frames}. Input timestamps are exact sample
 *  times; the encoder's output frames are 1024 samples each, starting with its priming. */
async function encodeAac(chs) {
  const out = [];
  let asc = null, err = null;
  const enc = new AudioEncoder({
    output(c, meta) {
      if (meta?.decoderConfig?.description && !asc) asc = bytesOf(meta.decoderConfig.description);
      const d = new Uint8Array(c.byteLength);
      c.copyTo(d);
      out.push({ d, ts: c.timestamp });
    },
    error(e) { err = e; },
  });
  enc.configure(aacConfig());
  const n = chs[0].length;
  for (let p = 0; p < n; p += AAC_FRAME) {
    const k = Math.min(AAC_FRAME, n - p);
    const buf = new Float32Array(2 * k);
    buf.set(chs[0].subarray(p, p + k), 0);
    buf.set(chs[1].subarray(p, p + k), k);
    const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: k, numberOfChannels: 2, timestamp: Math.round((p / SR) * 1e6), data: buf });
    enc.encode(ad);
    ad.close();
    if (err) throw err;
  }
  await enc.flush();
  enc.close();
  if (err) throw err;
  if (!asc) throw new Error("AAC encoder gave no AudioSpecificConfig");
  for (let i = 1; i < out.length; i++) if (out[i].ts < out[i - 1].ts) throw new Error("AAC encoder output out of order");
  return { asc, chunks: out.map((o) => o.d) };
}

/** Decode AAC frames back to the left channel's samples (for measuring the encoder's delay). */
async function decodeAac(asc, chunks) {
  const parts = [];
  let err = null;
  const dec = new AudioDecoder({
    output(a) { const f = new Float32Array(a.numberOfFrames); a.copyTo(f, { planeIndex: 0, format: "f32-planar" }); parts.push(f); a.close(); },
    error(e) { err = e; },
  });
  dec.configure({ codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, description: asc });
  chunks.forEach((d, i) => dec.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(((i * AAC_FRAME) / SR) * 1e6), data: d })));
  await dec.flush();
  dec.close();
  if (err) throw err;
  const all = new Float32Array(parts.reduce((a, f) => a + f.length, 0));
  let p = 0;
  for (const f of parts) { all.set(f, p); p += f.length; }
  return all;
}

/** The encoder's priming (samples of delay before the input's first sample), measured with an impulse: encode a
 *  click at a known sample, decode, and see where it lands. (Chromium's AAC encoder on macOS: 2112.) */
let primingCache = null;
async function aacPriming() {
  if (primingCache != null) return primingCache;
  const n = 12000, at = 3000;
  const L = new Float32Array(n), R = new Float32Array(n);
  L[at] = R[at] = 0.8;
  const { asc, chunks } = await encodeAac([L, R]);
  const y = await decodeAac(asc, chunks);
  let mi = 0;
  for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[mi])) mi = i;
  const p = mi - at;
  if (!(p >= 0 && p < 5000)) throw new Error(`could not measure the AAC encoder's priming (got ${p})`);
  return (primingCache = p);
}

/** The score as an MP4 audio track: {track (for muxMp4), stats, wav}. */
async function makeAudio() {
  say("Composing the score…");
  const { buffer, stats } = await buildScore(sb);
  if (!stats.masterOk) throw new Error(`score: mastering missed its targets (${stats.lufs} LUFS, true peak ${stats.truePeakDb} dBTP)`);
  say("Encoding the audio (AAC)…");
  const skip = await aacPriming();
  const chs = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const { asc, chunks } = await encodeAac(chs);
  if (chunks.length * AAC_FRAME < skip + buffer.length) throw new Error(`AAC: ${chunks.length} frames do not cover ${buffer.length} samples + ${skip} priming`);
  const track = { sampleRate: SR, channels: 2, asc, skip, duration: buffer.length, samples: chunks.map((data) => ({ data, duration: AAC_FRAME })) };
  return { track, buffer, stats: { ...stats, aacFrames: chunks.length, priming: skip, asc: [...asc].map((v) => v.toString(16).padStart(2, "0")).join("") } };
}

T.audio = async ({ save = false } = {}) => {
  const { buffer, stats } = await buildScore(sb);
  if (save) await post("trailer_audio.wav", toWav(buffer));
  T.audioBuffer = buffer;
  say(`Score: ${stats.lufs} LUFS, true peak ${stats.truePeakDb} dBTP${stats.masterOk ? "" : " · MASTERING MISSED ITS TARGETS"}${save ? " · saved trailer_audio.wav" : ""}`, !stats.masterOk);
  return stats;
};

T.render = async ({ save = false, sound = $("opt-sound").checked } = {}) => {
  if (T.state.phase === "rendering") throw new Error("already rendering");
  const t0 = performance.now();
  T.state = { phase: "rendering", frame: 0, frames: sb.frames, ss: SS, sound };
  $("btn-render").disabled = true;
  $("btn-download").disabled = true;
  try {
    const config = await pickConfig();
    T.state.codec = config.codec;
    const samples = [];
    let description = null, colorSpace = null, encErr = null;
    const encoder = new VideoEncoder({
      output(chunk, meta) {
        const dc = meta?.decoderConfig;
        if (dc?.description && !description) {
          const d = dc.description;
          description = d instanceof ArrayBuffer ? new Uint8Array(d.slice(0)) : new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
          colorSpace = dc.colorSpace || null;
        }
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        samples.push({ data, ts: chunk.timestamp, key: chunk.type === "key" });
      },
      error(e) { encErr = e; },
    });
    encoder.configure(config);
    const stills = save ? stillFrames() : new Set();
    const uploads = [];
    const frameUs = 1e6 / sb.fps;
    for (let i = 0; i < sb.frames; i++) {
      if (encErr) throw encErr;
      renderFrame(i);
      const vf = new VideoFrame(frameCv, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(vf, { keyFrame: i % KEY_EVERY === 0 });
      vf.close();
      if (stills.has(i)) uploads.push(jpeg(frameCv).then((b) => post(`frame_${String(i).padStart(3, "0")}.jpg`, b)));
      T.state.frame = i + 1;
      if (i % 10 === 0) {
        showPreview();
        say(`Rendering frame ${i + 1} / ${sb.frames} (${((performance.now() - t0) / 1000).toFixed(0)} s)`);
      }
      // backpressure + let the page breathe
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    say("Flushing the encoder…");
    await encoder.flush();
    encoder.close();
    if (encErr) throw encErr;
    // Exactly one chunk per frame, in order, keyframes where asked.
    if (samples.length !== sb.frames) throw new Error(`encoder returned ${samples.length} chunks for ${sb.frames} frames`);
    samples.forEach((s, i) => {
      if (s.ts !== Math.round(i * frameUs)) throw new Error(`chunk ${i}: timestamp ${s.ts}, expected ${Math.round(i * frameUs)} (reordered output?)`);
    });
    if (!description) throw new Error("encoder gave no avcC description");
    const timescale = sb.fps * 1000;
    const audio = sound ? await makeAudio() : null;
    const muxIn = {
      width: W, height: H, timescale, avcC: description, colorSpace,
      samples: samples.map((s) => ({ data: s.data, key: s.key, duration: 1000 })),
      audio: audio?.track,
    };
    T.lastMux = muxIn; // kept for checks in the console (re-muxing costs no re-render)
    const bytes = muxMp4(muxIn);
    // read it back
    const top = parseBoxes(bytes);
    const trs = tracksOf(top);
    const vsz = findBox(trs[0]?.boxes || [], "stsz");
    const asz = audio ? findBox(trs[1]?.boxes || [], "stsz") : null;
    if (top.map((b) => b.type).join() !== "ftyp,moov,mdat" || vsz?.count !== sb.frames || trs.length !== (audio ? 2 : 1) ||
      (audio && asz?.count !== audio.track.samples.length)) throw new Error("MP4 read-back failed");
    if (audio) T.state.audio = audio.stats;
    T.blob = new Blob([bytes], { type: "video/mp4" });
    T.state = {
      ...T.state, phase: "encoded", bytes: bytes.length, keyframes: samples.filter((s) => s.key).length,
      mbps: +((bytes.length * 8) / sb.duration / 1e6).toFixed(2), colorSpace,
      ms: Math.round(performance.now() - t0),
    };
    if (save) {
      say("Saving trailer.mp4 and stills…");
      await Promise.all(uploads);
      if (audio) await post("trailer_audio.wav", toWav(audio.buffer));
      await post("trailer.mp4", T.blob);
      T.state.saved = true;
    }
    T.state.phase = "done";
    const snd = audio ? ` + AAC ${audio.stats.lufs} LUFS` : " (silent)";
    say(`Done: ${(bytes.length / 1e6).toFixed(1)} MB, ${sb.frames} frames, ${config.codec}${snd}, ${(T.state.ms / 1000).toFixed(0)} s${save ? " · saved to out/" : ""}`);
    $("btn-download").disabled = false;
  } catch (err) {
    T.state = { ...T.state, phase: "error", error: String(err.stack || err) };
    say(`Render failed: ${err.message}`, true);
    throw err;
  } finally {
    $("btn-render").disabled = false;
  }
};

// --- UI ----------------------------------------------------------------------------------------------------------
$("scrub").max = String(sb.frames - 1);
$("scrub").addEventListener("input", (e) => T.preview(+e.target.value));
$("opt-ss").addEventListener("change", (e) => setSS(e.target.checked ? 2 : 1));
$("btn-render").addEventListener("click", () => T.render({ save: new URLSearchParams(location.search).has("save") }).catch(() => {}));
$("btn-download").addEventListener("click", () => {
  if (!T.blob) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(T.blob);
  a.download = "trailer.mp4";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
});
$("btn-test").addEventListener("click", () => {
  const r = runMp4SelfTest();
  say(r.ok ? `MP4 self-test passed (${r.checks} checks)` : `MP4 self-test FAILED: ${r.fails.join("; ")}`, !r.ok);
});
/** Dev check for motion design: render frames a..b and return "i mean diff" per frame (luma sampled every 20 px,
 *  the same grid as the AVFoundation check), so jolts at shot boundaries show up without encoding. */
T.motion = (a, b) => {
  let prev = null;
  const rows = [];
  for (let i = a; i <= b; i++) {
    renderFrame(i);
    const px = fctx.getImageData(0, 0, W, H).data;
    const cur = [];
    for (let y = 10; y < H; y += 20) for (let x = 10; x < W; x += 20) {
      const o = (y * W + x) * 4;
      cur.push(0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]);
    }
    const mean = cur.reduce((s, v) => s + v, 0) / cur.length;
    const d = prev ? cur.reduce((s, v, k) => s + Math.abs(v - prev[k]), 0) / cur.length : 0;
    rows.push(`${i} ${mean.toFixed(1)} ${d.toFixed(2)}`);
    prev = cur;
  }
  return rows.join("\n");
};
T.selfTest = runMp4SelfTest;
T.muxMp4 = muxMp4;
T.stage = stage;
T.sb = sb;
T.state = { phase: "ready" };
$("btn-render").disabled = false;
T.preview(0);
say(`Ready: ${sb.frames} frames at ${sb.fps} fps. Press Render.`);
