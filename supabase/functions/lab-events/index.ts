// Receives anonymous usage counts from the Lab projects (Quick Chess: src/telemetry.ts) and
// stores them in public.lab_events. Public (no JWT): the apps send beacons with no headers, so
// the function does its own checks and only accepts small, well-formed events sent from
// jayfox.design by a known app. Deployed to the UX Portfolio Supabase project with JWT
// verification off. See DECISIONS.md ("Usage counts") and supabase/README.md.

/** Apps allowed to send, with the payload version each one speaks. Add a Lab project here. */
const APPS: Record<string, number> = { "quick-chess": 1 };

const SCREENS = new Set(["narrow", "wide"]);
const MAX_BODY = 2048;
const MAX_PROPS = 12;
const EVENT = /^[a-z_]{1,32}$/;
const KEY = /^[A-Za-z_]{1,32}$/;
const VISIT = /^[A-Za-z0-9-]{1,64}$/;
const LIVE_HOST = /(^|\.)jayfox\.design$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

function reply(status: number): Response {
  return new Response(null, { status, headers: CORS });
}

function fromLiveSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && LIVE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

type Value = string | number | boolean | null;

function cleanProps(raw: unknown): Record<string, Value> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_PROPS) return null;
  const out: Record<string, Value> = {};
  for (const [key, value] of entries) {
    if (!KEY.test(key)) return null;
    if (value === null || typeof value === "boolean") out[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
    else if (typeof value === "string" && value.length <= 64) out[key] = value;
    else return null;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return reply(204);
  if (req.method !== "POST") return reply(405);
  // Live site only: local builds, previews and anything else are dropped.
  if (!fromLiveSite(req)) return reply(403);

  const text = await req.text();
  if (text.length > MAX_BODY) return reply(413);

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return reply(400);
  }
  if (!data || typeof data !== "object") return reply(400);

  const props = cleanProps(data.props ?? {});
  const app = typeof data.app === "string" ? data.app : "";
  if (
    !Object.hasOwn(APPS, app) ||
    data.v !== APPS[app] ||
    data.live !== true ||
    typeof data.event !== "string" ||
    !EVENT.test(data.event) ||
    typeof data.visit !== "string" ||
    !VISIT.test(data.visit) ||
    typeof data.screen !== "string" ||
    !SCREENS.has(data.screen) ||
    !props
  ) {
    return reply(400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply(500);

  const res = await fetch(`${url}/rest/v1/lab_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      app,
      v: data.v,
      event: data.event,
      props,
      visit: data.visit,
      screen: data.screen,
    }),
  });
  return reply(res.ok ? 204 : 502);
});
