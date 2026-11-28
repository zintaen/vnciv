// Chart entrances for the advisors and the City View: bars grow, lines draw on, rank lists slide in staggered.
// A chart animates once, the first time it scrolls into view; a chart re-drawn into the same host (a filter, a year
// step, a sort) shows at once, so dragging a control never replays it. With motion off (Effects, reduced motion,
// hidden tab) nothing is marked, and turning it off mid-way jumps every chart to its end state. Pure CSS animations
// on transform / clip-path / opacity; the bars keep their real widths throughout.
const SEL = ".adv-bars, .adv-stack, .adv-share-bar, .adv-donut, .adv-hist, .cv-spark, .cv-meter, .cv-bar, .cv-figs, .cv-cz-us";
const STAGGER = ".adv-bars, .adv-stack, .adv-hist svg, .cv-figs"; // children get --i (their order)
const DONE_MS = 2200; // longest animation incl. stagger; the classes are removed after it

const CSS = `
@keyframes fx-grow-x { from { transform: scaleX(0); } }
@keyframes fx-grow-y { from { transform: scaleY(0); } }
@keyframes fx-slide { from { opacity: 0; transform: translateX(-14px); } }
@keyframes fx-fade { from { opacity: 0; } }
@keyframes fx-pop { from { opacity: 0; transform: scale(.4); } }
@keyframes fx-wipe { from { clip-path: inset(0 100% 0 0); } }
@keyframes fx-spin { from { opacity: 0; transform: rotate(-100deg) scale(.7); } }
.fx-wait, .fx-wait * { animation-play-state: paused !important; }
.fx.adv-bars > .adv-bar { animation: fx-slide .42s cubic-bezier(.2,.7,.2,1) backwards; animation-delay: calc(min(var(--i, 0), 24) * 32ms); }
.fx.adv-bars .tr > i { transform-origin: left center; animation: fx-grow-x .7s cubic-bezier(.2,.7,.2,1) backwards; animation-delay: calc(min(var(--i, 0), 24) * 32ms + 80ms); }
.fx.adv-bars .tr > i.neg { transform-origin: right center; }
.fx.adv-stack > .adv-srow { animation: fx-slide .42s cubic-bezier(.2,.7,.2,1) backwards; animation-delay: calc(min(var(--i, 0), 24) * 32ms); }
.fx.adv-stack .st { animation: fx-wipe .7s cubic-bezier(.3,.6,.2,1) backwards; animation-delay: calc(min(var(--i, 0), 24) * 32ms + 80ms); }
.fx.adv-share-bar { animation: fx-wipe .8s cubic-bezier(.3,.6,.2,1) backwards; }
.fx.adv-donut svg { animation: fx-spin .75s cubic-bezier(.2,.7,.2,1) backwards; }
.fx.adv-hist rect.bar { transform-box: fill-box; transform-origin: center bottom; animation: fx-grow-y .6s cubic-bezier(.2,.7,.2,1) backwards; animation-delay: calc(min(var(--i, 0), 60) * 12ms); }
.fx.cv-spark { animation: fx-wipe 1.1s cubic-bezier(.4,.1,.3,1) backwards; }
.fx.cv-meter > i, .fx.cv-bar > i { transform-origin: left center; animation: fx-grow-x .7s cubic-bezier(.2,.7,.2,1) backwards; }
.fx.cv-figs > * { animation: fx-pop .35s cubic-bezier(.2,.8,.3,1.2) backwards; animation-delay: calc(min(var(--i, 0), 100) * 7ms); }
.fx.cv-cz-us > div { animation: fx-wipe .8s cubic-bezier(.3,.6,.2,1) backwards; animation-delay: .3s; }
@media (prefers-reduced-motion: reduce) { .fx, .fx * { animation: none !important; } }
`;

export function installChartMotion(M) {
  if (typeof MutationObserver !== "function") return;
  const style = document.createElement("style");
  style.id = "motion-charts";
  style.textContent = CSS;
  document.head.appendChild(style);

  const seen = new WeakMap(); // host → the mutation batch that first showed a chart in it
  let batch = 0;
  const io = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      e.target.classList.remove("fx-wait");
      setTimeout(() => clear(e.target), DONE_MS);
    }
  }, { threshold: 0.1 }) : null;

  function clear(el) {
    el.classList.remove("fx", "fx-wait");
    io?.unobserve(el);
  }

  function mark(el) {
    const host = el.parentElement;
    if (!host) return;
    if (!seen.has(host)) seen.set(host, batch);
    if (seen.get(host) !== batch || el.closest(".fx")) return; // re-drawn into a host that already showed one
    if (!M.enabled) return;
    const list = el.matches(STAGGER) ? el : el.querySelector(STAGGER);
    if (list) for (let k = 0; k < list.children.length; k++) list.children[k].style.setProperty("--i", k);
    el.classList.add("fx");
    if (io) { el.classList.add("fx-wait"); io.observe(el); } else setTimeout(() => clear(el), DONE_MS);
  }

  new MutationObserver((recs) => {
    batch++;
    for (const r of recs) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.matches(SEL)) mark(n);
        if (n.firstElementChild) for (const c of n.querySelectorAll(SEL)) mark(c);
      }
      // A chart removed before it scrolled into view: stop observing it (the observer would keep the old panel alive).
      if (io) for (const n of r.removedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.classList.contains("fx-wait")) clear(n);
        if (n.firstElementChild) for (const c of n.querySelectorAll(".fx-wait")) clear(c);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });

  M.on("change", (on) => { if (!on) for (const el of document.querySelectorAll(".fx")) clear(el); });
}
