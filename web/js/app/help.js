// Keyboard & mouse cheat-sheet.
import { icon } from "../ui/icon.js";
import { t } from "../i18n.js";
import { REPO_URL, GITHUB_SVG } from "./brand.js";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const MOD = isMac ? "⌘" : "Ctrl";

const ROWS = [
  ["Move", [
    [["Drag", "←↑→↓", "WASD"], "Pan the map"],
    [["Scroll", "+", "–"], "Zoom in and out"],
    [["Double-click"], "Zoom in on a spot"],
    [["Two fingers"], "Pinch to zoom, drag to pan (touch)"],
    [["Minimap"], "Click or drag to jump"],
  ]],
  ["Explore", [
    [["Click city"], "Open the city screen"],
    [["Click land"], "Open that province"],
    [["/", `${MOD} K`], "Search places, communes and provinces"],
    [["L", "Shift L"], "Next / previous lens"],
    [["[", "]"], "Previous / next year on the timeline"],
    [["Map"], "Colour the map by a theme, turn on roads, rail, communes and other layers"],
    [["Legend"], "Hover or drag the scale to show only that range"],
    [["R"], "Show or hide power plants"],
  ]],
  ["Panels", [
    [["?"], "This help"],
    [["Esc"], "Close help, search, Almanac, then the panel"],
  ]],
];

export function initHelp() {
  const modal = document.getElementById("help");
  if (!modal) return { open() {}, close() {}, get isOpen() { return false; } };
  const card = modal.querySelector(".help-card");
  let restore = null;
  card.innerHTML = `
    <button class="icon-btn help-close" data-close aria-label="${t("Close help")}">${icon("close", "✕", { size: 13 })}</button>
    <h2 id="help-title">${icon("help", "?", { size: 22 })}<span>${t("Controls")}</span></h2>
    <div class="help-cols">${ROWS.map(([title, rows]) => `
      <section><h3>${t(title)}</h3>${rows.map(([keys, what]) => `
        <div class="help-row"><span class="keys">${keys.map((k) => `<kbd>${t(k)}</kbd>`).join("")}</span><span>${t(what)}</span></div>`).join("")}
      </section>`).join("")}</div>
    <p class="help-foot">${t("Every number traces back to public data: open the <b>Almanac</b> for sources. The link in the address bar always reopens this exact view.")}
      ${t("Source code: {github} (MIT; run it with uv, see its README). The map engine is {usaciv} by Andrej Karpathy (MIT), fed with Vietnam's data.", {
        github: `<a class="help-gh" href="${REPO_URL}" target="_blank" rel="noopener">${GITHUB_SVG}${t("Source on GitHub")}</a>`,
        usaciv: `<a href="https://karpathy.ai/usaciv/" target="_blank" rel="noopener">usaciv</a>` })}</p>`;

  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    if (restore && document.contains(restore)) restore.focus();
    restore = null;
  };
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest("[data-close]")) close();
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return; // keep Tab inside the dialog, cycling first <-> last (as ui/pedia.js)
    const f = [...card.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!f.includes(document.activeElement)) { e.preventDefault(); (e.shiftKey ? last : first).focus(); } // focus outside, or on the card itself (a click on its text)
  });

  return {
    open() {
      if (!modal.hidden) return;
      restore = document.activeElement;
      modal.hidden = false;
      card.querySelector("[data-close]").focus();
    },
    close,
    toggle() { modal.hidden ? this.open() : close(); },
    get isOpen() { return !modal.hidden; },
  };
}
