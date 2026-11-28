// Top-bar search over cities, provinces and the places and communes extensions add: prefix matches first, then word-prefix, then substring; ties by population.
import { esc, kindOf, popShort, viOrder } from "../format.js";
import { icon } from "../ui/icon.js";
import { t } from "../i18n.js";

/** "Hà Nội" → "ha noi": no diacritics, đ → d, words split on anything else (also matches URL names). */
export const norm = (s) => String(s || "").replace(/[đĐ]/g, "d").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The query as typed (lower case, diacritics kept): "Đà" should rank Đà Nẵng above Đắk Lắk. The tone mark of a final
// "oa", "oe" or "uy" sits on either vowel ("Hoà"/"Hòa", "Thuỷ"/"Thủy", "Quy" aside): both spellings put it on the first.
const TONE_LATE = /(^|[^q])(o)([ae])([\u0300\u0301\u0303\u0309\u0323])(?![\p{L}\p{M}])|(^|[^q])(u)(y)([\u0300\u0301\u0303\u0309\u0323])(?![\p{L}\p{M}])/gu;
export const exact = (s) => String(s || "").normalize("NFD").toLowerCase()
  .replace(TONE_LATE, (m, p1, o, a, t1, p2, u, y, t2) => (o ? p1 + o + t1 + a : p2 + u + t2 + y)).normalize("NFC").trim();
const MAX = 8;

/**
 * opts: {cities, states (list of {name, abbr, population?}), onPick({kind:'city'|'state', city?, index?}),
 *        onPicked(entry, marks)? (an extension's entry was picked), marks()? (main's marker counter)}
 */
export function initSearch(opts) {
  const input = document.getElementById("search-input");
  const box = document.getElementById("search-results");
  if (!input || !box) return { focus() {}, close() {}, get isOpen() { return false; } };
  // The full placeholder only fits the wide search box; narrower ones say just "Search".
  const narrow = matchMedia("(max-width: 1120px)");
  const setPlaceholder = () => (input.placeholder = t(narrow.matches ? "Search" : "Search places, communes, provinces"));
  setPlaceholder();
  narrow.addEventListener?.("change", setPlaceholder);

  const entries = [];
  for (const c of opts.cities || []) {
    entries.push({ kind: "city", city: c, name: c.name, n: norm(c.name), x: exact(c.name), full: norm(c.full), pop: c.population || 0,
      sub: String(c.full || "").replace("(former province)", t("(former province)")), label: c.name });
  }
  (opts.states || []).forEach((s, index) => {
    if (!s) return;
    entries.push({ kind: "state", index, name: s.name, n: norm(s.name), x: exact(s.name), full: norm(s.abbr), abbr: (s.abbr || "").toLowerCase(),
      pop: s.population || 0, sub: s.former && s.former.length > 1 ? `${kindOf(s)} · ${s.former.join(" + ")}` : kindOf(s), label: s.name });
  });

  // Extra entries from extensions: app.search.addEntries([{name, label?, sub, kind, icon?, emoji?, pop?, pick(), at?, line?, box?}])
  // → remove(). After pick() the place is marked on the map: at {x, y} (or [x, y]) a point, line [[x, y], …] a river,
  // box [x0, y0, x1, y1] its middle; without any, where pick() flies the camera. docs/DATA_CONTRACTS.md "Search".
  function addEntries(list) {
    const added = (list || []).filter((e) => e && e.name && typeof e.pick === "function").map((e) => ({
      ...e, n: norm(e.name), x: exact(e.name), full: norm(e.sub), pop: e.pop || 0, label: e.label || e.name, sub: e.sub || "" }));
    entries.push(...added);
    return () => added.forEach((e) => { const k = entries.indexOf(e); if (k >= 0) entries.splice(k, 1); });
  }

  let results = [];
  let sel = -1;

  function score(e, q) {
    if (e.abbr && e.abbr === q) return 0;
    if (e.n.startsWith(q)) return e.n === q ? 0 : 1;
    if ((" " + e.n).includes(" " + q)) return 2;
    if ((" " + e.full).includes(" " + q)) return 3;
    if (e.n.includes(q)) return 4;
    if (e.full.includes(q)) return 5;
    // English spellings run the words together: "Hanoi", "Danang" for Hà Nội, Đà Nẵng
    if (!q.includes(" ") && (e.j ??= e.n.replace(/ /g, "")).startsWith(q)) return 6;
    return -1;
  }

  function query(raw) {
    const q = norm(raw), qx = exact(raw);
    if (!q) return [];
    const marked = qx !== q; // typed with diacritics (or capitals/punctuation): prefer names spelled that way
    const out = [];
    for (const e of entries) {
      const s = score(e, q);
      const miss = marked && !(e.x.startsWith(qx) || e.x.includes(" " + qx)) ? 1 : 0;
      if (s >= 0) out.push([s, miss, e]);
    }
    out.sort((a, b) => a[1] - b[1] || a[0] - b[0] || b[2].pop - a[2].pop || viOrder(a[2].name, b[2].name));
    return out.slice(0, MAX).map((x) => x[2]);
  }

  function position() {
    const r = input.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
    box.style.top = r.bottom + 6 + "px";
    box.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, r.left)) + "px";
    box.style.width = width + "px";
  }

  function render() {
    if (!results.length) {
      box.innerHTML = input.value.trim() ? `<div class="sr-empty">${t("No place, commune, city or province matches “{q}”", { q: esc(input.value.trim()) })}</div>` : "";
      box.hidden = !input.value.trim();
      input.setAttribute("aria-expanded", String(!box.hidden));
      input.removeAttribute("aria-activedescendant");
      if (!box.hidden) position();
      return;
    }
    box.innerHTML = results
      .map((e, i) => `<div class="sr-item ${i === sel ? "sel" : ""}" role="option" id="sr-${i}" aria-selected="${i === sel}" data-i="${i}">
        <span class="sr-ic">${e.icon ? icon(e.icon, e.emoji || "", { size: 16 }) : e.kind === "state" ? icon("terrain", "🗺️", { size: 16 }) : icon("pop", "🏙️", { size: 16 })}</span>
        <span class="sr-main"><b>${esc(e.label)}</b><span class="sr-sub">${esc(e.sub)}</span></span>
        <span class="sr-pop">${e.pop ? popShort(e.pop) : ""}</span></div>`)
      .join("");
    box.hidden = false;
    input.setAttribute("aria-expanded", "true");
    if (sel >= 0) input.setAttribute("aria-activedescendant", `sr-${sel}`);
    else input.removeAttribute("aria-activedescendant");
    position();
  }

  function choose(i) {
    const e = results[i];
    if (!e) return;
    close();
    input.value = "";
    input.blur();
    if (e.pick) {
      const marks = opts.marks?.();
      e.pick();
      opts.onPicked?.(e, marks); // main marks the place on the map (entry.at / entry.line / entry.box, see addEntries)
      document.getElementById("map")?.focus?.({ preventScroll: true });
      return;
    }
    opts.onPick(e.kind === "city" ? { kind: "city", city: e.city } : { kind: "state", index: e.index });
  }

  function close() {
    box.hidden = true;
    results = [];
    sel = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  input.addEventListener("input", () => {
    results = query(input.value);
    sel = results.length ? 0 : -1;
    render();
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) {
      results = query(input.value);
      sel = results.length ? 0 : -1;
      render();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!results.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length;
      render();
      box.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results.length) choose(Math.max(0, sel));
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!box.hidden && input.value) { input.value = ""; close(); }
      else { close(); input.blur(); }
    }
  });
  input.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement !== input) close();
  }, 150));
  box.addEventListener("pointerdown", (e) => e.preventDefault()); // keep focus in the input
  box.addEventListener("click", (e) => {
    const it = e.target.closest(".sr-item");
    if (it) choose(+it.dataset.i);
  });
  box.addEventListener("pointermove", (e) => {
    const it = e.target.closest(".sr-item");
    if (it && +it.dataset.i !== sel) {
      sel = +it.dataset.i;
      box.querySelectorAll(".sr-item").forEach((x, i) => {
        x.classList.toggle("sel", i === sel);
        x.setAttribute("aria-selected", String(i === sel));
      });
    }
  });
  window.addEventListener("resize", () => !box.hidden && position());

  return {
    focus() {
      input.focus();
      input.select();
    },
    close() {
      close();
      input.blur();
    },
    query,
    addEntries,
    get isOpen() { return document.activeElement === input || !box.hidden; },
  };
}
