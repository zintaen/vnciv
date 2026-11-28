// node web/js/app/embed.test.mjs: the embed code builder (app/embed.js) and the static oEmbed file that copies it.
import assert from "node:assert/strict";
import fs from "node:fs";
const { embedSnippet, embedUrls, siteBase, SITE, EMBED } = await import("./embed.js");

assert.equal(EMBED, false); // no location in node: not embed mode, nothing patched
const hash = "#lens=pop_density&city=1&at=10,20,1.5";
const s = embedSnippet({ base: SITE, hash, lang: "vi", preset: "4:3", title: 'Bản đồ "Việt Nam"', credit: "Bản đồ: atlasvn.online · CyberSkill" });
const [iframe, p] = s.split("\n");
assert.ok(iframe.startsWith('<iframe src="https://atlasvn.online/?embed=1#lens=pop_density&amp;city=1&amp;at=10,20,1.5"'), iframe);
assert.match(iframe, /title="Bản đồ &quot;Việt Nam&quot;"/);
assert.match(iframe, / width="640" height="480" /);
assert.match(iframe, /aspect-ratio:640\/480/);
assert.match(iframe, / loading="lazy"/);
assert.ok(iframe.endsWith("></iframe>"));
assert.equal(p, '<p><a href="https://atlasvn.online/#lens=pop_density&amp;city=1&amp;at=10,20,1.5">Bản đồ: atlasvn.online · CyberSkill</a></p>');
// English and the search box go in the query; the hash stays last; an empty hash adds nothing.
assert.deepEqual(embedUrls({ base: SITE, hash: "#lens=x", lang: "en", search: true }),
  { src: "https://atlasvn.online/?embed=1&search=1&lang=en#lens=x", link: "https://atlasvn.online/?lang=en#lens=x" });
assert.deepEqual(embedUrls({ base: SITE, hash: "#" }), { src: "https://atlasvn.online/?embed=1", link: "https://atlasvn.online/" });
assert.match(embedSnippet({ preset: "1:1" }), / width="560" height="560" /);
assert.match(embedSnippet({ preset: "nope" }), / width="640" height="360" /);
// Links point at the published site, except from a local server.
assert.equal(siteBase({ protocol: "https:", hostname: "zintaen.github.io", origin: "https://zintaen.github.io", pathname: "/vnciv/" }), SITE);
assert.equal(siteBase({ protocol: "http:", hostname: "127.0.0.1", origin: "http://127.0.0.1:8960", pathname: "/index.html" }), "http://127.0.0.1:8960/");
// web/oembed.json (linked from index.html) carries the home view's code exactly as the builder writes it.
const o = JSON.parse(fs.readFileSync(new URL("../../oembed.json", import.meta.url), "utf8"));
assert.equal(o.version, "1.0");
assert.equal(o.type, "rich");
assert.equal(o.html, embedSnippet({ base: SITE, preset: "16:9", title: o.title }).split("\n")[0]);
assert.deepEqual([o.width, o.height], [640, 360]);
console.log("embed ok");
