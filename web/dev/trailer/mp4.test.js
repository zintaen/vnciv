// Self-test for mp4.js: mux a synthetic track, parse it back, check every field the muxer writes.
// Run from the trailer page ("Self-test" button) or the console: (await import("./trailer/mp4.test.js")).runMp4SelfTest()
import { muxMp4, parseBoxes, findBox, tracksOf } from "./mp4.js";

export function runMp4SelfTest() {
  const fails = [];
  const eq = (name, a, b) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    if (!ok) fails.push(`${name}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
  };
  const avcC = Uint8Array.of(1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80);
  const n = 95;
  const samples = [];
  for (let i = 0; i < n; i++) {
    const len = 20 + ((i * 37) % 300);
    const data = new Uint8Array(len);
    for (let j = 0; j < len; j++) data[j] = (i * 7 + j) & 255;
    samples.push({ data, duration: i === n - 1 ? 512 : 1000, key: i % 30 === 0 });
  }
  const bytes = muxMp4({
    width: 1920, height: 1080, timescale: 30000, avcC, samples,
    colorSpace: { primaries: "bt709", transfer: "bt709", matrix: "bt709", fullRange: false },
  });
  const top = parseBoxes(bytes);
  eq("top-level order", top.map((b) => b.type), ["ftyp", "moov", "mdat"]);
  eq("box sizes add up", top.reduce((a, b) => a + b.size, 0), bytes.length);
  eq("ftyp major", findBox(top, "ftyp").major, "isom");
  const dur = 94 * 1000 + 512;
  eq("mdhd", [findBox(top, "mdhd").timescale, findBox(top, "mdhd").duration], [30000, dur]);
  eq("mvhd", [findBox(top, "mvhd").timescale, findBox(top, "mvhd").duration], [1000, Math.round((dur / 30000) * 1000)]);
  const tk = findBox(top, "tkhd");
  eq("tkhd", [tk.trackId, tk.width, tk.height], [1, 1920, 1080]);
  eq("hdlr", findBox(top, "hdlr").handler, "vide");
  const sd = findBox(top, "stsd");
  eq("stsd", [sd.format, sd.width, sd.height], ["avc1", 1920, 1080]);
  eq("stsd children", sd.entry.map((b) => b.type), ["avcC", "colr", "pasp"]);
  const ac = sd.entry[0];
  eq("avcC bytes", [...bytes.subarray(ac.start + 8, ac.start + ac.size)], [...avcC]);
  eq("stts", findBox(top, "stts").entries, [[94, 1000], [1, 512]]);
  eq("stss", findBox(top, "stss").keys, [1, 31, 61, 91]);
  eq("stsc", findBox(top, "stsc").entries, [[1, n, 1]]);
  const sz = findBox(top, "stsz");
  eq("stsz", [sz.count, sz.sizes], [n, samples.map((s) => s.data.length)]);
  const mdat = findBox(top, "mdat");
  const off = findBox(top, "stco").offsets;
  eq("stco → mdat data", off, [mdat.dataStart]);
  // every sample's bytes sit where the tables say
  let p = off[0], bad = 0;
  samples.forEach((s, i) => {
    const got = bytes.subarray(p, p + sz.sizes[i]);
    if (got.length !== s.data.length || got.some((v, j) => v !== s.data[j])) bad++;
    p += sz.sizes[i];
  });
  eq("sample bytes", bad, 0);
  eq("mdat ends the file", p, bytes.length);
  // all-keyframe tracks drop stss
  const allKey = parseBoxes(muxMp4({ width: 16, height: 16, timescale: 30, avcC, samples: samples.slice(0, 3).map((s) => ({ ...s, key: true, duration: 1 })) }));
  eq("no stss when all keys", findBox(allKey, "stss"), null);
  let threw = false;
  try { muxMp4({ width: 16, height: 16, timescale: 30, avcC, samples: [{ data: new Uint8Array(4), duration: 1, key: false }] }); } catch { threw = true; }
  eq("first sample must be key", threw, true);
  const videoChecks = 21;

  // --- with an AAC track: two traks, an edit list for the priming, interleaved ~1 s chunks -------------------------
  const asc = Uint8Array.of(0x11, 0x90); // AAC-LC, 48 kHz, stereo
  const an = 120, skip = 2112, len = an * 1024 - skip - 700; // 120 frames ≈ 2.56 s, less priming and end padding
  const aud = [];
  for (let i = 0; i < an; i++) {
    const l = 6 + ((i * 53) % 500);
    const data = new Uint8Array(l);
    for (let j = 0; j < l; j++) data[j] = (i * 13 + j * 3 + 1) & 255;
    aud.push({ data, duration: 1024 });
  }
  const av = muxMp4({ width: 1920, height: 1080, timescale: 30000, avcC, samples, audio: { sampleRate: 48000, channels: 2, asc, samples: aud, skip, duration: len } });
  const at = parseBoxes(av);
  let checks = 0;
  const chk = (name, a, b) => { checks++; eq(name, a, b); };
  chk("a/v top-level order", at.map((b) => b.type), ["ftyp", "moov", "mdat"]);
  chk("a/v box sizes add up", at.reduce((a, b) => a + b.size, 0), av.length);
  const trs = tracksOf(at);
  chk("a/v handlers", trs.map((t) => t.handler), ["vide", "soun"]);
  const [vt, st] = trs.map((t) => t.boxes);
  chk("mvhd next_track_ID + duration", [findBox(at, "mvhd").nextTrackId, findBox(at, "mvhd").duration], [3, Math.round((dur / 30000) * 1000)]);
  chk("audio tkhd", [findBox(st, "tkhd").trackId, findBox(st, "tkhd").duration], [2, Math.round((len / 48000) * 1000)]);
  chk("audio mdhd", [findBox(st, "mdhd").timescale, findBox(st, "mdhd").duration], [48000, an * 1024]);
  chk("audio elst", findBox(st, "elst").entries, [[Math.round((len / 48000) * 1000), skip, 1]]);
  chk("video has no elst", findBox(vt, "elst"), null);
  chk("smhd", findBox(st, "smhd")?.balance, 0);
  const asd = findBox(st, "stsd");
  chk("mp4a entry", [asd.format, asd.channels, asd.sampleSize, asd.sampleRate], ["mp4a", 2, 16, 48000]);
  const es = findBox(st, "esds");
  chk("esds", [es.objectType, es.streamType, es.asc], [0x40, 5, [...asc]]);
  chk("audio stts", findBox(st, "stts").entries, [[an, 1024]]);
  const sg = findBox(st, "sgpd"), sbg = findBox(st, "sbgp");
  chk("audio roll group", [sg?.grouping, sg?.entries, sg?.roll, sbg?.grouping, sbg?.runs], ["roll", 1, -1, "roll", [[an, 1]]]);
  chk("video has no roll group", findBox(vt, "sgpd"), null);
  chk("audio has no stss", findBox(st, "stss"), null);
  const asz = findBox(st, "stsz");
  chk("audio stsz", asz.sizes, aud.map((s) => s.data.length));
  // walk both tracks' chunk tables and compare every sample's bytes; the chunks must tile mdat with no gaps
  const mdat2 = findBox(at, "mdat");
  const spans = [];
  let badAV = 0;
  for (const [boxes, src] of [[vt, samples], [st, aud]]) {
    const sc = findBox(boxes, "stsc").entries, offs = findBox(boxes, "stco").offsets, sizes = findBox(boxes, "stsz").sizes;
    let si = 0;
    offs.forEach((off, ci) => {
      const e = sc.filter((x) => x[0] <= ci + 1).pop();
      let q = off;
      for (let k = 0; k < e[1]; k++, si++) {
        const got = av.subarray(q, q + sizes[si]);
        if (got.length !== src[si].data.length || got.some((v, j) => v !== src[si].data[j])) badAV++;
        q += sizes[si];
      }
      spans.push([off, q]);
    });
    chk(`all samples in chunks (${boxes === vt ? "video" : "audio"})`, si, src.length);
  }
  chk("a/v sample bytes", badAV, 0);
  spans.sort((x, y) => x[0] - y[0]);
  chk("chunks tile mdat", spans.every((s, i) => s[0] === (i ? spans[i - 1][1] : mdat2.dataStart)) && spans[spans.length - 1][1] === av.length, true);
  chk("interleaved (≥ 3 video and 3 audio chunks)", [findBox(vt, "stco").offsets.length >= 3, findBox(st, "stco").offsets.length >= 3], [true, true]);
  chk("first chunk is video", spans[0][0] === findBox(vt, "stco").offsets[0], true);
  return { ok: fails.length === 0, fails, checks: videoChecks + checks };
}
