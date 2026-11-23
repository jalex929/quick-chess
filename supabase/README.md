# Usage counts backend (shared by the Lab)

Where the anonymous usage counts go (see `DECISIONS.md`, "Usage counts"). It lives in the UX
Portfolio Supabase project, next to the portfolio, and is shared by every Lab project: one
table, one receiver, and an `app` column saying which project sent each row. Quick Chess is the
first project wired up, so the source lives here for now.

- `migrations/20261123000000_lab_events.sql`: the `public.lab_events` table. Row level security
  is on with no policies, so the public API can't read or write it.
- `functions/lab-events/index.ts`: the public receiver (JWT check off). It accepts only small,
  well-formed events, sent from `https://…jayfox.design`, by an app on its `APPS` list, and
  inserts them with the service role.

Address: `https://ctjtaupulyxefuyeromj.supabase.co/functions/v1/lab-events`

## Adding a Lab project

1. Add its slug and payload version to `APPS` in the function, then redeploy.
2. In the project, send the same JSON shape as `src/telemetry.ts` (`app`, `v`, `event`,
   `props`, `visit`, `live`, `screen`) as a `text/plain` beacon, and send `app_open` once per
   page load so projects can be ranked by interest.

## Moving a project to its own site

Copy the migration and function into the new project's Supabase, change `LIVE_HOST` to the new
domain, and point the app at the new address. Its history comes along with:

```sql
select * from lab_events where app = 'quick-chess';
```

## Reading the counts

In the Supabase dashboard, SQL editor:

```sql
-- Which Lab projects get opened most (last 30 days), and from where
select app, props->>'from' as came_from, count(*) as opens, count(distinct visit) as visits
from lab_events
where event = 'app_open' and received_at > now() - interval '30 days'
group by 1, 2 order by opens desc;

-- Quick Chess: games started per day, by mode
select date_trunc('day', received_at) as day, props->>'mode' as mode, count(*)
from lab_events where app = 'quick-chess' and event = 'game_start'
group by 1, 2 order by 1 desc, 3 desc;

-- Quick Chess: most used actions
select props->>'name' as action, count(*)
from lab_events where app = 'quick-chess' and event = 'action'
group by 1 order by 2 desc;

-- Quick Chess: setup choices
select props->>'field' as field, props->>'value' as value, count(*)
from lab_events where app = 'quick-chess' and event = 'setup_change'
group by 1, 2 order by 1, 3 desc;
```

## Redeploying

Keep JWT verification off (the function does its own checks), e.g.
`supabase functions deploy lab-events --no-verify-jwt`.

## Limits

Anyone can post to the address, so the counts could be padded on purpose. The receiver limits
what a row can hold (no free text over 64 characters, no nesting, 2 KB max) but has no rate
limit.
