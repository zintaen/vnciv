// node web/js/app/contact.test.mjs: the contact form's validation and mailto fallback (app/contact.js).
import assert from "node:assert/strict";
const { validate, mailtoHref } = await import("./contact.js");

assert.deepEqual(validate({ email: "a@b.vn", message: "Xin chào CyberSkill" }), {});
assert.ok(validate({ email: "", message: "Hello there friend" }).email);
assert.ok(validate({ email: "not-an-email", message: "Hello there friend" }).email);
assert.ok(validate({ email: "a@b.vn", message: "too short" }).message); // 9 characters
assert.deepEqual(validate({ email: "a@b.vn", message: "x".repeat(10) }), {});
assert.ok(validate({ email: "a@b.vn", message: "x".repeat(4001) }).message);
assert.ok(validate({ email: "a@b.vn", message: "🙂".repeat(5) }).message); // 5 code points, as Postgres counts
assert.ok(validate({ name: "n".repeat(121), email: "a@b.vn", message: "x".repeat(20) }).name);
const href = mailtoHref({ name: "Lan", email: "lan@x.vn", message: "Hợp tác & dự án?\nDòng 2" });
assert.ok(href.startsWith("mailto:info@cyberskill.world?subject="));
const q = new URLSearchParams(href.split("?")[1]);
assert.ok(q.get("body").startsWith("Hợp tác & dự án?\nDòng 2") && q.get("body").includes("lan@x.vn"));
console.log("contact ok");
