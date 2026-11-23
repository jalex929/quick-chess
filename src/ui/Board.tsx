import { useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_SQUARES,
  COLOR_NAMES,
  PIECE_NAMES,
  isLightSquare,
  type Color,
  type Game,
  type Piece,
  type Square,
} from "../engine/game";
import { PieceIcon } from "./Pieces";
import { playIfOn, setStaticBedLevel, startStaticBed, stopStaticBed } from "./sound";

interface Props {
  game: Game;
  /** Which side sits at the bottom. */
  orientation: Color;
  /** Which colors the person at this screen may move right now (empty while the bot thinks). */
  movable: Color[];
  onMove: (from: Square, to: Square) => void;
  /** Show the coordinates a–h / 1–8 along the edges. */
  coordinates?: boolean;
  /** How far each side's pieces are turned, in degrees (pass and play with the board still). */
  pieceAngles?: Record<Color, number>;
  /** Animate the pieces turning (when they follow whoever's move it is). */
  turning?: boolean;
  /** Checkmate: the losing king topples and that side's pieces flicker out. */
  mated?: Color | null;
  /** Checkmate colors: acid green when you won, red when you lost. */
  mateTone?: "win" | "lose";
  /** A drawn game: the board freezes in amber, both kings locked in place. */
  drawn?: boolean;
}

const fileIndex = (sq: Square) => sq.charCodeAt(0) - 97;
const rankIndex = (sq: Square) => Number(sq[1]) - 1;
const squareAt = (file: number, rank: number) =>
  `${String.fromCharCode(97 + file)}${rank + 1}` as Square;

/** Squares in screen order (top-left first) for this orientation. */
function screenOrder(orientation: Color): Square[] {
  return orientation === "w" ? ALL_SQUARES : [...ALL_SQUARES].reverse();
}

interface Drag {
  from: Square;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
  /** The piece was already selected when pressed: a tap without moving deselects it. */
  wasSelected: boolean;
}

export function Board({
  game,
  orientation,
  movable,
  onMove,
  coordinates = true,
  pieceAngles,
  turning = false,
  mated = null,
  mateTone = "lose",
  drawn = false,
}: Props) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [focus, setFocus] = useState<Square>(orientation === "w" ? "e2" : "e7");
  const [drag, setDrag] = useState<Drag | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const squareRefs = useRef(new Map<Square, HTMLButtonElement>());
  /** When the last touch or mouse press happened: the click that follows it is not a key press. */
  const lastPointer = useRef(-Infinity);
  /** The position before this one, to work out what just moved (for animation). */
  const prevGame = useRef<Game | null>(null);
  /** A move made by dragging lands where it was dropped, so it doesn't slide. */
  const droppedOn = useRef<Square | null>(null);

  const order = useMemo(() => screenOrder(orientation), [orientation]);
  const targets = useMemo(
    () => (selected ? new Set(game.targets(selected)) : new Set<Square>()),
    [game, selected],
  );
  const last = game.lastMove();
  const checked = game.checkedKing();

  const animation = useMemo(() => describeMove(prevGame.current, game, droppedOn.current), [game]);

  // A new position (a move was made, undone or the board reset): drop any selection.
  useEffect(() => {
    setSelected(null);
    setDrag(null);
    prevGame.current = game;
    droppedOn.current = null;
  }, [game]);

  const canPick = (sq: Square) => {
    const p = game.pieceAt(sq);
    return !!p && p.color === game.turn() && movable.includes(p.color);
  };

  const tryMove = (from: Square, to: Square) => {
    if (!game.targets(from).includes(to)) return false;
    onMove(from, to);
    setSelected(null);
    return true;
  };

  /** Tap or Enter on a square. */
  const activate = (sq: Square) => {
    if (selected && targets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (selected === sq) setSelected(null);
    else if (canPick(sq)) setSelected(sq);
    else setSelected(null);
  };

  const squareFromPoint = (x: number, y: number): Square | null => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const col = Math.floor(((x - rect.left) / rect.width) * 8);
    const row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return order[row * 8 + col] ?? null;
  };

  const onPointerDown = (event: React.PointerEvent, sq: Square) => {
    if (event.button !== 0) return;
    lastPointer.current = performance.now();
    setFocus(sq);
    if (selected && targets.has(sq)) {
      tryMove(selected, sq);
      return;
    }
    if (!canPick(sq)) {
      setSelected(null);
      return;
    }
    event.preventDefault();
    boardRef.current?.setPointerCapture(event.pointerId);
    setDrag({
      from: sq,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      moved: false,
      wasSelected: selected === sq,
    });
    setSelected(sq);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved =
      drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6;
    setDrag({ ...drag, x: event.clientX, y: event.clientY, moved });
  };

  const onPointerUp = (event: React.PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const to = squareFromPoint(event.clientX, event.clientY);
    if (drag.moved) {
      if (to && to !== drag.from) {
        droppedOn.current = to;
        if (!tryMove(drag.from, to)) droppedOn.current = null;
      }
    } else if (drag.wasSelected) {
      setSelected(null); // a second tap on the same piece puts it down
    }
    setDrag(null);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const steps: Record<string, [number, number]> = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const step = steps[event.key];
    if (step) {
      event.preventDefault();
      // Arrow keys move on screen, so flip them when Black is at the bottom.
      const dir = orientation === "w" ? 1 : -1;
      const f = Math.min(7, Math.max(0, fileIndex(focus) + step[0] * dir));
      const r = Math.min(7, Math.max(0, rankIndex(focus) + step[1] * dir));
      const next = squareAt(f, r);
      setFocus(next);
      squareRefs.current.get(next)?.focus();
    } else if (event.key === "Escape" && selected) {
      event.preventDefault();
      setSelected(null);
    }
  };

  const label = (sq: Square) => {
    const p = game.pieceAt(sq);
    const parts = [
      sq,
      p ? `${COLOR_NAMES[p.color].toLowerCase()} ${PIECE_NAMES[p.type]}` : "empty",
    ];
    if (sq === selected) parts.push("selected");
    if (targets.has(sq)) parts.push(p ? "can capture" : "can move here");
    if (sq === checked) parts.push("in check");
    if (last && (sq === last.from || sq === last.to)) parts.push("last move");
    return parts.join(", ");
  };

  const dragOffset = (() => {
    if (!drag?.moved) return null;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const size = rect.width / 8;
    return { x: drag.x - rect.left - size / 2, y: drag.y - rect.top - size / 2, size };
  })();

  return (
    <div className="board-frame">
      <div
        ref={boardRef}
        className={`board ${drag?.moved ? "board--dragging" : ""} ${mateTone === "win" ? "board--win" : ""} ${drawn ? "board--draw" : ""} ${turning ? "board--turning" : ""}`}
        style={
          pieceAngles
            ? ({
                "--turn-w": `${pieceAngles.w}deg`,
                "--turn-b": `${pieceAngles.b}deg`,
              } as React.CSSProperties)
            : undefined
        }
        role="grid"
        aria-label={`Chess board, ${COLOR_NAMES[orientation]} at the bottom. Arrow keys move between squares; Enter picks up and puts down a piece.`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKeyDown}
      >
        {[0, 1, 2, 3, 4, 5, 6, 7].map((row) => (
          <div key={row} role="row" className="board__row">
            {order.slice(row * 8, row * 8 + 8).map((sq, col) => {
              const piece = game.pieceAt(sq);
              const hidden = drag?.moved && drag.from === sq;
              const slide = animation?.slides.find((m) => m.to === sq);
              const ghost = animation?.captured?.square === sq ? animation.captured : null;
              const classes = [
                "square",
                isLightSquare(sq) ? "square--light" : "square--dark",
                sq === selected && "square--selected",
                last && (sq === last.from || sq === last.to) && "square--last",
                sq === checked && !mated && "square--check",
                mated && piece?.type === "k" && piece.color === mated && "square--mated",
                drawn && piece?.type === "k" && "square--frozen",
                targets.has(sq) && (piece ? "square--capture" : "square--target"),
                slide && "square--moving",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <button
                  key={sq}
                  ref={(el) => {
                    if (el) squareRefs.current.set(sq, el);
                    else squareRefs.current.delete(sq);
                  }}
                  type="button"
                  role="gridcell"
                  className={classes}
                  data-square={sq}
                  aria-label={label(sq)}
                  aria-selected={sq === selected}
                  tabIndex={sq === focus ? 0 : -1}
                  onFocus={() => setFocus(sq)}
                  onPointerDown={(e) => onPointerDown(e, sq)}
                  onClick={() => {
                    // Pointer presses are handled on pointerdown/up. A click with no press
                    // just before it came from the keyboard (Enter or Space).
                    if (performance.now() - lastPointer.current > 800) activate(sq);
                  }}
                >
                  {coordinates && col === 0 && (
                    <span className="square__rank" aria-hidden="true">
                      {sq[1]}
                    </span>
                  )}
                  {coordinates && row === 7 && (
                    <span className="square__file" aria-hidden="true">
                      {sq[0]}
                    </span>
                  )}
                  {ghost && (
                    <span key={`x${animation!.key}`} className="captured-ghost" aria-hidden="true">
                      <PieceIcon
                        type={ghost.piece.type}
                        color={ghost.piece.color}
                        className="piece"
                      />
                      <PieceIcon
                        type={ghost.piece.type}
                        color={ghost.piece.color}
                        className="piece captured-ghost__echo"
                      />
                    </span>
                  )}
                  {piece && !hidden && mated === piece.color && piece.type === "k" ? (
                    <KingFall color={piece.color} tone={mateTone} />
                  ) : piece && !hidden ? (
                    <span
                      key={slide ? `s${animation!.key}` : "still"}
                      className={[
                        "piece-wrap",
                        slide && "piece-wrap--slide",
                        mated === piece.color && "piece-wrap--fading",
                        drawn &&
                          (piece.type === "k" ? "piece-wrap--frozen" : "piece-wrap--stalled"),
                        sq === checked && !mated && "piece-wrap--check",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={slide ? slideOffset(slide.from, slide.to, orientation) : undefined}
                    >
                      <PieceIcon type={piece.type} color={piece.color} className="piece" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        {(mated || drawn) && <div className="board__sweep" aria-hidden="true" />}
        {dragOffset && drag && game.pieceAt(drag.from) && (
          <div
            className="drag-ghost"
            style={{
              width: dragOffset.size,
              height: dragOffset.size,
              transform: `translate(${dragOffset.x}px, ${dragOffset.y}px) scale(1.12)`,
            }}
            aria-hidden="true"
          >
            <PieceIcon
              type={game.pieceAt(drag.from)!.type}
              color={game.pieceAt(drag.from)!.color}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface MoveAnimation {
  /** Changes with every move, so each one animates exactly once. */
  key: number;
  /** Pieces sliding (the rook too, when castling). */
  slides: { from: Square; to: Square }[];
  /** The piece that was taken and where it stood (en passant: not the landing square). */
  captured: { square: Square; piece: Piece } | null;
}

/** What changed between two positions one move apart, or null (new game, undo, reload). */
function describeMove(prev: Game | null, game: Game, dropped: Square | null): MoveAnimation | null {
  if (!prev || game.moves.length !== prev.moves.length + 1) return null;
  const m = game.lastMove();
  if (!m) return null;
  const mover = prev.pieceAt(m.from);
  if (!mover) return null;
  const slides = dropped === m.to ? [] : [{ from: m.from, to: m.to }];
  if (mover.type === "k" && Math.abs(fileIndex(m.to) - fileIndex(m.from)) === 2) {
    const rank = m.from[1];
    const kingside = fileIndex(m.to) > fileIndex(m.from);
    slides.push({
      from: `${kingside ? "h" : "a"}${rank}` as Square,
      to: `${kingside ? "f" : "d"}${rank}` as Square,
    });
  }
  let captured: MoveAnimation["captured"] = null;
  const taken = prev.pieceAt(m.to);
  if (taken) captured = { square: m.to, piece: taken };
  else if (mover.type === "p" && m.from[0] !== m.to[0]) {
    const square = `${m.to[0]}${m.from[1]}` as Square;
    const pawn = prev.pieceAt(square);
    if (pawn) captured = { square, piece: pawn };
  }
  return { key: game.moves.length, slides, captured };
}

/** Where a sliding piece starts, relative to its new square, in square widths. */
function slideOffset(from: Square, to: Square, orientation: Color): React.CSSProperties {
  const dir = orientation === "w" ? 1 : -1;
  const dx = (fileIndex(from) - fileIndex(to)) * dir;
  const dy = (rankIndex(to) - rankIndex(from)) * dir;
  const distance = Math.hypot(dx, dy);
  return {
    "--dx": `${dx * 100}%`,
    "--dy": `${dy * 100}%`,
    // Longer moves take a little longer, but never drag.
    "--slide-ms": `${Math.round(Math.min(320, 150 + distance * 25))}ms`,
  } as React.CSSProperties;
}

interface Glow {
  top: number;
  bottom: number;
  shift: number;
  o: number;
  /** Thick, soft bands of color (top, height, left, width and strength, in % of the square). */
  bands: { y: number; h: number; x: number; w: number; a: number }[];
}

/**
 * A fresh glow: thick horizontal bands, widest near the middle of the square, each nudged
 * sideways; the same shapes as the static lines and slice tears, but softer and broader.
 */
function newGlow(top: number, bottom: number, shift: number, o: number): Glow {
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  const count = 4 + Math.floor(Math.random() * 4);
  return {
    top,
    bottom,
    shift,
    o,
    bands: Array.from({ length: count }, () => {
      const y = r(8, 84);
      const fromMiddle = Math.abs(y + 6 - 50) / 50; // 0 in the middle, 1 at the edge
      const w = r(55, 105) * (1 - fromMiddle * 0.55);
      return { y, h: r(6, 16), x: 50 - w / 2 + r(-12, 12), w, a: r(0.18, 0.42) };
    }),
  };
}

interface Crackle {
  /** Slice of the ghost that shows during the tear (inset top / bottom, %). */
  top: number;
  bottom: number;
  shift: number;
  /** Static lines across the square (top %, and a sideways nudge). */
  lines: { y: number; dx: number; w: number }[];
}

/**
 * The mated king leaves the board the way captured pieces do (torn slices and a split-color
 * echo), slower and in the ending's color, and is never seen whole again: afterwards it only
 * flickers back as torn slices at random moments, with a few static lines.
 */
function KingFall({ color, tone }: { color: Color; tone: "win" | "lose" }) {
  const [crackle, setCrackle] = useState<Crackle | null>(null);
  /** The glow behind the king: sheared into a slice during a tear, flickering between. */
  const [glow, setGlow] = useState<Glow>(() => newGlow(0, 0, 0, 0.9));
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let timer = 0;
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const started = performance.now();
    // A constant crackle: tear after tear with only tiny, uneven gaps; now and then a
    // slightly longer flicker-out so it never settles into a rhythm.
    const burst = () => {
      // Some tears make a sound; it fades out over about 45 seconds of looking at the board.
      const age = (performance.now() - started) / 1000;
      if (age < 45 && Math.random() < 0.3) playIfOn("crackle", 1 - age / 45);
      // The steady static under the bursts fades on the same curve, then stops.
      if (age < 45) setStaticBedLevel(1 - age / 45);
      else stopStaticBed();
      const top = Math.round(rand(0, 60));
      // The glow tears on its own slice (not the king's), or sometimes just jumps sideways.
      const glowTop = Math.random() < 0.3 ? 0 : Math.round(rand(0, 55));
      setGlow(
        newGlow(
          glowTop,
          glowTop === 0 ? 0 : Math.round(rand(0, 85 - glowTop)),
          Math.round(rand(-18, 18)),
          rand(0.55, 1),
        ),
      );
      setCrackle({
        top,
        // Never more than about 60% of the king at once, so it always reads as broken.
        bottom: Math.round(rand(Math.max(0, 40 - top), 88 - top)),
        shift: Math.round(rand(-14, 14)),
        lines: Array.from({ length: Math.floor(Math.random() * 3) }, () => ({
          y: Math.round(rand(8, 92)),
          dx: Math.round(rand(-12, 12)),
          w: Math.round(rand(35, 90)),
        })),
      });
      timer = window.setTimeout(
        () => {
          setCrackle(null);
          setGlow(newGlow(0, 0, Math.round(rand(-3, 3)), rand(0.4, 0.95)));
          const gap = Math.random() < 0.12 ? rand(250, 600) : rand(25, 140);
          // Even in a longer pause the glow keeps flickering.
          if (gap > 200) {
            timer = window.setTimeout(() => {
              setGlow(newGlow(0, 0, Math.round(rand(-3, 3)), rand(0.4, 0.95)));
              timer = window.setTimeout(burst, gap / 2);
            }, gap / 2);
          } else {
            timer = window.setTimeout(burst, gap);
          }
        },
        rand(50, 170),
      );
    };
    timer = window.setTimeout(burst, 1000);
    // A steady hiss starts as the king tears apart, so the bursts have something under them.
    const bedTimer = window.setTimeout(startStaticBed, 250);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(bedTimer);
      stopStaticBed();
    };
  }, []);
  const style = crackle
    ? ({
        "--cut-top": `${crackle.top}%`,
        "--cut-bottom": `${crackle.bottom}%`,
        "--shift": `${crackle.shift}%`,
      } as React.CSSProperties)
    : undefined;
  return (
    <span className={`kingfall kingfall--${tone}`} aria-hidden="true">
      <span
        className="kingfall__glow"
        style={
          {
            "--glow-top": `${glow.top}%`,
            "--glow-bottom": `${glow.bottom}%`,
            "--glow-shift": `${glow.shift}%`,
            "--glow-o": glow.o,
          } as React.CSSProperties
        }
      >
        {glow.bands.map((b, i) => (
          <span
            key={i}
            className="kingfall__band"
            style={{
              top: `${b.y}%`,
              height: `${b.h}%`,
              left: `${b.x}%`,
              width: `${b.w}%`,
              opacity: b.a,
            }}
          />
        ))}
      </span>
      <span className="captured-ghost captured-ghost--king">
        <PieceIcon type="k" color={color} className="piece" />
        <PieceIcon type="k" color={color} className="piece captured-ghost__echo" />
      </span>
      <span className={`kingfall__ghost ${crackle ? "kingfall__ghost--tear" : ""}`} style={style}>
        <PieceIcon type="k" color={color} className="piece" />
      </span>
      {crackle?.lines.map((l, i) => (
        <span
          key={i}
          className="kingfall__static"
          style={{ top: `${l.y}%`, left: `${(100 - l.w) / 2 + l.dx}%`, width: `${l.w}%` }}
        />
      ))}
    </span>
  );
}
