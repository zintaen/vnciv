// Embed mode's own UI (app/embed.js holds the flag and the iframe code):
//  * initEmbed(app): the strip across the top (the theme and year with its colour ramp, an optional search box,
//    "Open on atlasvn.online ↗"), the CyberSkill badge in the bottom-right corner, and "click to interact": until the
//    map is clicked, tapped or focused, the mouse wheel scrolls the host page (a hint says so) and a touch swipe
//    scrolls it too (embed.css); leaving the frame (or clicking the host page) hands the wheel back.
//  * openEmbedDialog(): the Share menu's "Embed" dialog on the full site: size presets, the code, Copy, a live preview.
import { t, lang } from "../i18n.js";
import { esc } from "../format.js";
import { cyberskillUrl } from "./brand.js";
import { copyText } from "./share.js";
import { formatLensValue, lensValueAt, naturalEnd } from "../ui/lenses.js";
import { fmtYear, yearNum } from "../ui/infoPanel.js";
import { EMBED_SEARCH, embedSnippet, embedUrls, siteBase } from "./embed.js";

const SITE_NAME = "atlasvn.online";
const MARK = "img/brand/cyberskill-logo-mark-gold.svg";

/** The strip's key to the map: the theme (or terrain), its year, and its ramp or categories. */
function legendHtml(app) {
  const lens = app.shownLens();
  const year = lens?.year ?? app.timeline?.year ?? null;
  const name = lens ? t(lens.name) : t("Terrain");
  const yr = year != null && year !== "" && !(lens && name.includes(yearNum(year))) ? ` · ${fmtYear(year)}` : "";
  let key = "";
  const cats = lens?.format === "category" && Array.isArray(lens.categories) ? lens.categories : null;
  if (cats?.length) {
    key = `<span class="emb-cats">${cats.map((c, i) => `<span class="emb-cat" title="${esc(t(c.name))}"><i style="background:${esc(c.color || lens.ramp?.[i] || "#888888")}"></i>${esc(t(c.name))}</span>`).join("")}</span>`;
  } else if (lens?.ramp?.length) {
    const lo = (naturalEnd(lens, 0) || lens.domain?.[0] === 0 ? "" : "≤ ") + formatLensValue(lens, lensValueAt(lens, 0));
    const hi = (naturalEnd(lens, 1) ? "" : "≥ ") + formatLensValue(lens, lensValueAt(lens, 1));
    key = `<span class="emb-lo">${esc(lo)}</span><span class="emb-ramp" style="background:linear-gradient(90deg,${lens.ramp.map(esc).join(",")})"></span><span class="emb-hi">${esc(hi)}</span>`;
  }
  return `<b class="emb-name">${esc(name + yr)}</b>${key}`;
}

export function initEmbed(app) {
  const root = document.documentElement;
  const bar = document.getElementById("topbar");
  const canvas = document.getElementById("map");

  // --- the strip ---
  const legend = document.createElement("div");
  legend.className = "embed-legend";
  legend.setAttribute("role", "group");
  legend.setAttribute("aria-label", t("Lens legend"));
  const open = document.createElement("a");
  open.className = "embed-open";
  open.target = "_blank";
  open.rel = "noopener";
  open.innerHTML = `${esc(t("Open on {site}", { site: SITE_NAME }))} <span aria-hidden="true">↗</span>`;
  // The same view on the full site: the hash is written first (a pan settles 350 ms later), then copied.
  const syncOpen = () => {
    app.hash.flush();
    open.href = embedUrls({ base: siteBase(), hash: location.hash, lang }).link;
  };
  for (const ev of ["pointerdown", "focus", "mouseenter", "click", "contextmenu"]) open.addEventListener(ev, syncOpen);
  syncOpen();
  bar?.append(legend, open);
  if (!EMBED_SEARCH) document.getElementById("search-input")?.setAttribute("tabindex", "-1");
  const render = () => { legend.innerHTML = legendHtml(app); };
  app.on("lens", render);
  app.on("year", render);
  render();
  setTimeout(render, 0); // after the link's lens and year have been applied

  // --- the maker badge ---
  const badge = document.createElement("a");
  badge.className = "embed-badge";
  badge.href = cyberskillUrl("embed");
  badge.target = "_blank";
  badge.rel = "noopener";
  badge.innerHTML = `<img src="${MARK}" width="16" height="16" alt="">${esc(t("{site} · by CyberSkill", { site: SITE_NAME }))}`;
  document.body.appendChild(badge);

  // --- click to interact ---
  const hint = document.createElement("div");
  hint.className = "embed-hint";
  hint.hidden = true;
  hint.textContent = t("Click to interact");
  document.body.appendChild(hint);
  let hintTimer = 0;
  const setActive = (on) => {
    root.classList.toggle("embed-active", on);
    if (on) hint.hidden = true;
  };
  // Before activation a wheel over the map is not the map's (main.js's handler would zoom and preventDefault): it
  // stops here, so the host page scrolls.
  window.addEventListener("wheel", (e) => {
    if (root.classList.contains("embed-active") || e.target !== canvas) return;
    e.stopImmediatePropagation();
    hint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (hint.hidden = true), 1600);
  }, { capture: true, passive: true });
  // A click or tap (a touch swipe that scrolled the page ends in pointercancel instead), or keyboard focus.
  window.addEventListener("pointerup", (e) => { if (e.target === canvas) setActive(true); }, true);
  canvas.tabIndex = 0; // reachable with Tab: arrows / WASD pan and +/- zoom once the map has focus
  canvas.addEventListener("focus", () => setActive(true));
  window.addEventListener("blur", () => setActive(false));
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget) setActive(false); });
}

/** The Share menu's "Embed" dialog (lens: the theme shown, for the iframe's title). Closes on Esc, ✕ or a click outside; focus goes back to `restore`. */
export function openEmbedDialog({ lens = null, restore = document.activeElement } = {}) {
  const title = lens ? `${t("Map of Vietnam")}: ${t(lens.name)} · ${SITE_NAME}` : `${t("Map of Vietnam")} · ${SITE_NAME}`;
  const credit = t("Map: {site} · CyberSkill", { site: SITE_NAME });
  const presets = [["16:9", t("Wide 16:9")], ["4:3", "4:3"], ["1:1", t("Square")]];
  const modal = document.createElement("div");
  modal.className = "modal embed-modal";
  modal.innerHTML = `<div class="embed-card panel" role="dialog" aria-modal="true" aria-labelledby="ed-title" tabindex="-1">
      <button type="button" class="close icon-btn" aria-label="${esc(t("Close"))}">✕</button>
      <h2 id="ed-title">${esc(t("Embed this map"))}</h2>
      <p class="muted">${esc(t("Paste this code into an article or blog post. It shows the current view; readers can pan, zoom and click."))}</p>
      <div class="ed-opts">
        <fieldset class="ed-sizes"><legend>${esc(t("Frame size"))}</legend>
          ${presets.map(([id, label], i) => `<label><input type="radio" name="ed-size" value="${id}"${i ? "" : " checked"}> ${esc(label)}</label>`).join("")}
        </fieldset>
        <label class="ed-search"><input type="checkbox"> ${esc(t("Search box"))}</label>
      </div>
      <textarea class="ed-code" readonly rows="5" spellcheck="false" aria-label="${esc(t("Embed code"))}"></textarea>
      <div class="ed-row"><button type="button" class="btn ed-copy">${esc(t("Copy code"))}</button><span class="ed-status" role="status" aria-live="polite"></span></div>
      <div class="ed-label muted">${esc(t("Preview"))}</div>
      <div class="ed-preview"><iframe title="${esc(t("Preview"))}" loading="lazy"></iframe></div>
    </div>`;
  document.body.appendChild(modal);
  const card = modal.querySelector(".embed-card");
  const code = modal.querySelector(".ed-code");
  const frame = modal.querySelector("iframe");
  const status = modal.querySelector(".ed-status");
  const search = modal.querySelector(".ed-search input");
  const hash = location.hash;

  const update = () => {
    const preset = modal.querySelector("[name=ed-size]:checked").value;
    code.value = embedSnippet({ base: siteBase(), hash, lang, search: search.checked, preset, title, credit });
    // The preview is this server's own page (always same-origin, so the CSP's default-src 'self' lets it load).
    const src = embedUrls({ base: location.pathname, hash, lang, search: search.checked }).src;
    if (frame.getAttribute("src") !== src) frame.setAttribute("src", src);
    const [rw, rh] = preset.split(":").map(Number);
    frame.parentNode.style.aspectRatio = `${rw} / ${rh}`;
    frame.parentNode.style.maxWidth = `calc(50vh * ${rw / rh})`; // a square preview stays on screen
    status.textContent = "";
  };
  modal.addEventListener("change", update);
  update();

  const close = () => {
    modal.remove();
    if (restore && document.contains(restore)) restore.focus();
    else document.getElementById("map")?.focus({ preventScroll: true });
  };
  modal.addEventListener("click", async (e) => {
    if (e.target === modal || e.target.closest(".close")) return close();
    if (e.target.closest(".ed-copy")) {
      const ok = await copyText(code.value);
      status.textContent = ok ? t("Code copied") : t("Select the code and copy it (Ctrl C)");
      if (!ok) { code.focus(); code.select(); }
    }
  });
  modal.addEventListener("keydown", (e) => {
    e.stopPropagation(); // no map shortcuts behind the dialog
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = [...card.querySelectorAll("button, input, textarea, iframe")];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  code.addEventListener("focus", () => code.select());
  card.querySelector(".ed-copy").focus();
  return { close };
}
