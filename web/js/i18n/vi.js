// Vietnamese dictionary, keyed by the English text. Split by area so they can be edited independently.
// A key should live in one file; when it is in several, the later file wins (data, shell, panels, advisors) and the
// clash is listed in CONFLICTS (tools/i18n/check_dups.mjs fails on it; vi-data.js is generated from
// tools/i18n/vi-data.json).
import shell from "./vi-shell.js";
import panels from "./vi-panels.js";
import advisors from "./vi-advisors.js";
import data from "./vi-data.js";
import communesDict from "./vi-communes.js";
import poiDict from "./vi-poi.js";
import envDict from "./vi-env.js";
import societyDict from "./vi-society.js";
import timelineDict from "./vi-timeline.js";
import donateDict from "./vi-donate.js";

const FILES = { "vi-data": data, "vi-shell": shell, "vi-panels": panels, "vi-advisors": advisors,
  "vi-communes": communesDict, "vi-poi": poiDict, "vi-env": envDict, "vi-society": societyDict, "vi-timeline": timelineDict, "vi-donate": donateDict };
export const VI = Object.create(null);
const from = Object.create(null);
/** [key, [[file, text], ...]] for every key translated differently in more than one file. */
export const CONFLICTS = [];
for (const [f, d] of Object.entries(FILES)) {
  for (const [k, v] of Object.entries(d)) {
    if (k in VI && VI[k] !== v) {
      const c = CONFLICTS.find((x) => x[0] === k);
      if (c) c[1].push([f, v]);
      else CONFLICTS.push([k, [[from[k], VI[k]], [f, v]]]);
    }
    VI[k] = v;
    from[k] = f;
  }
}
