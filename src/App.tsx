import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { botColor, chooseMove, BOT_LEVELS } from "./engine/bot";
import {
  flagged,
  formatTime,
  newClock,
  pause,
  press,
  speakTime,
  start,
  timeControl,
  timeLeft,
  type Clock,
} from "./engine/clock";
import {
  COLOR_NAMES,
  Game,
  PIECE_NAMES,
  describeOutcome,
  fromUci,
  other,
  type Color,
  type Outcome,
  type PieceType,
  type PromotionPiece,
  type Square,
} from "./engine/game";
import {
  loadSession,
  loadSettings,
  saveSession,
  saveSettings,
  type Session,
  type Settings,
} from "./engine/session";
import { Board } from "./ui/Board";
import { PieceIcon } from "./ui/Pieces";
import { Setup } from "./ui/Setup";
import { GIF_PLIES } from "./ui/gifConstants";
import { play as playSound, setSoundOn, unlockAudio } from "./ui/sound";

const SOUND_KEY = "quick-chess:sound";
function loadSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === "on";
  } catch {
    return false;
  }
}

const BOT_MIN_DELAY = 450;

function newSession(settings: Settings): Session {
  const human: Color =
    settings.side === "random" ? (Math.random() < 0.5 ? "w" : "b") : settings.side;
  const tc = timeControl(settings.clock);
  return {
    settings,
    human,
    moves: [],
    clock: tc ? newClock(tc) : null,
    ending: null,
    startedAt: Date.now(),
  };
}

/** Pieces each side has lost, and who is ahead on material. */
function material(game: Game) {
  const start: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
  const left: Record<Color, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const row of game.chess.board()) for (const p of row) if (p) left[p.color][p.type]++;
  const worth: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const order: PieceType[] = ["q", "r", "b", "n", "p"];
  const lost = (c: Color) =>
    order.flatMap((t) => Array<PieceType>(Math.max(0, start[t] - left[c][t])).fill(t));
  const score = (c: Color) => order.reduce((s, t) => s + worth[t] * left[c][t], 0);
  return { lost, lead: score("w") - score("b") };
}

export function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [session, setSession] = useState<Session | null>(() => {
    const saved = loadSession();
    if (!saved) return null;
    // Coming back to a saved game: its clock waits until you press Resume.
    return saved.clock ? { ...saved, clock: { ...saved.clock, running: null } } : saved;
  });
  const [paused, setPaused] = useState(() => {
    const saved = loadSession();
    return !!saved?.clock && saved.moves.length > 0 && !saved.ending;
  });
  const [now, setNow] = useState(() => performance.now());
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(
    null,
  );
  const [thinking, setThinking] = useState(false);
  const [confirm, setConfirm] = useState<null | "resign" | "draw">(null);
  const [announcement, setAnnouncement] = useState("");
  const [showResult, setShowResult] = useState(true);
  const [copied, setCopied] = useState(false);
  const [gifState, setGifState] = useState<"idle" | "making" | "shared" | "downloaded" | "failed">(
    "idle",
  );

  const game = useMemo(() => new Game(session?.moves ?? []), [session?.moves]);
  const outcome: Outcome = session?.ending ?? game.outcome();
  const over = outcome.kind !== "playing";
  const mode = session?.settings.mode ?? settings.mode;
  const human = session?.human ?? "w";
  const bot = mode === "bot" ? botColor(human) : null;
  const clock = session?.clock ?? null;

  // ---- Saving ----
  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveSession(session), [session]);

  // ---- Sound (off unless turned on) ----
  const [sound, setSound] = useState(loadSound);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => setSoundOn(sound), [sound]);
  const toggleSound = () => {
    const next = !sound;
    if (next) unlockAudio();
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "on" : "off");
    } catch {
      // no storage: the choice lasts for this visit
    }
    if (next) playSound("move");
  };

  // A sound for each new move, picked from what it did.
  const heard = useRef(session?.moves.length ?? 0);
  useEffect(() => {
    const count = session?.moves.length ?? 0;
    const added = count === heard.current + 1;
    heard.current = count;
    if (!added || !soundRef.current || game.outcome().kind !== "playing") return;
    playSound(game.inCheck() ? "check" : game.lastWasCapture() ? "capture" : "move");
  }, [session?.moves, game]);

  // The end of a game, however it ended.
  const endedRef = useRef(true);
  useEffect(() => {
    const was = endedRef.current;
    endedRef.current = over;
    if (!over || was || !soundRef.current) return;
    const winner = "winner" in outcome ? outcome.winner : null;
    playSound(!winner ? "end-draw" : mode === "bot" && winner !== human ? "end-lose" : "end-win");
  }, [over, outcome, mode, human]);

  // ---- Announcements for screen readers ----
  const announceMove = useCallback((g: Game, who: string) => {
    const san = g.san().at(-1);
    const last = g.lastMove();
    if (!san || !last) return;
    const piece = g.pieceAt(last.to);
    const words = piece ? `${PIECE_NAMES[piece.type]} to ${last.to}` : san;
    const result = g.outcome();
    const tail =
      result.kind !== "playing"
        ? ` ${describeOutcome(result).detail}`
        : g.inCheck()
          ? " Check."
          : "";
    setAnnouncement(`${who} ${words}.${tail}`);
  }, []);

  // ---- Making moves ----
  const applyMove = useCallback(
    (uci: string, who: string) => {
      setSession((s) => {
        if (!s) return s;
        const current = new Game(s.moves);
        const next = current.play(fromUci(uci));
        if (!next) return s;
        const mover = current.turn();
        const t = performance.now();
        let c = s.clock ? press(s.clock, mover, t) : null;
        if (c && next.outcome().kind !== "playing") c = pause(c, t);
        announceMove(next, who);
        return { ...s, moves: next.moves, clock: c };
      });
      setConfirm(null);
    },
    [announceMove],
  );

  const onBoardMove = (from: Square, to: Square) => {
    if (game.isPromotion(from, to)) {
      setPendingPromotion({ from, to });
      return;
    }
    const who = mode === "bot" ? "You played" : `${COLOR_NAMES[game.turn()]} played`;
    applyMove(`${from}${to}`, who);
  };

  const promote = (piece: PromotionPiece) => {
    if (!pendingPromotion) return;
    const who = mode === "bot" ? "You played" : `${COLOR_NAMES[game.turn()]} played`;
    applyMove(`${pendingPromotion.from}${pendingPromotion.to}${piece}`, who);
    setPendingPromotion(null);
  };

  // ---- The bot ----
  const workerRef = useRef<Worker | null>(null);
  const requestRef = useRef(0);
  useEffect(() => {
    if (typeof Worker === "undefined") return;
    try {
      workerRef.current = new Worker(new URL("./engine/botWorker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      workerRef.current = null;
    }
    return () => workerRef.current?.terminate();
  }, []);

  const botTurn = !!session && bot === game.turn() && !over && !paused;
  useEffect(() => {
    if (!botTurn || !session) return;
    const id = ++requestRef.current;
    const moves = session.moves;
    const level = session.settings.level;
    const asked = performance.now();
    setThinking(true);
    let timer = 0;
    const deliver = (uci: string | null) => {
      if (id !== requestRef.current || !uci) return;
      const wait = Math.max(0, BOT_MIN_DELAY - (performance.now() - asked));
      timer = window.setTimeout(() => {
        if (id !== requestRef.current) return;
        setThinking(false);
        applyMove(uci, "Bot played");
      }, wait);
    };
    const worker = workerRef.current;
    if (worker) {
      const listener = (e: MessageEvent<{ id: number; uci: string | null }>) => {
        if (e.data.id === id) deliver(e.data.uci);
      };
      worker.addEventListener("message", listener);
      worker.postMessage({ id, moves, level });
      return () => {
        worker.removeEventListener("message", listener);
        window.clearTimeout(timer);
        requestRef.current++;
        setThinking(false);
      };
    }
    // No worker (tests, very old browsers): think on the main thread after a beat.
    timer = window.setTimeout(() => deliver(chooseMove(moves, level)?.uci ?? null), 30);
    return () => {
      window.clearTimeout(timer);
      requestRef.current++;
      setThinking(false);
    };
  }, [botTurn, session?.moves, session?.settings.level, applyMove]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Clock ----
  const clockRunning = !!clock?.running && !over;
  useEffect(() => {
    if (!clockRunning) return;
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = window.setTimeout(tick, 100);
    };
    tick();
    return () => window.clearTimeout(frame);
  }, [clockRunning]);

  const lastTick = useRef(-1);
  useEffect(() => {
    const c = session?.clock;
    if (!c?.running || over || !soundRef.current) return;
    if (mode === "bot" && c.running !== human) return;
    const left = timeLeft(c, c.running, now);
    const second = Math.ceil(left / 1000);
    if (left < 10_000 && second !== lastTick.current) {
      lastTick.current = second;
      playSound("tick");
    }
  }, [now, session?.clock, over, mode, human]);

  useEffect(() => {
    if (!session?.clock || over) return;
    const loser = flagged(session.clock, now);
    if (!loser) return;
    const winner = other(loser);
    const ending: Outcome = game.canMate(winner)
      ? { kind: "timeout", winner }
      : { kind: "timeout-draw" };
    setSession((s) => (s && s.clock ? { ...s, clock: pause(s.clock, now), ending } : s));
    setAnnouncement(`${describeOutcome(ending).title}. ${describeOutcome(ending).detail}`);
  }, [now, session?.clock, over, game]);

  // Leaving the tab pauses the clock; coming back shows Resume.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      setSession((s) => {
        if (!s?.clock?.running) return s;
        setPaused(true);
        return { ...s, clock: pause(s.clock, performance.now()) };
      });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);

  const pauseGame = () => {
    if (!session?.clock?.running) return;
    setSession({ ...session, clock: pause(session.clock, performance.now()) });
    setPaused(true);
  };
  const resumeGame = () => {
    setPaused(false);
    if (!session?.clock || session.moves.length === 0) return;
    const t = performance.now();
    setNow(t);
    setSession({ ...session, clock: start(session.clock, game.turn(), t) });
  };

  // When the game ends, the result card comes up; after checkmate it waits for the king to fall.
  const mated = outcome.kind === "checkmate" ? other(outcome.winner) : null;
  useEffect(() => {
    if (!over) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const animated = outcome.kind === "checkmate" || !("winner" in outcome);
    if (!animated || reduce) {
      setShowResult(true);
      return;
    }
    setShowResult(false);
    // Long enough to watch the king fall (or the board freeze) before the card covers it.
    const t = window.setTimeout(
      () => setShowResult(true),
      outcome.kind === "checkmate" ? 1300 : 1500,
    );
    return () => window.clearTimeout(t);
  }, [over]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Game actions ----
  const startGame = (s: Settings) => {
    setSettings(s);
    setSession(newSession(s));
    setPaused(false);
    setConfirm(null);
    setPendingPromotion(null);
    setCopied(false);
    setGifState("idle");
    setAnnouncement(
      s.mode === "bot" ? "New game against the bot." : "New pass and play game. White to move.",
    );
  };

  const canUndo =
    mode === "bot" &&
    !clock &&
    !over &&
    session !== null &&
    // There must be one of your moves to take back.
    session.moves.length >= (human === "w" ? 1 : 2);
  const undo = () => {
    if (!session || !canUndo) return;
    requestRef.current++;
    setThinking(false);
    const count = game.turn() === human ? 2 : 1;
    setSession({ ...session, moves: game.undo(count).moves });
    setAnnouncement("Move taken back.");
  };

  const resign = () => {
    if (!session) return;
    const loser = mode === "bot" ? human : game.turn();
    const ending: Outcome = { kind: "resigned", winner: other(loser) };
    setSession({
      ...session,
      ending,
      clock: session.clock ? pause(session.clock, performance.now()) : null,
    });
    setConfirm(null);
    setAnnouncement(`${describeOutcome(ending).title}. ${describeOutcome(ending).detail}`);
  };

  const agreeDraw = () => {
    if (!session) return;
    const ending: Outcome = { kind: "agreed" };
    setSession({
      ...session,
      ending,
      clock: session.clock ? pause(session.clock, performance.now()) : null,
    });
    setConfirm(null);
    setAnnouncement("Draw agreed.");
  };

  const copyPgn = async () => {
    if (!session) return;
    const date = new Date(session.startedAt);
    const names = (c: Color) =>
      mode === "bot"
        ? c === human
          ? "You"
          : `Quick Chess bot (${session.settings.level})`
        : COLOR_NAMES[c];
    const pgn = game.pgn(
      {
        Event: "Quick Chess",
        Date: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`,
        White: names("w"),
        Black: names("b"),
        ...(session.settings.clock ? { TimeControl: session.settings.clock } : {}),
      },
      outcome,
    );
    try {
      await navigator.clipboard.writeText(pgn);
      setCopied(true);
      setAnnouncement("Game copied as PGN.");
    } catch {
      setCopied(false);
      window.prompt("Copy the game (PGN):", pgn);
    }
  };

  const passView = session?.settings.passView ?? settings.passView;
  const orientation = useFlipOrientation(mode, passView, human, game.turn(), over);

  const shareGif = async () => {
    if (!session) return;
    setGifState("making");
    try {
      const { makeGameGif, shareOrDownload } = await import("./ui/gifExport");
      const winner = "winner" in outcome ? outcome.winner : null;
      const tone = !winner ? "draw" : mode === "bot" && winner !== human ? "lose" : "win";
      const script = endingScript(outcome, mode, tone);
      const how = describeOutcome(outcome).detail.replace(/\.$/, "");
      const bytes = await makeGameGif({
        moves: session.moves,
        orientation: mode === "bot" ? human : "w",
        banner: script.banner,
        subtitle: `${how} · ${Math.ceil(session.moves.length / 2)} moves`.slice(0, 44),
        tone,
      });
      const name = `quick-chess-${script.banner.toLowerCase().replace(/\s+/g, "-")}.gif`;
      setGifState(await shareOrDownload(bytes, name));
      setAnnouncement("Game GIF ready.");
    } catch {
      setGifState("failed");
    }
  };

  // ---- Screens ----
  if (!session) {
    return (
      <Shell sound={sound} onSound={toggleSound}>
        <Setup settings={settings} onChange={setSettings} onStart={startGame} />
        <Live text={announcement} />
      </Shell>
    );
  }

  const top = other(orientation);
  const bottom = orientation;
  const movable: Color[] =
    over || paused || pendingPromotion
      ? []
      : mode === "bot"
        ? game.turn() === human && !thinking
          ? [human]
          : []
        : [game.turn()];
  const mat = material(game);
  const winner = "winner" in outcome ? outcome.winner : null;
  // Pass and play has no "you", so a win is always a win for somebody.
  const endTone: "win" | "lose" | "draw" = !winner
    ? "draw"
    : mode === "bot" && winner !== human
      ? "lose"
      : "win";
  const { lines: endLines, banner: endBanner } = endingScript(outcome, mode, endTone);
  const result = describeOutcome(outcome);

  const name = (c: Color) =>
    mode === "bot"
      ? c === human
        ? "You"
        : `Bot · ${BOT_LEVELS.find((l) => l.id === session.settings.level)!.label}`
      : COLOR_NAMES[c];

  const status = over
    ? `${result.title}. ${result.detail}`
    : paused
      ? "Paused"
      : mode === "bot"
        ? game.turn() === human
          ? game.inCheck()
            ? "Check! Your move."
            : "Your move"
          : "Bot is thinking…"
        : `${COLOR_NAMES[game.turn()]} to move${game.inCheck() ? ": check!" : ""}`;

  const faceToFace = mode === "pass" && passView === "face";

  return (
    <Shell
      sound={sound}
      onSound={toggleSound}
      actions={
        <button type="button" className="button" onClick={() => setSession(null)}>
          New game
        </button>
      }
    >
      <main className="table">
        <div className="table__play">
          <PlayerBar
            color={top}
            name={name(top)}
            active={!over && game.turn() === top}
            clock={clock}
            now={now}
            lost={mat.lost(other(top))}
            lead={top === "w" ? mat.lead : -mat.lead}
            flipped={faceToFace}
            thinking={thinking && bot === top}
          />
          <div className="board-wrap">
            <Board
              game={game}
              orientation={orientation}
              movable={movable}
              onMove={onBoardMove}
              upsideDown={faceToFace ? "b" : null}
              mated={mated}
              mateTone={endTone === "win" ? "win" : "lose"}
              drawn={over && endTone === "draw"}
            />
            {pendingPromotion && (
              <Promotion
                color={game.turn()}
                onPick={promote}
                onCancel={() => setPendingPromotion(null)}
              />
            )}
            {paused && !over && (
              <div className="board-overlay">
                <div className="card" role="dialog" aria-label="Game paused">
                  <h2 className="card__title">Paused</h2>
                  <p className="card__text">The clocks are stopped.</p>
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={resumeGame}
                    autoFocus
                  >
                    Resume
                  </button>
                </div>
              </div>
            )}
            {over && showResult && (
              <section
                className={`result-hud result-hud--${endTone}`}
                aria-labelledby="result-title"
              >
                <Terminal lines={endLines} banner={endBanner} tone={endTone} />
                <h2 id="result-title" className="result-hud__title">
                  {mode === "bot" && "winner" in outcome
                    ? outcome.winner === human
                      ? "You win!"
                      : "The bot wins"
                    : endTone === "draw"
                      ? (DRAW_NAMES[outcome.kind] ?? "Draw")
                      : result.title}
                </h2>
                <p className="result-hud__text">{result.detail}</p>
                <button
                  type="button"
                  className="result-hud__close"
                  onClick={() => setShowResult(false)}
                  aria-label="Hide result"
                >
                  ×
                </button>
              </section>
            )}
          </div>
          <PlayerBar
            color={bottom}
            name={name(bottom)}
            active={!over && game.turn() === bottom}
            clock={clock}
            now={now}
            lost={mat.lost(other(bottom))}
            lead={bottom === "w" ? mat.lead : -mat.lead}
            thinking={thinking && bot === bottom}
          />
        </div>

        <aside className="table__side">
          <p className="status" aria-hidden="true">
            {status}
          </p>
          {confirm === "resign" ? (
            <div className="confirm" role="group" aria-label="Confirm resignation">
              <p>{mode === "bot" ? "Resign this game?" : `${COLOR_NAMES[game.turn()]} resigns?`}</p>
              <button type="button" className="button button--danger" onClick={resign} autoFocus>
                Yes, resign
              </button>
              <button type="button" className="button" onClick={() => setConfirm(null)}>
                Keep playing
              </button>
            </div>
          ) : confirm === "draw" ? (
            <div className="confirm" role="group" aria-label="Draw offer">
              <p>
                {COLOR_NAMES[game.turn()]} offers a draw. {COLOR_NAMES[other(game.turn())]}, do you
                accept?
              </p>
              <button
                type="button"
                className="button button--primary"
                onClick={agreeDraw}
                autoFocus
              >
                Accept draw
              </button>
              <button type="button" className="button" onClick={() => setConfirm(null)}>
                Decline
              </button>
            </div>
          ) : over ? (
            <div className="end-actions" role="group" aria-label="Game over">
              <div className="end-actions__row">
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => startGame(session.settings)}
                >
                  Play again
                </button>
                <button type="button" className="button" onClick={() => setSession(null)}>
                  Main menu
                </button>
              </div>
              <button
                type="button"
                className="button button--gif"
                onClick={() => void shareGif()}
                disabled={gifState === "making"}
                aria-describedby="gif-note"
              >
                {gifState === "making"
                  ? "Making GIF…"
                  : gifState === "downloaded"
                    ? "GIF saved ✓"
                    : gifState === "shared"
                      ? "Shared ✓"
                      : "Share GIF"}
              </button>
              <p id="gif-note" className="card__note">
                {gifState === "failed"
                  ? "Couldn't make the GIF on this device."
                  : `An animated replay of the last ${GIF_PLIES} moves.`}
              </p>
              <div className="end-actions__row">
                <button type="button" className="link-button" onClick={() => void copyPgn()}>
                  {copied ? "Copied!" : "Copy game (PGN)"}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setShowResult((v) => !v)}
                >
                  {showResult ? "Hide result" : "Show result"}
                </button>
              </div>
            </div>
          ) : (
            <div className="controls">
              {mode === "bot" && (
                <button
                  type="button"
                  className="button"
                  onClick={undo}
                  disabled={!canUndo}
                  title={clock ? "Undo is off in timed games" : "Take back your last move"}
                >
                  Undo
                </button>
              )}
              {mode === "pass" && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setConfirm("draw")}
                  disabled={over}
                >
                  Offer draw
                </button>
              )}
              {clock && !over && (
                <button
                  type="button"
                  className="button"
                  onClick={paused ? resumeGame : pauseGame}
                  disabled={!paused && !clock.running}
                >
                  {paused ? "Resume" : "Pause"}
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => setConfirm("resign")}
                disabled={over}
              >
                Resign
              </button>
            </div>
          )}
          <MoveList san={game.san()} />
        </aside>
      </main>
      <Live text={announcement} />
    </Shell>
  );
}

/**
 * Which side is at the bottom. Against the bot: yours. Pass and play "flip": whoever is to
 * move, turned a moment after the move lands so you see it happen. Face to face: White.
 */
function useFlipOrientation(
  mode: Settings["mode"],
  view: Settings["passView"],
  human: Color,
  turn: Color,
  over: boolean,
) {
  const target: Color = mode === "bot" ? human : view === "flip" && !over ? turn : "w";
  const [shown, setShown] = useState<Color>(target);
  useEffect(() => {
    if (target === shown) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(() => setShown(target), mode === "pass" && !reduce ? 600 : 0);
    return () => window.clearTimeout(t);
  }, [target, shown, mode]);
  return mode === "pass" && view === "flip" && !over ? shown : target;
}

/** The heading on the result card for each kind of draw (the banner already says DRAW). */
const DRAW_NAMES: Record<string, string> = {
  stalemate: "Stalemate",
  repetition: "Threefold repetition",
  "fifty-moves": "Fifty-move rule",
  insufficient: "Dead position",
  agreed: "Draw agreed",
  "timeout-draw": "Draw on time",
};

/** What the result terminal types out for each kind of ending. */
function endingScript(
  outcome: Outcome,
  mode: Settings["mode"],
  tone: "win" | "lose" | "draw",
): { lines: string[]; banner: string } {
  const winner = "winner" in outcome ? outcome.winner : null;
  if (mode === "pass" && winner) {
    const w = COLOR_NAMES[winner].toUpperCase();
    const l = COLOR_NAMES[other(winner)].toUpperCase();
    const how =
      outcome.kind === "checkmate"
        ? [`> ${w} breached ${l}'s defenses`, `> ${l.toLowerCase()}.king.status = OFFLINE`]
        : outcome.kind === "timeout"
          ? [`> ${l} clock: 00:00`, `> ${l.toLowerCase()}.link = TIMED OUT`]
          : [`> ${l} pulled the plug`, `> ${l.toLowerCase()}.link = CLOSED`];
    return { lines: how, banner: `${w} WINS` };
  }
  if (tone === "draw") {
    const why: Record<string, string> = {
      stalemate: "> no legal moves, no check",
      repetition: "> loop detected: same position x3",
      "fifty-moves": "> 50 moves, no progress",
      insufficient: "> not enough pieces left to mate",
      agreed: "> both sides agreed",
      "timeout-draw": "> time out, but no mating material",
    };
    return { lines: [why[outcome.kind] ?? "> no winner", "> both kings ONLINE"], banner: "DRAW" };
  }
  if (tone === "win") {
    const how =
      outcome.kind === "checkmate"
        ? ["> breaching enemy king...", "> king.status = OFFLINE"]
        : outcome.kind === "timeout"
          ? ["> enemy clock: 00:00", "> bot.link = TIMED OUT"]
          : ["> bot disconnected", "> bot.link = CLOSED"];
    return { lines: ["> link: OK", ...how], banner: "VICTORY" };
  }
  const how =
    outcome.kind === "checkmate"
      ? ["> intrusion detected", "> your.king.status = OFFLINE"]
      : outcome.kind === "timeout"
        ? ["> your clock: 00:00", "> link TIMED OUT"]
        : ["> you pulled the plug", "> link CLOSED"];
  return { lines: [...how, "> connection lost"], banner: "DEFEAT" };
}

/**
 * Types its lines out one character at a time, then drops the banner in with a glitch.
 * Decorative: the heading and text below say the same thing for screen readers.
 */
function Terminal({
  lines,
  banner,
  tone,
}: {
  lines: string[];
  banner: string;
  tone: "win" | "lose" | "draw";
}) {
  const full = lines.join("\n");
  const reduce =
    typeof window !== "undefined" &&
    !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // The result word lands first; the log starts typing under it once its glitch settles.
  const [typed, setTyped] = useState(reduce ? full.length : -1);
  useEffect(() => {
    if (typed >= full.length) return;
    const delay = typed < 0 ? 520 : full[typed] === "\n" ? 140 : 20;
    const t = window.setTimeout(() => setTyped((n) => n + 1), delay);
    return () => window.clearTimeout(t);
  }, [typed, full]);
  const shown = Math.max(0, typed);
  const done = shown >= full.length;
  return (
    <div className={`terminal terminal--${tone}`} aria-hidden="true">
      <span className="terminal__banner">{banner}</span>
      <pre className="terminal__log">
        {full.slice(0, shown)}
        {typed >= 0 && !done && <span className="terminal__cursor" />}
      </pre>
    </div>
  );
}

function Shell({
  children,
  actions,
  sound,
  onSound,
}: {
  children: React.ReactNode;
  actions?: React.ReactNode;
  sound: boolean;
  onSound: () => void;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <a className="topbar__home" href="https://jayfox.design" aria-label="Back to jayfox.design">
          <span aria-hidden="true">←</span>
          <span className="topbar__home-text">jayfox.design</span>
        </a>
        <h1 className="topbar__title">Quick Chess</h1>
        <div className="topbar__actions">
          <button
            type="button"
            className="button button--icon"
            aria-pressed={sound}
            onClick={onSound}
            title={sound ? "Sound on" : "Sound off"}
          >
            <SoundIcon on={sound} />
            <span className="visually-hidden">Sound effects</span>
          </button>
          {actions}
        </div>
      </header>
      {children}
    </div>
  );
}

function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {on ? (
        <>
          <path d="M16.5 8.5a5 5 0 0 1 0 7" />
          <path d="M19 6a8.5 8.5 0 0 1 0 12" />
        </>
      ) : (
        <path d="M17 9l5 6M22 9l-5 6" />
      )}
    </svg>
  );
}

function Live({ text }: { text: string }) {
  return (
    <div className="visually-hidden" aria-live="polite" role="status">
      {text}
    </div>
  );
}

function PlayerBar({
  color,
  name,
  active,
  clock,
  now,
  lost,
  lead,
  flipped = false,
  thinking = false,
}: {
  color: Color;
  name: string;
  active: boolean;
  clock: Clock | null;
  now: number;
  /** The opponent's pieces this player has taken. */
  lost: PieceType[];
  /** Material lead in pawns (negative when behind). */
  lead: number;
  flipped?: boolean;
  thinking?: boolean;
}) {
  const left = clock ? timeLeft(clock, color, now) : 0;
  const low = clock ? left < 20_000 : false;
  return (
    <div
      className={`player ${active ? "player--active" : ""} ${flipped ? "player--flipped" : ""}`}
      aria-label={`${name}, playing ${COLOR_NAMES[color]}${active ? ", to move" : ""}`}
    >
      <span className={`player__swatch player__swatch--${color}`} aria-hidden="true" />
      <span className="player__name">
        {name}
        {thinking && <span className="player__thinking">thinking…</span>}
      </span>
      <span
        className="player__taken"
        aria-label={
          lost.length ? `Captured: ${lost.map((t) => PIECE_NAMES[t]).join(", ")}` : undefined
        }
      >
        {lost.map((t, i) => (
          <PieceIcon key={i} type={t} color={other(color)} className="player__taken-piece" />
        ))}
        {lead > 0 && <span className="player__lead">+{lead}</span>}
      </span>
      {clock && (
        <span
          className={`player__clock ${active && clock.running ? "player__clock--running" : ""} ${low ? "player__clock--low" : ""}`}
          role="timer"
          aria-label={`${speakTime(left)} left`}
        >
          {active && clock.running && <span className="player__clock-dot" aria-hidden="true" />}
          {formatTime(left)}
        </span>
      )}
    </div>
  );
}

function Promotion({
  color,
  onPick,
  onCancel,
}: {
  color: Color;
  onPick: (p: PromotionPiece) => void;
  onCancel: () => void;
}) {
  const choices: PromotionPiece[] = ["q", "r", "b", "n"];
  return (
    <div
      className="board-overlay"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="card" role="dialog" aria-labelledby="promo-title">
        <h2 id="promo-title" className="card__title">
          Promote your pawn
        </h2>
        <div className="promotion">
          {choices.map((p, i) => (
            <button
              key={p}
              type="button"
              className="promotion__choice"
              onClick={() => onPick(p)}
              autoFocus={i === 0}
            >
              <PieceIcon type={p} color={color} />
              <span>{PIECE_NAMES[p][0]!.toUpperCase() + PIECE_NAMES[p].slice(1)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="link-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function MoveList({ san }: { san: string[] }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [san.length]);
  const pairs: [string, string | undefined][] = [];
  for (let i = 0; i < san.length; i += 2) pairs.push([san[i]!, san[i + 1]]);
  return (
    <section className="moves" aria-labelledby="moves-heading">
      <h2 id="moves-heading" className="panel__heading">
        Moves
      </h2>
      {pairs.length === 0 ? (
        <p className="moves__empty">No moves yet.</p>
      ) : (
        <ol ref={ref} className="moves__list">
          {pairs.map(([w, b], i) => (
            <li key={i}>
              <span className="moves__white">{w}</span>
              <span className="moves__black">{b ?? ""}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
