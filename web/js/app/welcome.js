// First-visit welcome card: what the map is, three pointers, and two ways in ("▶ Watch the journey" starts the camera
// tour, "Explore on my own" closes the card). Shown once per browser (localStorage, any storage error = treat as seen
// so a locked-down browser is never nagged), never over a link that carries a view (main.js checks the hash) and
// never in automated runs (navigator.webdriver), so tests and the QA tours see the plain map.
import { esc } from "../format.js";
import { t } from "../i18n.js";
import { cyberskillUrl } from "./brand.js";

const KEY = "vnciv-welcome";

function seen() {
  try {
    if (localStorage.getItem(KEY)) return true;
    localStorage.setItem(KEY, "1");
    return false;
  } catch {
    return true;
  }
}

/** Shows the card when it should; returns {isOpen, close()} while it is up, else null. tour: () => start it, or null. */
export function maybeWelcome({ tour }) {
  if (navigator.webdriver || seen()) return null;
  const modal = document.createElement("div");
  modal.className = "modal welcome";
  modal.innerHTML = `<div class="welcome-card panel" role="dialog" aria-modal="true" aria-labelledby="wc-title" aria-describedby="wc-desc" tabindex="-1">
      <h2 id="wc-title"><svg class="brand-emblem" aria-hidden="true" viewBox="0 0 30 20" width="27" height="18"><rect width="30" height="20" fill="#DA251D"/><polygon fill="#FFFF00" points="15,4 16.35,8.15 20.71,8.15 17.18,10.71 18.53,14.85 15,12.29 11.47,14.85 12.82,10.71 9.29,8.15 13.65,8.15"/></svg>${esc(t("Welcome to the atlas of Vietnam"))}</h2>
      <p id="wc-desc">${esc(t("The real Vietnam, drawn like a strategy-game map: terrain, provinces, cities, rivers and dozens of data themes, all from public sources."))}</p>
      <ul class="wc-tips">
        <li><span aria-hidden="true">🔍</span>${esc(t("Search any province, commune, island or airport (press /)."))}</li>
        <li><span aria-hidden="true">🗺</span>${esc(t("The Map button colours the country by a theme and turns layers on."))}</li>
        <li><span aria-hidden="true">📅</span>${esc(t("The year bar steps the map through the years."))}</li>
      </ul>
      <div class="wc-actions">
        ${tour ? `<button type="button" class="btn wc-tour"><span aria-hidden="true">▶</span> ${esc(t("Watch the journey (2 min)"))}</button>` : ""}
        <button type="button" class="btn wc-explore">${esc(t("Explore on my own"))}</button>
      </div>
      <p class="wc-maker"><a href="${esc(cyberskillUrl("welcome"))}" target="_blank" rel="noopener"><img src="img/brand/cyberskill-logo-mark-gold.svg" width="16" height="16" alt="">${esc(t("A CyberSkill product"))}</a></p>
    </div>`;
  document.body.appendChild(modal);
  const card = modal.querySelector(".welcome-card");
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    modal.remove();
    document.getElementById("map")?.focus({ preventScroll: true });
  };
  modal.addEventListener("click", (e) => {
    if (e.target === modal || e.target.closest(".wc-explore")) close();
    else if (e.target.closest(".wc-tour")) { close(); tour(); }
  });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; } // (handled here: main's Esc chain sees defaultPrevented)
    if (e.key !== "Tab") return;
    const f = [...card.querySelectorAll("button, a[href]")];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!f.includes(document.activeElement)) { e.preventDefault(); first.focus(); }
  });
  (card.querySelector(".wc-tour") || card.querySelector(".wc-explore")).focus();
  return { get isOpen() { return open; }, close };
}
