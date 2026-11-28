// "☕ Author": a top-bar button and a small dialog: who made the atlas (CyberSkill, with a link) and the author's
// MoMo / VietQR code. The site is free and ad-free; this is the only ask, shown once in the bar and never as a pop-up.
import { t, lang } from "../i18n.js";
import { cyberskillUrl, REPO_URL, GITHUB_SVG } from "./brand.js";

export function initDonate() {
  const bar = document.querySelector("#topbar .tb-more");
  if (!bar || document.getElementById("btn-coffee")) return;
  const btn = document.createElement("button");
  btn.id = "btn-coffee";
  btn.type = "button";
  btn.className = "btn coffee-btn";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.title = t("About the author, and a coffee");
  btn.innerHTML = `<span class="cup" aria-hidden="true">☕</span><span class="lbl">${t("Author")}</span>`;
  bar.insertBefore(btn, bar.firstChild);

  const modal = document.createElement("div");
  modal.className = "modal coffee-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="coffee-card panel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="coffee-title">
      <button class="icon-btn coffee-close" type="button" aria-label="${t("Close")}">✕</button>
      <h2 id="coffee-title">${t("Author")}</h2>
      <div class="coffee-maker">
        <img src="img/brand/cyberskill-logo-primary.svg" width="52" height="52" alt="CyberSkill">
        <p>${t("This atlas is made by CyberSkill, a software studio in Ho Chi Minh City that builds web apps, mobile apps and internal systems.")}</p>
      </div>
      <a class="coffee-cta" href="${cyberskillUrl("author", lang === "vi" ? "vi" : "en")}" target="_blank" rel="noopener">${t("Start a project")} <span aria-hidden="true">↗</span></a>
      <a class="coffee-gh" href="${REPO_URL}" target="_blank" rel="noopener">${GITHUB_SVG} ${t("Source on GitHub")}</a>
      <hr class="coffee-sep">
      <div class="coffee-steam" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="coffee-mug" aria-hidden="true">☕</div>
      <h3 class="coffee-sub">${t("Buy the author a coffee")}</h3>
      <p class="coffee-lead">${t("This map is free, ad-free and open source, made with love for Vietnam. If you enjoyed it, a cup of coffee keeps the next update coming.")}</p>
      <img class="coffee-qr" data-src="assets/donate-momo.png" width="300" height="575" alt="${t("MoMo / VietQR code to send a coffee to the author")}">
      <p class="coffee-how">${t("Scan with MoMo or any banking app (VietQR · Napas 247).")}</p>
      <p class="coffee-thanks">${t("Thank you so much!")} <span aria-hidden="true">💛🇻🇳</span></p>
    </div>`;
  document.body.appendChild(modal);
  const close = () => { modal.hidden = true; btn.setAttribute("aria-expanded", "false"); btn.focus(); };
  const open = () => {
    const qr = modal.querySelector(".coffee-qr");
    if (!qr.src) qr.src = qr.dataset.src; // fetched on first open only
    modal.hidden = false;
    btn.setAttribute("aria-expanded", "true");
    modal.querySelector(".coffee-close").focus();
  };
  btn.onclick = () => (modal.hidden ? open() : close());
  modal.addEventListener("click", (e) => { if (e.target === modal || e.target.closest(".coffee-close")) close(); });
  modal.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if (e.key !== "Tab") return; // keep Tab inside the dialog: the close button and the link
    const f = [...modal.querySelectorAll(".coffee-close, .coffee-cta, .coffee-gh")];
    const k = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  });
  return { open, close, get isOpen() { return !modal.hidden; } };
}
