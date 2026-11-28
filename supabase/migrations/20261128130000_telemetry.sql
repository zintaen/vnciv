-- Anonymous error reports and usage counts (web/js/app/telemetry.js → supabase/functions/vnciv-telemetry).
-- Only the Edge Function writes, with the service-role key (which bypasses RLS). RLS is on with NO policies, and
-- anon / authenticated have no grants on the tables, views or functions, so the public API can neither read nor write.
-- Nothing here identifies a visitor: no IP, no user agent (only the browser family), no cookie or stored ID.
--
-- Retention: error and event rows are kept (Anh, 2026-11-28; they hold no personal data). Only the rate-limit
-- rows (salted, daily-rotating IP hashes) are deleted after 2 days by vnciv_telemetry_purge(), which the
-- Edge Function calls on about 1 request in 200. That needs no pg_cron (an extension that would be switched on for
-- the whole shared project). By hand, any time: select public.vnciv_telemetry_purge();

create table if not exists public.vnciv_client_errors (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  message    text not null check (char_length(message) between 1 and 300),
  source     text check (source is null or char_length(source) <= 200),     -- script path, no origin / query
  line       integer,
  col        integer,
  stack      text check (stack is null or char_length(stack) <= 2000),
  path       text check (path is null or char_length(path) <= 100),        -- page path, no query / hash
  lang       text check (lang is null or lang in ('vi', 'en')),
  viewport   text check (viewport is null or viewport in ('phone', 'tablet', 'desktop')),
  version    text check (version is null or char_length(version) <= 40),  -- the deployed commit's short SHA
  browser    text not null check (browser in ('chrome', 'edge', 'firefox', 'safari', 'samsung', 'opera', 'other'))
);

create table if not exists public.vnciv_events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text not null check (name in ('page_view', 'lens_chosen', 'layer_toggled', 'story_opened', 'tour_started',
                                           'search_used', 'advisor_opened', 'share', 'contact_sent', 'embed_view')),
  props      jsonb not null default '{}'::jsonb check (jsonb_typeof(props) = 'object' and length(props::text) <= 300)
);

-- Requests per (sha256(salt | day | ip):kind, hour): the rate limit. The key changes every day.
create table if not exists public.vnciv_telemetry_rate (
  key  text not null,
  hour timestamptz not null,
  n    integer not null default 1,
  primary key (key, hour)
);

alter table public.vnciv_client_errors enable row level security;
alter table public.vnciv_events enable row level security;
alter table public.vnciv_telemetry_rate enable row level security;
revoke all on table public.vnciv_client_errors, public.vnciv_events, public.vnciv_telemetry_rate from anon, authenticated;

create index if not exists vnciv_client_errors_created_at_idx on public.vnciv_client_errors (created_at);
create index if not exists vnciv_events_created_at_idx on public.vnciv_events (created_at);
create index if not exists vnciv_events_name_created_at_idx on public.vnciv_events (name, created_at);
create index if not exists vnciv_telemetry_rate_hour_idx on public.vnciv_telemetry_rate (hour);

-- One request: count it and say whether it is within p_limit for this hour (atomic upsert).
create or replace function public.vnciv_telemetry_hit(p_key text, p_limit integer) returns boolean
language sql security invoker set search_path = public as $$
  insert into public.vnciv_telemetry_rate as r (key, hour, n) values (p_key, date_trunc('hour', now()), 1)
  on conflict (key, hour) do update set n = r.n + 1
  returning n <= p_limit;
$$;

create or replace function public.vnciv_telemetry_purge() returns void
language sql security invoker set search_path = public as $$
  delete from public.vnciv_telemetry_rate where hour < now() - interval '2 days';
$$;

revoke all on function public.vnciv_telemetry_hit(text, integer), public.vnciv_telemetry_purge() from public, anon, authenticated;
grant execute on function public.vnciv_telemetry_hit(text, integer), public.vnciv_telemetry_purge() to service_role;

-- Daily counts for the dashboard (SQL Editor; supabase/README.md). security_invoker: a reader needs rights on the
-- tables themselves, which only the service role and the dashboard's postgres role have.
create or replace view public.vnciv_events_daily with (security_invoker = true) as
  select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day, name, props, count(*) as n
  from public.vnciv_events group by 1, 2, 3;

create or replace view public.vnciv_errors_daily with (security_invoker = true) as
  select (created_at at time zone 'Asia/Ho_Chi_Minh')::date as day, message, source, version, count(*) as n,
         array_agg(distinct browser) as browsers, max(created_at) as last_seen
  from public.vnciv_client_errors group by 1, 2, 3, 4;

revoke all on public.vnciv_events_daily, public.vnciv_errors_daily from anon, authenticated;
