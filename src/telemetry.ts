/**
 * Anonymous usage counts: which options people pick and what they do most, so the game can be
 * shaped around how it's actually played. See DECISIONS.md ("Usage counts").
 *
 * What is sent: an event name, a few option values (mode, level, clock, board view...), and a
 * random id for this visit (a new one every tab, nothing stored between visits). Never moves,
 * positions, names, IP-derived data or a device fingerprint.
 *
 * Sent only from the live site (jayfox.design), to the Lab's shared receiver in the UX
 * Portfolio Supabase project (supabase/README.md). Local builds, previews and tests send nothing,
 * unless VITE_TELEMETRY_URL is set at build time, which overrides the address and sends from
 * anywhere (the receiver still drops events that aren't from jayfox.design). Always off when the
 * browser sends Do Not Track or Global Privacy Control.
 */

export type EventName =
  "app_open" | "setup_change" | "game_start" | "game_end" | "game_left" | "action";

export type Props = Record<string, string | number | boolean | null>;

const LAB_RECEIVER = "https://ctjtaupulyxefuyeromj.supabase.co/functions/v1/lab-events";
const OVERRIDE: string | undefined = import.meta.env.VITE_TELEMETRY_URL;
const VERSION = 1;

function optedOut(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  return nav.doNotTrack === "1" || nav.globalPrivacyControl === true;
}

let visit: string | null = null;
function visitId(): string {
  if (!visit) {
    visit =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
  }
  return visit;
}

const LIVE_HOST = /(^|\.)jayfox\.design$/;

/** Real visitors on the live site, as opposed to local builds and previews. */
function isLive(): boolean {
  return typeof location !== "undefined" && LIVE_HOST.test(location.hostname);
}

/** Where counts go from a page on this host, or nowhere. */
export function endpointFor(hostname: string, override = OVERRIDE): string | undefined {
  return override || (LIVE_HOST.test(hostname) ? LAB_RECEIVER : undefined);
}

/**
 * Where this visit came from, coarsely: the Lab page, elsewhere on jayfox.design, another site, or
 * nowhere (typed in, a bookmark, an app). Only this word is sent, never the address.
 */
export function arrivedFrom(): "lab" | "site" | "other" | "direct" {
  if (typeof document === "undefined" || !document.referrer) return "direct";
  try {
    const ref = new URL(document.referrer);
    if (!LIVE_HOST.test(ref.hostname)) return "other";
    return /^\/lab\/?$/.test(ref.pathname) ? "lab" : "site";
  } catch {
    return "direct";
  }
}

export function track(event: EventName, props: Props = {}) {
  if (import.meta.env.DEV) console.debug("[quick-chess telemetry]", event, props);
  const endpoint = endpointFor(typeof location === "undefined" ? "" : location.hostname);
  if (!endpoint || optedOut()) return;
  const body = JSON.stringify({
    app: "quick-chess",
    v: VERSION,
    event,
    props,
    visit: visitId(),
    live: isLive(),
    // Coarse screen class only, to tell phone from desktop play.
    screen: typeof window !== "undefined" && window.innerWidth < 860 ? "narrow" : "wide",
  });
  try {
    // Plain text, so the beacon needs no CORS preflight; the receiver parses the JSON.
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon?.(endpoint, blob)) return;
    void fetch(endpoint, { method: "POST", body, keepalive: true, mode: "no-cors" });
  } catch {
    // Counting is best effort: never let it get in the way of the game.
  }
}
