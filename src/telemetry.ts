/**
 * Anonymous usage counts: which options people pick and what they do most, so the game can be
 * shaped around how it's actually played. See DECISIONS.md ("Usage counts").
 *
 * What is sent: an event name, a few option values (mode, level, clock, board view...), and a
 * random id for this visit (a new one every tab, nothing stored between visits). Never moves,
 * positions, names, IP-derived data or a device fingerprint.
 *
 * Off unless VITE_TELEMETRY_URL is set at build time. Also off when the browser sends Do Not
 * Track or Global Privacy Control.
 */

export type EventName = "setup_change" | "game_start" | "game_end" | "game_left" | "action";

export type Props = Record<string, string | number | boolean | null>;

const ENDPOINT: string | undefined = import.meta.env.VITE_TELEMETRY_URL;
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

/** Real visitors on the live site, as opposed to local builds and previews. */
function isLive(): boolean {
  return typeof location !== "undefined" && /(^|\.)jayfox\.design$/.test(location.hostname);
}

export function track(event: EventName, props: Props = {}) {
  if (import.meta.env.DEV) console.debug("[quick-chess telemetry]", event, props);
  if (!ENDPOINT || optedOut()) return;
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
    if (navigator.sendBeacon?.(ENDPOINT, blob)) return;
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true, mode: "no-cors" });
  } catch {
    // Counting is best effort: never let it get in the way of the game.
  }
}
