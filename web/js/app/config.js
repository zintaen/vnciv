// Deployment settings, in one place. The contact form (app/contact.js) POSTs to CONTACT_ENDPOINT, the Supabase Edge
// Function supabase/functions/vnciv-contact (see supabase/README.md), e.g.
//   "https://<project-ref>.supabase.co/functions/v1/vnciv-contact"
// Empty = not deployed yet: the form offers a prefilled e-mail to info@cyberskill.world instead.
// SUPABASE_ANON_KEY is public by design (the function is deployed with --no-verify-jwt, so it may stay empty);
// when set it is sent as `apikey` / `Authorization: Bearer`. index.html's CSP connect-src must allow the endpoint's origin.
export const CONTACT_ENDPOINT = "https://lvnzcwjxreamelewdwql.supabase.co/functions/v1/vnciv-contact";
export const SUPABASE_ANON_KEY = "";
// Anonymous error reports and usage counts (app/telemetry.js) POST here: the Edge Function
// supabase/functions/vnciv-telemetry (supabase/README.md). Empty = off. Not deployed yet = each page view tries one
// request, which fails quietly, and sends nothing more.
export const TELEMETRY_ENDPOINT = "https://lvnzcwjxreamelewdwql.supabase.co/functions/v1/vnciv-telemetry";
