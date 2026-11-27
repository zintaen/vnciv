// Number formats per language: node tools/check_format.mjs vi && node tools/check_format.mjs en
const L = process.argv[2];
globalThis.localStorage = { getItem: () => L, setItem() {} };
const f = await import("../web/js/format.js");
const eq = (a, b) => { if (a !== b) { console.error("FAIL", JSON.stringify(a), "!=", JSON.stringify(b)); process.exitCode = 1; } };
const vi = L === "vi";
eq(f.int(9543600), vi ? "9.543.600" : "9,543,600");
eq(f.compact(1.5e6), vi ? "1,5\u00a0tr" : "1.5M");
eq(f.compact(999600), vi ? "1,0\u00a0tr" : "1.0M");
eq(f.popShort(999600), vi ? "1,0\u00a0tr" : "1.0M");
eq(f.dollars(3749), vi ? "$3.749" : "$3,749");
eq(f.money(472e9), vi ? "$472\u00a0tỷ" : "$472B");
eq(f.money(-2.4e6), vi ? "−$2,4\u00a0tr" : "−$2.4M");
eq(f.money(-2), "−$2");
eq(f.dollars(-2), "−$2");
eq(f.pct(0.1234), vi ? "12,3%" : "12.3%");
eq(f.compact(999.6e9), vi ? "1,00\u00a0nghìn\u00a0tỷ" : "1.00T");
console.log(L, process.exitCode ? "FAILED" : "ok");
