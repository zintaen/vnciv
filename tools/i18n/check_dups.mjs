// Fails when an English key appears in more than one web/js/i18n/vi-*.js file with different translations
// (web/js/i18n/vi.js merges them and the later file would silently win). Run: node tools/i18n/check_dups.mjs
import { CONFLICTS } from "../../web/js/i18n/vi.js";

for (const [k, l] of CONFLICTS) console.log(JSON.stringify(k), l.map(([f, v]) => `${f}=${JSON.stringify(v)}`).join(" | "));
if (CONFLICTS.length) {
  console.error(`${CONFLICTS.length} key(s) translated differently in several vi-*.js files`);
  process.exit(1);
}
console.log("no conflicting keys");
