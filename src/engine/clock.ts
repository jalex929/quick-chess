import type { Color } from "./game";

/** Minutes + increment seconds, e.g. 3+2. `null` means no clock. */
export interface TimeControl {
  id: string;
  label: string;
  /** Plain-language meaning, for anyone new to chess clocks. */
  hint: string;
  /** The usual name for this pace of game. */
  kind: "Blitz" | "Rapid";
  /** Starting time per side, in ms. */
  base: number;
  /** Added after each of your moves, in ms. */
  increment: number;
}

export const TIME_CONTROLS: TimeControl[] = [
  {
    id: "3+2",
    label: "3 + 2",
    hint: "3 min each, +2 sec per move",
    kind: "Blitz",
    base: 3 * 60_000,
    increment: 2_000,
  },
  { id: "5+0", label: "5 min", hint: "5 min each", kind: "Blitz", base: 5 * 60_000, increment: 0 },
  {
    id: "10+0",
    label: "10 min",
    hint: "10 min each",
    kind: "Rapid",
    base: 10 * 60_000,
    increment: 0,
  },
  {
    id: "15+10",
    label: "15 + 10",
    hint: "15 min each, +10 sec per move",
    kind: "Rapid",
    base: 15 * 60_000,
    increment: 10_000,
  },
];

export function timeControl(id: string | null): TimeControl | null {
  return TIME_CONTROLS.find((t) => t.id === id) ?? null;
}

/**
 * A chess clock as plain data. `running` is whose time is going down, and `since` is when
 * it started going down; remaining time is only written back when the clock is pressed or
 * paused, so the clock never drifts however often (or rarely) the screen redraws.
 */
export interface Clock {
  remaining: Record<Color, number>;
  increment: number;
  running: Color | null;
  since: number;
}

export function newClock(tc: TimeControl): Clock {
  return {
    remaining: { w: tc.base, b: tc.base },
    increment: tc.increment,
    running: null,
    since: 0,
  };
}

/** Time left for `color` at `now`. */
export function timeLeft(clock: Clock, color: Color, now: number): number {
  const base = clock.remaining[color];
  return clock.running === color ? Math.max(0, base - (now - clock.since)) : base;
}

/** Who has run out of time at `now`, if anyone. */
export function flagged(clock: Clock, now: number): Color | null {
  if (!clock.running) return null;
  return timeLeft(clock, clock.running, now) <= 0 ? clock.running : null;
}

/** Start `color`'s time (first move of the game, or resuming after a pause). */
export function start(clock: Clock, color: Color, now: number): Clock {
  return { ...clock, running: color, since: now };
}

/** Stop everyone's time, keeping what's left. */
export function pause(clock: Clock, now: number): Clock {
  if (!clock.running) return clock;
  const c = clock.running;
  return {
    ...clock,
    remaining: { ...clock.remaining, [c]: timeLeft(clock, c, now) },
    running: null,
  };
}

/**
 * `mover` just moved: their time stops, they get the increment, and the other side's
 * time starts. Before the first press nobody's time is running; the first press only
 * starts the opponent (no increment for a move made before the clock started).
 */
export function press(clock: Clock, mover: Color, now: number): Clock {
  const next: Color = mover === "w" ? "b" : "w";
  if (clock.running !== mover) return { ...clock, running: next, since: now };
  const left = timeLeft(clock, mover, now);
  return {
    ...clock,
    remaining: { ...clock.remaining, [mover]: left + clock.increment },
    running: next,
    since: now,
  };
}

/** "4:59", "0:09.4" under 10 seconds, "1:02:00" over an hour. */
export function formatTime(ms: number): string {
  const total = Math.max(0, ms);
  if (total < 10_000) {
    const tenths = Math.floor(total / 100);
    return `0:0${Math.floor(tenths / 10)}.${tenths % 10}`;
  }
  const s = Math.ceil(total / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Spoken form for screen readers: "4 minutes 59 seconds". */
export function speakTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (s % 60 || !m) parts.push(`${s % 60} second${s % 60 === 1 ? "" : "s"}`);
  return parts.join(" ");
}
