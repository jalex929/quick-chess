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

  // When the game ends, the result card comes back up.
  useEffect(() => {
    if (over) setShowResult(true);
  }, [over]);

  // ---- Game actions ----
  const startGame = (s: Settings) => {
    setSettings(s);
    setSession(newSession(s));
    setPaused(false);
    setConfirm(null);
    setPendingPromotion(null);
    setCopied(false);
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

  // ---- Screens ----
  if (!session) {
    return (
      <Shell>
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
              <div className="board-overlay board-overlay--result">
                <div className="card" role="dialog" aria-labelledby="result-title">
                  <h2 id="result-title" className="card__title">
                    {mode === "bot" && "winner" in outcome
                      ? outcome.winner === human
                        ? "You win!"
                        : "The bot wins"
                      : result.title}
                  </h2>
                  <p className="card__text">{result.detail}</p>
                  <div className="card__actions">
                    <button
                      type="button"
                      className="button button--primary"
                      onClick={() => startGame(session.settings)}
                      autoFocus
                    >
                      Play again
                    </button>
                    <button type="button" className="button" onClick={() => setSession(null)}>
                      Change settings
                    </button>
                  </div>
                  <div className="card__actions card__actions--quiet">
                    <button type="button" className="link-button" onClick={() => void copyPgn()}>
                      {copied ? "Copied!" : "Copy game (PGN)"}
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setShowResult(false)}
                    >
                      See the board
                    </button>
                  </div>
                </div>
              </div>
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
              {over && !showResult && (
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => setShowResult(true)}
                >
                  Result
                </button>
              )}
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

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="app">
      <header className="topbar">
        <a className="topbar__home" href="https://jayfox.design" aria-label="Back to jayfox.design">
          <span aria-hidden="true">←</span>
          <span className="topbar__home-text">jayfox.design</span>
        </a>
        <h1 className="topbar__title">Quick Chess</h1>
        <div className="topbar__actions">{actions}</div>
      </header>
      {children}
    </div>
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
