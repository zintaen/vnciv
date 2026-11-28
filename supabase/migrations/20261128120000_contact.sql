-- Contact form messages (web/js/app/contact.js → supabase/functions/vnciv-contact).
-- Only the Edge Function writes, with the service-role key (which bypasses RLS). RLS is on with NO policies, and
-- anon / authenticated have no grants, so the public API can neither read nor write this table.
create table if not exists public.vnciv_contact_messages (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  name       text check (name is null or char_length(name) <= 120),
  email      text not null check (char_length(email) between 3 and 254),
  message    text not null check (char_length(message) between 10 and 4000),
  lang       text check (lang is null or lang in ('vi', 'en')),
  page_url   text check (page_url is null or char_length(page_url) <= 500),
  ip_hash    text not null,          -- sha256(IP_HASH_SALT || ip), hex; the raw IP is never stored
  user_agent text check (user_agent is null or char_length(user_agent) <= 300)
);

alter table public.vnciv_contact_messages enable row level security;
revoke all on table public.vnciv_contact_messages from anon, authenticated;

-- The rate limit counts one ip_hash's messages in the last hour.
create index if not exists vnciv_contact_messages_ip_hash_created_at_idx on public.vnciv_contact_messages (ip_hash, created_at);
