// "Contact CyberSkill": a small form in the Author card (app/donate.js) for collaboration and service enquiries.
// It POSTs JSON to the Supabase Edge Function in supabase/functions/vnciv-contact (URL in app/config.js). With no endpoint
// configured, or when the request fails, it offers a mailto: link with the subject and body prefilled; what the
// visitor typed always stays in the fields until a message is actually sent.
import { t, lang } from "../i18n.js";
import { esc, int } from "../format.js";
import { CONTACT_ENDPOINT, SUPABASE_ANON_KEY } from "./config.js";
import { track } from "./telemetry.js";

export const CONTACT_EMAIL = "info@cyberskill.world";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const LIMITS = { name: 120, email: 254, messageMin: 10, messageMax: 4000 };
// Characters as Postgres char_length counts them (code points; an emoji is one), so the table's checks agree.
const chars = (s) => [...s].length;

/** Validation shared by the form and its test: {} when fine, else {field: English message}. */
export function validate({ name = "", email = "", message = "" }) {
  const err = {};
  if (chars(name.trim()) > LIMITS.name) err.name = "Please keep the name under 120 characters.";
  const e = email.trim();
  if (!e) err.email = "Please enter your email.";
  else if (e.length > LIMITS.email || !EMAIL_RE.test(e)) err.email = "Please enter a valid email address.";
  const m = chars(message.trim());
  if (!m) err.message = "Please write a message.";
  else if (m < LIMITS.messageMin) err.message = "The message is too short (at least 10 characters).";
  else if (m > LIMITS.messageMax) err.message = "The message is too long (at most 4,000 characters).";
  return err;
}

/** mailto: link with the subject and body prefilled (the fallback). */
export function mailtoHref({ name = "", email = "", message = "" }) {
  const subject = t("Atlas enquiry from {name}", { name: name.trim() || email.trim() || t("a visitor") });
  const body = `${message.trim()}\n\n— ${name.trim()}${email.trim() ? ` <${email.trim()}>` : ""}`;
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function contactHtml() {
  const f = (id, label, input, hint = "") => `<div class="cf-field">
      <label for="cf-${id}">${label}${hint ? ` <span class="cf-opt">${hint}</span>` : ""}</label>${input}
      <span class="cf-err" id="cf-${id}-err"></span></div>`;
  return `<form class="contact-form" novalidate aria-labelledby="cf-title">
    <h3 id="cf-title" class="coffee-sub">${esc(t("Work with CyberSkill"))}</h3>
    <p class="cf-lead">${esc(t("A project, a collaboration or a question about our services? Write to us."))}</p>
    ${f("name", esc(t("Name")), `<input id="cf-name" name="name" autocomplete="name" maxlength="${LIMITS.name}">`, esc(t("(optional)")))}
    ${f("email", esc(t("Email")), `<input id="cf-email" name="email" type="email" autocomplete="email" maxlength="${LIMITS.email}" required aria-required="true" aria-describedby="cf-email-err">`)}
    ${f("message", esc(t("Message")), `<textarea id="cf-message" name="message" rows="4" maxlength="${LIMITS.messageMax}" required aria-required="true" aria-describedby="cf-message-err cf-count"></textarea>`)}
    <div class="cf-count" id="cf-count" aria-hidden="true"></div>
    <div class="cf-hp" aria-hidden="true"><label for="cf-website">Website</label><input id="cf-website" name="website" tabindex="-1" autocomplete="off"></div>
    <p class="cf-consent">${esc(t("Your email is only used by CyberSkill to reply to this enquiry."))} ${esc(t("The atlas sets no cookies; it sends only anonymous error reports and usage counts, and nothing when your browser asks not to be tracked."))}</p>
    <button type="submit" class="cf-send">${esc(t("Send"))}</button>
    <div class="cf-status" role="status" aria-live="polite"></div>
  </form>`;
}

/** Wire the form inside root. Call opened() each time the card opens (the 3-second check starts there). */
export function wireContact(root) {
  const form = root.querySelector(".contact-form");
  const $ = (n) => form.elements[n];
  const send = form.querySelector(".cf-send"), status = form.querySelector(".cf-status"), count = form.querySelector(".cf-count");
  let openedAt = Date.now(), sending = false;
  const values = () => ({ name: $("name").value, email: $("email").value, message: $("message").value });
  const setCount = () => { count.textContent = `${int(chars($("message").value.trim()))} / ${int(LIMITS.messageMax)}`; };
  const showErr = (err) => {
    for (const n of ["name", "email", "message"]) {
      const box = form.querySelector(`#cf-${n}-err`);
      box.textContent = err[n] ? t(err[n]) : "";
      if (err[n]) $(n).setAttribute("aria-invalid", "true"); else $(n).removeAttribute("aria-invalid");
    }
  };
  const say = (cls, html) => { status.className = `cf-status ${cls}`; status.innerHTML = html; };
  const fallback = (lead) => say("cf-fail", `${esc(lead)} <a class="cf-mailto" href="${esc(mailtoHref(values()))}">${esc(t("Send it by email to {to}", { to: CONTACT_EMAIL }))}</a>`);
  $("message").addEventListener("input", setCount);
  form.addEventListener("input", (e) => { if (e.target.getAttribute("aria-invalid")) showErr(validate(values())); });
  setCount();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (sending) return;
    const v = values(), err = validate(v);
    showErr(err);
    const bad = ["email", "message", "name"].find((n) => err[n]);
    if (bad) { say("cf-fail", esc(t("Please check the highlighted fields."))); $(bad).focus(); return; }
    if (!CONTACT_ENDPOINT) { fallback(t("Online sending is not set up yet, sorry. Your message is still here:")); return; }
    sending = true;
    send.disabled = true;
    form.setAttribute("aria-busy", "true");
    say("cf-busy", esc(t("Sending…")));
    const headers = { "content-type": "application/json" };
    if (SUPABASE_ANON_KEY) { headers.apikey = SUPABASE_ANON_KEY; headers.authorization = `Bearer ${SUPABASE_ANON_KEY}`; }
    try {
      const res = await fetch(CONTACT_ENDPOINT, {
        method: "POST", headers, credentials: "omit",
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(20000) : undefined,
        body: JSON.stringify({ name: v.name.trim(), email: v.email.trim(), message: v.message.trim(), website: $("website").value,
          lang, page_url: location.href.slice(0, 500), opened_at: openedAt, sent_at: Date.now() }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.ok) throw new Error(out.error || `HTTP ${res.status}`);
      track("contact_sent", { ok: true });
      form.reset();
      setCount();
      say("cf-ok", esc(t("Thank you! Your message has been sent; CyberSkill will reply by email.")));
    } catch (err2) {
      track("contact_sent", { ok: false });
      fallback(t(/rate/i.test(String(err2?.message)) ? "Too many messages from here in the last hour, sorry." : "The message could not be sent, sorry. Your text is still here:"));
    } finally {
      sending = false;
      send.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });
  return { opened: () => { openedAt = Date.now(); } };
}
