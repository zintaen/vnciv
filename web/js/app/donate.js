// "Buy the author a coffee": a top-bar button and a small dialog with the author's MoMo / VietQR code.
// The site is free and ad-free; this is the only ask, shown once in the bar and never as a pop-up.
import { t } from "../i18n.js";

export function initDonate() {
  const bar = document.querySelector("#topbar .tb-buttons");
  if (!bar || document.getElementById("btn-coffee")) return;
  const btn = document.createElement("button");
  btn.id = "btn-coffee";
  btn.type = "button";
  btn.className = "btn coffee-btn";
  btn.setAttribute("aria-haspopup", "dialog");
  btn.title = t("Buy the author a coffee");
  btn.innerHTML = `<span class="cup" aria-hidden="true">☕</span><span class="lbl">${t("Coffee")}</span>`;
  bar.insertBefore(btn, bar.firstChild);

  const modal = document.createElement("div");
  modal.className = "modal coffee-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="coffee-card panel" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="coffee-title">
      <button class="icon-btn coffee-close" type="button" aria-label="${t("Close")}">✕</button>
      <div class="coffee-steam" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="coffee-mug" aria-hidden="true">☕</div>
      <h2 id="coffee-title">${t("Buy the author a coffee")}</h2>
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
    if (e.key === "Tab") { e.preventDefault(); modal.querySelector(".coffee-close").focus(); }
  });
  return { open, close, get isOpen() { return !modal.hidden; } };
}
