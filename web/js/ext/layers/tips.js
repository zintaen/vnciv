// Hover tooltips for the map-art layers (HTML strings; every data value is escaped). Each says where the number comes
// from and the caveat that matters for it (ports have no open tonnage; curated landmarks are an editorial pick).
import { airportName, esc, compact, fixed, int, pct, dollars } from "../../format.js";
import { FORT_KINDS, fortKind, WONDER_KINDS } from "../../render/art/sites.js";
import { MODE_STYLE } from "../../render/art/improvements.js";
import { t, lang } from "../../i18n.js";

const muted = (s) => `<span class="muted">${s}</span>`;
/** A country's name from its ISO code in the page language (Intl), or "" where the browser has none. */
export function regionName(code) {
  try { return code ? new Intl.DisplayNames([lang === "vi" ? "vi" : "en"], { type: "region" }).of(code) || "" : ""; } catch { return ""; }
}
const num = (n, d = 1) => (n == null || !Number.isFinite(n) ? "–" : compact(n));
const sign = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±");

function usd(n) {
  if (n == null || !Number.isFinite(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e12) return t("${n} trillion", { n: fixed(n / 1e12, 2) });
  if (a >= 1e9) return t("${n} billion", { n: fixed(n / 1e9, a >= 1e10 ? 1 : 2) });
  if (a >= 1e6) return t("${n} million", { n: fixed(n / 1e6, 1) });
  return dollars(n);
}

const HUB_NAME = { L: "Major hub (10M+ passengers)", M: "Medium hub (2–10M passengers)", S: "Small hub (0.5–2M passengers)", N: "Local airport" };
const PORT_TYPE = { coastal: "Seaport", inland: "River port" };
const prov = (m, abbr) => m.w?.raw?.states?.find((s) => s.abbr === abbr)?.name || abbr || "";

export const tips = {
  port(p, m) {
    const cls = m.data.infrastructure?.port_classes?.find((c) => c.id === p.class)?.name;
    return [
      `<b>${esc(p.name)}</b> ${muted(`${esc(t(PORT_TYPE[p.type] || "Port"))}, ${esc(prov(m, p.state))}`)}`,
      [cls ? esc(t(cls)) : "", esc(p.seaport || "")].filter(Boolean).join(" · "),
      muted(t("Seaports: size by class (special largest), since no tonnage is published.")),
    ].filter(Boolean).join("<br>");
  },
  airport(a, m) {
    // a.city is the former province (before July 2025): say so when today's province is another one
    const now = prov(m, a.state);
    const where = a.city && a.city !== now ? t("{former} <span class=\"muted\">(former) · now</span> {prov}", { former: esc(a.city), prov: esc(now) }) : esc(a.city || now);
    const lines = [`<b>${esc(a.id)} · ${esc(airportName(a.name))}</b> ${muted(where)}`];
    if (a.hub) lines.push(esc(t(HUB_NAME[a.hub] || a.hub)));
    if (a.enplanements != null) lines.push(t("<b>{n}</b> passengers in {year}", { n: num(a.enplanements), year: esc(a.year) }));
    lines.push(muted(t("Passengers: Airports Corporation of Vietnam (ACV) figures compiled on Wikipedia. Location: OurAirports.")));
    return lines.join("<br>");
  },
  fort(f, m) {
    const comp = m.data.military?.components?.find((c) => c.id === f.component);
    const name = t(comp?.name || FORT_KINDS[fortKind(f.component)]?.name || "Military site");
    const tier = t({ major: "Major installation", base: "Base", site: "Site" }[f.tier] || "");
    const lines = [`<b>${esc(f.name)}</b> ${muted(esc(prov(m, f.state)))}`, `${esc(name)} · ${esc(tier)}`];
    if (f.area_km2 != null) lines.push(t("Mapped outline {n} km²", { n: f.area_km2 >= 10 ? int(f.area_km2) : fixed(f.area_km2, 1) }));
    if (f.parts?.length) lines.push(muted(t("Also in this hex: {list}", { list: esc(f.parts.slice(0, 3).join(", ")) + (f.parts.length > 3 ? "…" : "") })));
    lines.push(muted(t("OpenStreetMap military land. Sized by mapped area: no headcount is published.")));
    return lines.join("<br>");
  },
  range(r, m) {
    const comp = m.data.military?.components?.find((c) => c.id === r.component);
    return [
      `<b>${esc(r.name)}</b> ${muted(esc(prov(m, r.state)))}`,
      `${t("Restricted ground")} · ${esc(t(comp?.name || ""))} · ${int(r.area_km2)} km²`,
      muted(t("A mapped military area of 5 km² or more (OpenStreetMap), drawn on the hexes it covers.")),
    ].join("<br>");
  },
  wonder(x, m) {
    const k = t(WONDER_KINDS[x.kind]?.name || "Wonder");
    const rule = m.data.wonders?.rules?.find((r) => r.id === x.rule);
    const mt = x.metrics || {};
    const lines = [`<b>${esc(x.name)}</b> ${muted(esc(prov(m, x.state)))}`];
    if (lang !== "vi" && x.name_en && x.name_en !== x.name) lines.push(muted(esc(x.name_en)));
    if (x.rule === "world_heritage") {
      lines.push(mt.inscribed ? t("UNESCO World Heritage site since {year}", { year: esc(mt.inscribed) }) : t("UNESCO World Heritage site"));
    } else if (x.rule === "national_park") {
      lines.push(`${esc(k)} · ${t("national park")}${mt.area_km2 != null ? ` · ${int(mt.area_km2)} km²` : ""}`);
    } else if (x.rule === "research_university") {
      lines.push(`${esc(k)}${mt.founded ? ` · ${t("founded {year}", { year: esc(mt.founded) })}` : ""}`);
    } else if (x.curated) {
      lines.push(`${esc(k)} · ${t("hand-picked (curated, not ranked by data)")}`);
    }
    if (rule?.text) lines.push(muted(esc(t(rule.text))));
    return lines.join("<br>");
  },
  intlRoute(rt, m) {
    const r = rt.route;
    const td = m.data.trade || {};
    const f = td.international?.foreign?.[r.foreign] || {};
    const country = regionName(f.country);
    const vn = (m.airports || []).find((a) => a.data?.id === r.vn)?.data;
    const lines = [
      `<b>${esc(vn ? airportName(vn.name) : r.vn)} ⇄ ${esc(t(f.city || r.foreign))}</b>${country && !t(f.city || "").startsWith(country) ? ` ${muted(esc(country))}` : ""}`,
      `${t(r.airlines === 1 ? "<b>{n}</b> airline" : "<b>{n}</b> airlines", { n: esc(r.airlines) })} (${esc((r.airline_codes || []).join(", "))}) · ${esc(r.vn)}–${esc(r.foreign)}`,
      r.dist_km != null ? t("{n} km apart", { n: int(r.dist_km) }) : "",
      muted(esc(t("International route, as listed in the Vietnamese airport's Wikipedia articles; no flight or passenger counts."))),
    ];
    return lines.filter(Boolean).join("<br>");
  },
  route(rt, m) {
    const r = rt.route;
    const td = m.data.trade || {};
    const a = rt.a?.short || r.a, b = rt.b?.short || r.b;
    const lines = [
      `<b>${esc(a)} ⇄ ${esc(b)}</b> ${muted(t("air route #{n}", { n: esc(r.rank) }))}`,
      r.airlines != null ? `${t(r.airlines === 1 ? "<b>{n}</b> airline" : "<b>{n}</b> airlines", { n: esc(r.airlines) })} (${esc((r.airline_codes || []).join(", "))}) · ${esc((r.airports || []).join("–"))}` : "",
      r.dist_km != null ? t("{n} km apart", { n: int(r.dist_km) }) : "",
      muted(esc(t(td.path_note || ""))),
    ];
    return lines.filter(Boolean).join("<br>");
  },
};
