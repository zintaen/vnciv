import { esc } from "../format.js";
import { icon, glyph } from "./icon.js";
import { statDefs, fmtStat, statusNote } from "./yieldReport.js";
import { t } from "../i18n.js";

// The national stats are buttons: each opens its report (ui/yieldReport.js, wired in main.js).
export function renderTopbar(nation) {
  const items = statDefs(nation).map((d) => {
    const ic = d.yield ? glyph(d.yield, 17) : icon(d.iconId, d.emoji, { size: 17 });
    const value = fmtStat(d, d.value);
    const name = d.name; // statDefs (ui/yieldReport.js) already returns translated names and descriptions
    const tip = `${name}: ${d.description}${d.key === "gold" ? ` ${statusNote("gold")}` : ""} ${t("Click for the report.")}`; // the national GDP is not the provinces' sum
    return `<button type="button" class="yield" data-report="${esc(d.key)}" aria-expanded="false" aria-haspopup="dialog" aria-controls="yield-report"
      title="${esc(tip)}" aria-label="${esc(t("{name}: {value}. Open the report", { name, value }))}">
      <span class="ico" style="color:${esc(d.color)}">${ic}</span><span style="color:${esc(d.color)}">${esc(value)}</span><span class="caret" aria-hidden="true"></span></button>`;
  });
  const el = document.getElementById("yields");
  el.innerHTML = items.join("");
  // When the bar is too narrow for every yield, the row scrolls on its own (search and buttons always fit);
  // a fade on the right edge shows there is more.
  const check = () => el.classList.toggle("clipped", el.scrollWidth > el.clientWidth + 1);
  if (typeof ResizeObserver === "function") new ResizeObserver(check).observe(el);
  check();
  watchBarOverflow(document.getElementById("topbar"));
  const turn = document.getElementById("turn");
  // ext/timeline replaces this with its year control (class "tl"); don't overwrite it on a re-render
  // (the long vintage note goes in the tooltip: in the bar it pushed the yields off screen until the timeline loaded)
  if (!turn.classList.contains("tl")) {
    turn.innerHTML = t("Turn <b>{year}</b>", { year: esc(nation.year ?? "") });
    turn.title = t(nation.vintage || "");
  }
}

// Phones scroll the whole bar sideways. Mark which ends have more to show (.more-l / .more-r) so CSS can fade
// them: without a cue the yields look cut off after the second or third value.
function watchBarOverflow(bar) {
  if (!bar || bar.dataset.overflowWatch) return;
  bar.dataset.overflowWatch = "1";
  let raf = 0;
  const update = () => {
    raf = 0;
    const max = bar.scrollWidth - bar.clientWidth;
    bar.classList.toggle("more-l", max > 1 && bar.scrollLeft > 1);
    bar.classList.toggle("more-r", max > 1 && bar.scrollLeft < max - 1);
  };
  const queue = () => { if (!raf) raf = requestAnimationFrame(update); };
  bar.addEventListener("scroll", queue, { passive: true });
  addEventListener("resize", queue);
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(queue);
    ro.observe(bar);
    for (const child of bar.children) ro.observe(child);
  }
  // Extensions add top-bar buttons later.
  if (typeof MutationObserver === "function") new MutationObserver(queue).observe(bar, { childList: true, subtree: true });
  queue();
}
