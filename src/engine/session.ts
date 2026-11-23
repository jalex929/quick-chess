import type { BotLevel } from "./bot";
import type { Clock } from "./clock";
import type { Color, Outcome } from "./game";

export type Mode = "bot" | "pass";

/** What the player picks before a game; remembered so the next game is one tap. */
export interface Settings {
  mode: Mode;
  level: BotLevel;
  /** Your side against the bot. */
  side: Color | "random";
  /** Time control id from TIME_CONTROLS, or null for no clock. */
  clock: string | null;
  /** Pass and play: turn the board for whoever's move it is, or keep it still (face to face). */
  passView: "flip" | "face";
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "bot",
  level: "easy",
  side: "w",
  clock: null,
  passView: "flip",
};

/** A game in progress or just finished. Everything needed to pick it back up after a reload. */
export interface Session {
  settings: Settings;
  /** Your actual side against the bot (after "random" is resolved). */
  human: Color;
  moves: string[];
  clock: Clock | null;
  /** Set when the game ends by resignation, time or agreement (board endings are derived). */
  ending: Outcome | null;
  startedAt: number;
}

const SETTINGS_KEY = "quick-chess:settings";
const SESSION_KEY = "quick-chess:game";

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage full: the game still plays, it just won't survive a reload.
  }
}

const isColor = (v: unknown): v is Color => v === "w" || v === "b";

export function loadSettings(): Settings {
  const s = read<Partial<Settings>>(SETTINGS_KEY) ?? {};
  return {
    mode: s.mode === "pass" ? "pass" : "bot",
    level: s.level === "medium" || s.level === "hard" || s.level === "expert" ? s.level : "easy",
    side: isColor(s.side) || s.side === "random" ? s.side : "w",
    clock: typeof s.clock === "string" ? s.clock : null,
    passView: s.passView === "face" ? "face" : "flip",
  };
}

export const saveSettings = (s: Settings) => write(SETTINGS_KEY, s);

export function loadSession(): Session | null {
  const s = read<Session>(SESSION_KEY);
  if (!s || !Array.isArray(s.moves) || !s.settings || !isColor(s.human)) return null;
  if (!s.moves.every((m) => typeof m === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)))
    return null;
  return { ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
}

export const saveSession = (s: Session | null) => write(SESSION_KEY, s);
