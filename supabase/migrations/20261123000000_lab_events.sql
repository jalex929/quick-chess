-- Anonymous usage counts from the Lab projects on jayfox.design (Quick Chess first).
-- See DECISIONS.md, "Usage counts". One row per event; `app` says which project sent it.
-- Written only by the lab-events edge function with the service role. Row level security is
-- on with no policies, so the public API can't read or write it.

create table public.lab_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  app text not null check (app ~ '^[a-z0-9-]{1,32}$'),
  v smallint not null,
  event text not null check (event ~ '^[a-z_]{1,32}$'),
  props jsonb not null default '{}'::jsonb,
  visit text not null check (char_length(visit) between 1 and 64),
  screen text not null check (screen in ('narrow', 'wide'))
);

comment on table public.lab_events is
  'Anonymous usage counts from Lab projects on jayfox.design. No content, names or fingerprints.';

create index lab_events_app_time_idx on public.lab_events (app, received_at);
create index lab_events_app_event_idx on public.lab_events (app, event, received_at);

alter table public.lab_events enable row level security;
revoke all on public.lab_events from anon, authenticated;
