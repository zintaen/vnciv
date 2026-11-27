// Language: Vietnamese (default) or English. Every user-visible English string goes through t(); the Vietnamese
// dictionaries (i18n/*.js) are keyed by the English text, so a missing entry simply shows the English.
//   t("Population")                         → "Dân số"
//   t("{n} lenses", { n: 19 })              → "19 lớp bản đồ"   (placeholders {name} are filled after lookup)
// The choice is kept in localStorage ("vnciv-lang"); ?lang=en|vi in the URL overrides it. Switching reloads the page
// (the hash keeps the view), so nothing has to re-render live.
import { VI, CONFLICTS } from "./i18n/vi.js";

export const LANGS = ["vi", "en"];
const STORE = "vnciv-lang";

function detect() {
  try {
    const q = new URLSearchParams(location.search).get("lang");
    if (LANGS.includes(q)) return q;
  } catch { /* no location (worker, tests) */ }
  try {
    const s = localStorage.getItem(STORE);
    if (LANGS.includes(s)) return s;
  } catch { /* storage blocked */ }
  return "vi";
}

export const lang = detect();
if (typeof document !== "undefined") document.documentElement.lang = lang;

// English keys looked up but not found while in Vietnamese (QA reads window.__i18nMissing).
const missing = new Set();
if (typeof window !== "undefined") window.__i18nMissing = missing;
// Keys translated differently in several vi-*.js files (i18n/vi.js; tools/i18n/check_dups.mjs fails on them).
if (typeof window !== "undefined") window.__i18nConflicts = CONFLICTS;

export function t(s, vars) {
  if (s == null) return s;
  let out = s;
  if (lang === "vi") {
    const v = VI[s];
    if (v != null) out = v;
    else if (/[A-Za-z]{2}/.test(s) && !/[\u00C0-\u1EF9]/.test(s)) missing.add(s); // already Vietnamese: not missing
  }
  if (vars) out = String(out).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

/** Switch language: remember it and reload (keeping the hash, dropping a ?lang= override). */
export function setLang(l) {
  if (!LANGS.includes(l)) return;
  try { localStorage.setItem(STORE, l); } catch { /* storage blocked: the ?lang= parameter still works */ }
  const u = new URL(location.href);
  u.searchParams.set("lang", l);
  location.replace(u.toString());
}
