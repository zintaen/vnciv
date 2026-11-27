// A minimal MP4 (ISO BMFF) muxer for one H.264 video track and an optional AAC audio track, written for the trailer
// page (no dependencies).
//
//   muxMp4({width, height, timescale, avcC, samples: [{data: Uint8Array, duration, key}], audio?}) → Uint8Array
//     audio     {sampleRate, channels, asc, samples: [{data, duration}], skip, duration}: see muxMp4 below
//     avcC      the encoder's decoderConfig.description (an AVCDecoderConfigurationRecord)
//     samples   in decode order, each an AVC access unit in length-prefixed ("avc") format; duration in timescale
//               ticks. There are no B-frames (decode order = presentation order), so no ctts box is written.
//   Layout: ftyp, moov, mdat ("faststart": the index comes first, so players and uploaders can stream it).
//   Video alone: all samples in one chunk (stsc has one entry, stco one offset). With audio: both tracks in chunks
//   of about a second, interleaved. co64 is used if the file passes 4 GB.
//
//   parseBoxes(bytes) → [{type, start, size, children?, ...fields}]   a small reader for the boxes written here,
//   used by the self-test (mp4.test.js) and handy for checking a file in the console.

const enc = new TextEncoder();

class Writer {
  constructor() {
    this.parts = [];
    this.len = 0;
  }
  bytes(b) {
    this.parts.push(b);
    this.len += b.length;
    return this;
  }
  u8(v) { return this.bytes(Uint8Array.of(v & 255)); }
  u16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, v); return this.bytes(b); }
  i16(v) { const b = new Uint8Array(2); new DataView(b.buffer).setInt16(0, v); return this.bytes(b); }
  u32(v) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v >>> 0); return this.bytes(b); }
  u64(v) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    dv.setUint32(0, Math.floor(v / 2 ** 32));
    dv.setUint32(4, v >>> 0);
    return this.bytes(b);
  }
  str(s) { return this.bytes(enc.encode(s)); }
  zeros(n) { return this.bytes(new Uint8Array(n)); }
  out() {
    const o = new Uint8Array(this.len);
    let p = 0;
    for (const b of this.parts) { o.set(b, p); p += b.length; }
    return o;
  }
}

/** A box: 4-char type and a body (Uint8Array or array of them). */
function box(type, ...body) {
  const w = new Writer();
  let n = 8;
  for (const b of body) n += b.length;
  w.u32(n).str(type);
  for (const b of body) w.bytes(b);
  return w.out();
}
/** A full box: version + flags, then the body. */
function fullBox(type, version, flags, ...body) {
  const vf = new Writer().u8(version).u8(flags >> 16).u8(flags >> 8).u8(flags).out();
  return box(type, vf, ...body);
}
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
const matrix = () => { const w = new Writer(); for (const v of MATRIX) w.u32(v); return w.out(); };

function ftyp() {
  return box("ftyp", new Writer().str("isom").u32(512).str("isom").str("iso2").str("avc1").str("mp41").out());
}

function mvhd(movieTs, movieDur, nextId = 2) {
  const w = new Writer();
  w.u32(0).u32(0).u32(movieTs).u32(movieDur); // creation, modification, timescale, duration
  w.u32(0x00010000).u16(0x0100).zeros(10); // rate 1.0, volume 1.0, reserved
  w.bytes(matrix()).zeros(24).u32(nextId); // matrix, pre_defined, next_track_ID
  return fullBox("mvhd", 0, 0, w.out());
}

function tkhd(id, movieDur, width, height, audio) {
  const w = new Writer();
  w.u32(0).u32(0).u32(id).u32(0).u32(movieDur); // creation, modification, track_ID, reserved, duration
  w.zeros(8).u16(0).u16(0).u16(audio ? 0x0100 : 0).u16(0); // reserved, layer, alternate_group, volume, reserved
  w.bytes(matrix()).u32(width << 16).u32(height << 16);
  return fullBox("tkhd", 0, 3, w.out()); // enabled | in movie
}

function mdhd(ts, dur) {
  const lang = (("u".charCodeAt(0) - 0x60) << 10) | (("n".charCodeAt(0) - 0x60) << 5) | ("d".charCodeAt(0) - 0x60);
  return fullBox("mdhd", 0, 0, new Writer().u32(0).u32(0).u32(ts).u32(dur).u16(lang).u16(0).out());
}

function hdlr(type, name) {
  return fullBox("hdlr", 0, 0, new Writer().u32(0).str(type).zeros(12).str(name).u8(0).out());
}

function avc1(width, height, avcC, colr) {
  const w = new Writer();
  w.zeros(6).u16(1); // reserved, data_reference_index
  w.u16(0).u16(0).zeros(12); // pre_defined, reserved, pre_defined[3]
  w.u16(width).u16(height);
  w.u32(0x00480000).u32(0x00480000).u32(0).u16(1); // 72 dpi, reserved, frame_count
  const name = new Uint8Array(32); // compressorname: Pascal string, padded
  const nm = enc.encode("AVC Coding");
  name[0] = nm.length;
  name.set(nm, 1);
  w.bytes(name).u16(0x0018).i16(-1); // depth, pre_defined
  const kids = [box("avcC", avcC)];
  if (colr) kids.push(colr);
  kids.push(box("pasp", new Writer().u32(1).u32(1).out()));
  return box("avc1", w.out(), ...kids);
}

/** An MPEG-4 descriptor: tag, size (one byte; everything here is < 128 bytes), body. */
function desc(tag, ...body) {
  const n = body.reduce((a, b) => a + b.length, 0);
  if (n > 127) throw new Error("muxMp4: descriptor too long");
  const w = new Writer().u8(tag).u8(n);
  for (const b of body) w.bytes(b);
  return w.out();
}

/** mp4a sample entry with its esds (ES_Descriptor → DecoderConfigDescriptor (AAC, audio) → AudioSpecificConfig). */
function mp4a(a) {
  const w = new Writer();
  w.zeros(6).u16(1); // reserved, data_reference_index
  w.zeros(8).u16(a.channels).u16(16).u16(0).u16(0).u32(a.sampleRate << 16); // reserved, channelcount, samplesize, pre_defined, reserved, samplerate 16.16
  const maxSize = Math.max(...a.samples.map((s) => s.data.length));
  const durSec = a.samples.reduce((t, s) => t + s.duration, 0) / a.sampleRate;
  const avg = Math.round((a.samples.reduce((t, s) => t + s.data.length, 0) * 8) / durSec);
  const maxRate = Math.max(avg, Math.round((maxSize * 8 * a.sampleRate) / 1024));
  const dcd = desc(4,
    new Writer().u8(0x40).u8((0x05 << 2) | 1).u8(maxSize >> 16).u16(maxSize & 0xffff).u32(maxRate).u32(avg).out(), // AAC, audio stream, bufferSizeDB, max/avg bitrate
    desc(5, a.asc));
  const es = desc(3, new Writer().u16(0).u8(0).out(), dcd, desc(6, Uint8Array.of(2))); // ES_ID, flags; SLConfig predefined=2
  return box("mp4a", w.out(), fullBox("esds", 0, 0, es));
}

// nclx colour box from a VideoColorSpaceInit-like object (codes per ISO/IEC 23091-2); null when unknown.
const PRIMARIES = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 };
const TRANSFER = { bt709: 1, smpte170m: 6, iec61966_2_1: 13, "iec61966-2-1": 13, linear: 8, pq: 16, hlg: 18 };
const MATRIXC = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, bt2020_ncl: 9 };
function colrBox(cs) {
  if (!cs) return null;
  const p = PRIMARIES[cs.primaries], t = TRANSFER[cs.transfer], m = MATRIXC[cs.matrix];
  if (p == null || t == null || m == null) return null;
  return box("colr", new Writer().str("nclx").u16(p).u16(t).u16(m).u8(cs.fullRange ? 0x80 : 0).out());
}

function stbl(tr, useCo64) {
  const { samples } = tr;
  const stsd = fullBox("stsd", 0, 0, new Writer().u32(1).out(), tr.entry);
  // stts: run-length of durations
  const runs = [];
  for (const s of samples) {
    const last = runs[runs.length - 1];
    if (last && last[1] === s.duration) last[0]++;
    else runs.push([1, s.duration]);
  }
  const stts = new Writer().u32(runs.length);
  for (const [n, d] of runs) stts.u32(n).u32(d);
  const keys = [];
  samples.forEach((s, i) => (s.key ?? true) && keys.push(i + 1));
  const stss = new Writer().u32(keys.length);
  for (const k of keys) stss.u32(k);
  // stsc: a new entry wherever the number of samples per chunk changes
  const sc = [];
  tr.chunks.forEach((c, i) => { if (!sc.length || sc[sc.length - 1][1] !== c.count) sc.push([i + 1, c.count]); });
  const stsc = new Writer().u32(sc.length);
  for (const [first, n] of sc) stsc.u32(first).u32(n).u32(1);
  const stsz = new Writer().u32(0).u32(samples.length);
  for (const s of samples) stsz.u32(s.data.length);
  const co = new Writer().u32(tr.chunks.length);
  for (const c of tr.chunks) (useCo64 ? co.u64(c.offset) : co.u32(c.offset));
  // AAC: every frame needs the one before it to decode cleanly (MDCT overlap), signalled as a 'roll' sample group
  // with roll_distance -1, as Apple's and other muxers write it; players use it with the edit list to handle priming.
  const roll = tr.kind === "soun" ? [
    fullBox("sgpd", 1, 0, new Writer().str("roll").u32(2).u32(1).i16(-1).out()),
    fullBox("sbgp", 0, 0, new Writer().str("roll").u32(1).u32(samples.length).u32(1).out()),
  ] : [];
  const kids = [
    stsd,
    ...roll,
    fullBox("stts", 0, 0, stts.out()),
    // Every sample a keyframe → stss is omitted (that is what its absence means).
    ...(keys.length < samples.length ? [fullBox("stss", 0, 0, stss.out())] : []),
    fullBox("stsc", 0, 0, stsc.out()),
    fullBox("stsz", 0, 0, stsz.out()),
    fullBox(useCo64 ? "co64" : "stco", 0, 0, co.out()),
  ];
  return box("stbl", ...kids);
}

const MOVIE_TS = 1000;

function trak(tr, useCo64) {
  const dur = tr.samples.reduce((a, s) => a + s.duration, 0);
  const audio = tr.kind === "soun";
  const head = audio
    ? fullBox("smhd", 0, 0, new Writer().i16(0).u16(0).out())
    : fullBox("vmhd", 0, 1, new Writer().u16(0).u16(0).u16(0).u16(0).out());
  const dref = fullBox("dref", 0, 0, new Writer().u32(1).out(), fullBox("url ", 0, 1));
  const minf = box("minf", head, box("dinf", dref), stbl(tr, useCo64));
  const mdia = box("mdia", mdhd(tr.timescale, dur), audio ? hdlr("soun", "SoundHandler") : hdlr("vide", "VideoHandler"), minf);
  const kids = [tkhd(tr.id, tr.movieDur, tr.width || 0, tr.height || 0, audio)];
  // an edit list skips the encoder's priming samples, so the audio starts exactly at 0 and lasts movieDur
  if (tr.skip != null) {
    const el = new Writer().u32(1).u32(tr.movieDur).u32(tr.skip).u16(1).u16(0);
    kids.push(box("edts", fullBox("elst", 0, 0, el.out())));
  }
  return box("trak", ...kids, mdia);
}

function moov(tracks, useCo64) {
  const movieDur = Math.max(...tracks.map((t) => t.movieDur));
  return box("moov", mvhd(MOVIE_TS, movieDur, tracks.length + 1), ...tracks.map((t) => trak(t, useCo64)));
}

/** Split a track's samples into chunks of about `sec` seconds: [{first, count, start (s), bytes}]. */
function chunkTrack(tr, sec) {
  const chunks = [];
  let t = 0, cur = null;
  tr.samples.forEach((s, i) => {
    const time = t / tr.timescale;
    if (!cur || time >= cur.start + sec) chunks.push((cur = { first: i, count: 0, start: time, bytes: 0, track: tr }));
    cur.count++;
    cur.bytes += s.data.length;
    t += s.duration;
  });
  return chunks;
}

/**
 * muxMp4({width, height, timescale, avcC, colorSpace?, samples, audio?}) → Uint8Array
 *   audio = {sampleRate, channels, asc, samples: [{data, duration}], skip, duration}
 *     asc       the AAC AudioSpecificConfig (the encoder's decoderConfig.description)
 *     skip      encoder priming samples to skip at the start (written as an edit list)
 *     duration  the audio's real length in samples (the edit's length; the stream itself is longer by the priming
 *               and the last frame's padding)
 * With audio, the two tracks are interleaved in mdat in chunks of about a second (video first in each second).
 */
export function muxMp4(o) {
  if (!o.samples?.length) throw new Error("muxMp4: no samples");
  if (!(o.avcC instanceof Uint8Array)) o = { ...o, avcC: new Uint8Array(o.avcC) };
  if (!o.samples[0].key) throw new Error("muxMp4: the first sample must be a keyframe");
  const vDur = o.samples.reduce((a, s) => a + s.duration, 0);
  const tracks = [{
    kind: "vide", id: 1, timescale: o.timescale, samples: o.samples, width: o.width, height: o.height,
    entry: avc1(o.width, o.height, o.avcC, colrBox(o.colorSpace)), movieDur: Math.round((vDur / o.timescale) * MOVIE_TS),
  }];
  const a = o.audio;
  if (a) {
    if (!a.samples?.length) throw new Error("muxMp4: audio has no samples");
    const asc = a.asc instanceof Uint8Array ? a.asc : new Uint8Array(a.asc);
    const len = a.duration ?? a.samples.reduce((t, s) => t + s.duration, 0) - (a.skip || 0);
    tracks.push({
      kind: "soun", id: 2, timescale: a.sampleRate, samples: a.samples, entry: mp4a({ ...a, asc }),
      skip: a.skip || 0, movieDur: Math.round((len / a.sampleRate) * MOVIE_TS),
    });
  }
  const sec = a ? 1 : Infinity;
  const chunks = tracks.flatMap((t) => (t.chunks = chunkTrack(t, sec)))
    .sort((x, y) => x.start - y.start || x.track.id - y.track.id);
  const head = ftyp();
  const dataLen = chunks.reduce((s, c) => s + c.bytes, 0);
  const bigMdat = dataLen + 8 > 0xffffffff;
  const mdatHead = bigMdat ? 16 : 8;
  // moov's size does not depend on the offsets' values (stco is fixed width), so measure once and place.
  for (const c of chunks) c.offset = 0;
  const probe = moov(tracks, false);
  const useCo64 = head.length + probe.length + mdatHead + dataLen > 0xffffffff;
  const mv0 = useCo64 ? moov(tracks, true) : probe;
  let p = head.length + mv0.length + mdatHead;
  for (const c of chunks) { c.offset = p; p += c.bytes; }
  const mv = moov(tracks, useCo64);
  if (mv.length !== mv0.length) throw new Error("muxMp4: moov size changed");
  const out = new Uint8Array(p);
  out.set(head, 0);
  out.set(mv, head.length);
  const dv = new DataView(out.buffer);
  p = head.length + mv.length;
  if (bigMdat) {
    dv.setUint32(p, 1);
    out.set(enc.encode("mdat"), p + 4);
    dv.setUint32(p + 8, Math.floor((dataLen + 16) / 2 ** 32));
    dv.setUint32(p + 12, (dataLen + 16) >>> 0);
  } else {
    dv.setUint32(p, dataLen + 8);
    out.set(enc.encode("mdat"), p + 4);
  }
  for (const c of chunks) {
    let q = c.offset;
    for (let i = c.first; i < c.first + c.count; i++) {
      out.set(c.track.samples[i].data, q);
      q += c.track.samples[i].data.length;
    }
  }
  return out;
}

// --- reader (for tests and checks) ---------------------------------------------------------------------------------

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "dinf", "stbl", "edts"]);

export function parseBoxes(bytes, start = 0, end = bytes.length) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p);
    const type = dec.decode(bytes.subarray(p + 4, p + 8));
    let hdr = 8;
    if (size === 1) {
      size = dv.getUint32(p + 8) * 2 ** 32 + dv.getUint32(p + 12);
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) throw new Error(`parseBoxes: bad size for ${type} at ${p}`);
    const b = { type, start: p, size };
    const body = p + hdr;
    const u32 = (o) => dv.getUint32(body + o);
    if (CONTAINERS.has(type)) b.children = parseBoxes(bytes, body, p + size);
    else if (type === "ftyp") b.major = dec.decode(bytes.subarray(body, body + 4));
    else if (type === "mvhd") Object.assign(b, { timescale: u32(12), duration: u32(16), nextTrackId: u32(96) });
    else if (type === "tkhd") Object.assign(b, { trackId: u32(12), duration: u32(20), width: u32(76) >>> 16, height: u32(80) >>> 16 });
    else if (type === "mdhd") Object.assign(b, { timescale: u32(12), duration: u32(16) });
    else if (type === "hdlr") b.handler = dec.decode(bytes.subarray(body + 8, body + 12));
    else if (type === "stsd") {
      const e = body + 8; // first entry
      b.format = dec.decode(bytes.subarray(e + 4, e + 8));
      if (b.format === "mp4a") {
        b.channels = dv.getUint16(e + 8 + 16);
        b.sampleSize = dv.getUint16(e + 8 + 18);
        b.sampleRate = dv.getUint32(e + 8 + 24) >>> 16;
        b.entry = parseBoxes(bytes, e + 8 + 28, e + dv.getUint32(e));
      } else {
        b.width = dv.getUint16(e + 8 + 24);
        b.height = dv.getUint16(e + 8 + 26);
        b.entry = parseBoxes(bytes, e + 8 + 78, e + dv.getUint32(e));
      }
    } else if (type === "elst") {
      const n = u32(4);
      b.entries = [];
      for (let i = 0; i < n; i++) b.entries.push([u32(8 + i * 12), dv.getInt32(body + 12 + i * 12), dv.getInt16(body + 16 + i * 12)]);
    } else if (type === "sgpd") {
      Object.assign(b, { grouping: dec.decode(bytes.subarray(body + 4, body + 8)), entries: u32(12), roll: dv.getInt16(body + 16) });
    } else if (type === "sbgp") {
      Object.assign(b, { grouping: dec.decode(bytes.subarray(body + 4, body + 8)), runs: [[u32(12), u32(16)]] });
    } else if (type === "smhd") {
      b.balance = dv.getInt16(body + 4);
    } else if (type === "esds") {
      // walk the descriptors: 3 (ES) → 4 (DecoderConfig) → 5 (DecoderSpecificInfo = AudioSpecificConfig)
      const walk = (q, stop) => {
        while (q < stop) {
          const tag = bytes[q++];
          let len = 0, c;
          do { c = bytes[q++]; len = (len << 7) | (c & 127); } while (c & 128);
          if (tag === 3) walk(q + 3, q + len);
          else if (tag === 4) { b.objectType = bytes[q]; b.streamType = bytes[q + 1] >> 2; b.avgBitrate = dv.getUint32(q + 9); walk(q + 13, q + len); }
          else if (tag === 5) b.asc = [...bytes.subarray(q, q + len)];
          q += len;
        }
      };
      walk(body + 4, p + size);
    } else if (type === "stts") {
      const n = u32(4);
      b.entries = [];
      for (let i = 0; i < n; i++) b.entries.push([u32(8 + i * 8), u32(12 + i * 8)]);
    } else if (type === "stss") {
      const n = u32(4);
      b.keys = [];
      for (let i = 0; i < n; i++) b.keys.push(u32(8 + i * 4));
    } else if (type === "stsc") {
      const n = u32(4);
      b.entries = [];
      for (let i = 0; i < n; i++) b.entries.push([u32(8 + i * 12), u32(12 + i * 12), u32(16 + i * 12)]);
    } else if (type === "stsz") {
      const n = u32(8);
      b.sampleSize = u32(4);
      b.sizes = [];
      if (!b.sampleSize) for (let i = 0; i < n; i++) b.sizes.push(u32(12 + i * 4));
      b.count = n;
    } else if (type === "stco") {
      const n = u32(4);
      b.offsets = [];
      for (let i = 0; i < n; i++) b.offsets.push(u32(8 + i * 4));
    } else if (type === "co64") {
      const n = u32(4);
      b.offsets = [];
      for (let i = 0; i < n; i++) b.offsets.push(u32(8 + i * 8) * 2 ** 32 + u32(12 + i * 8));
    } else if (type === "mdat") {
      b.dataStart = body;
    }
    out.push(b);
    p += size;
  }
  return out;
}

/** The trak boxes of a parsed file, as {handler, boxes} (find a track's own boxes with findBox(t.boxes, …)). */
export function tracksOf(top) {
  const mv = top.find((b) => b.type === "moov");
  return (mv?.children || []).filter((b) => b.type === "trak").map((t) => ({ handler: findBox(t.children, "hdlr")?.handler, boxes: t.children }));
}

/** Depth-first find of the first box of `type`. */
export function findBox(boxes, type) {
  for (const b of boxes) {
    if (b.type === type) return b;
    const kids = b.children || b.entry;
    if (kids) {
      const f = findBox(kids, type);
      if (f) return f;
    }
  }
  return null;
}
