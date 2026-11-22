import { Chess, type Move, type Square } from "chess.js";

export type Color = "w" | "b";
export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";
export type PromotionPiece = "q" | "r" | "b" | "n";
export type { Square };

export interface Piece {
  type: PieceType;
  color: Color;
}

/** A move as the board needs it: where from, where to, and what a pawn becomes. */
export interface MoveInput {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
}

export type Outcome =
  | { kind: "playing" }
  | { kind: "checkmate"; winner: Color }
  | { kind: "stalemate" }
  | { kind: "repetition" }
  | { kind: "fifty-moves" }
  | { kind: "insufficient" }
  | { kind: "resigned"; winner: Color }
  | { kind: "timeout"; winner: Color }
  /** Out of time, but the other side has nothing left that could mate. */
  | { kind: "timeout-draw" }
  | { kind: "agreed" };

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

export const PIECE_NAMES: Record<PieceType, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};
export const COLOR_NAMES: Record<Color, string> = { w: "White", b: "Black" };

export const other = (c: Color): Color => (c === "w" ? "b" : "w");

/** All 64 squares, rank 8 first (top of the board from White's side). */
export const ALL_SQUARES: Square[] = [...RANKS]
  .reverse()
  .flatMap((r) => FILES.map((f) => `${f}${r}` as Square));

export function isLightSquare(sq: Square): boolean {
  const file = sq.charCodeAt(0) - 97;
  const rank = Number(sq[1]) - 1;
  return (file + rank) % 2 === 1;
}

/** Long-algebraic form ("e2e4", "e7e8q"): how games are stored and replayed. */
export const toUci = (m: MoveInput) => `${m.from}${m.to}${m.promotion ?? ""}`;
export function fromUci(uci: string): MoveInput {
  return {
    from: uci.slice(0, 2) as Square,
    to: uci.slice(2, 4) as Square,
    ...(uci.length > 4 ? { promotion: uci[4] as PromotionPiece } : {}),
  };
}

/**
 * The game is its move list. Everything else (board, whose turn, check, result) is
 * derived by replaying it, so saving, undo and resuming are all just list edits.
 */
export class Game {
  readonly chess: Chess;
  readonly moves: string[];

  constructor(moves: string[] = []) {
    this.chess = new Chess();
    this.moves = [];
    for (const uci of moves) {
      if (!this.tryMove(fromUci(uci))) break;
    }
  }

  private tryMove(m: MoveInput): Move | null {
    try {
      const move = this.chess.move(m);
      this.moves.push(
        toUci({
          from: move.from,
          to: move.to,
          promotion: move.promotion as PromotionPiece | undefined,
        }),
      );
      return move;
    } catch {
      return null;
    }
  }

  /** A new game with this move added, or null if it's not legal. */
  play(m: MoveInput): Game | null {
    if (this.outcome().kind !== "playing") return null;
    const next = new Game(this.moves);
    return next.tryMove(m) ? next : null;
  }

  /** A new game with the last `count` moves taken back. */
  undo(count = 1): Game {
    return new Game(this.moves.slice(0, Math.max(0, this.moves.length - count)));
  }

  turn(): Color {
    return this.chess.turn();
  }

  pieceAt(sq: Square): Piece | null {
    const p = this.chess.get(sq);
    return p ? { type: p.type, color: p.color } : null;
  }

  /** Where the piece on `from` can legally go. */
  targets(from: Square): Square[] {
    return this.chess.moves({ square: from, verbose: true }).map((m) => m.to);
  }

  /** Whether moving from → to is a pawn reaching the last rank (needs a promotion choice). */
  isPromotion(from: Square, to: Square): boolean {
    return this.chess
      .moves({ square: from, verbose: true })
      .some((m) => m.to === to && !!m.promotion);
  }

  inCheck(): boolean {
    return this.chess.inCheck();
  }

  /** The square of the king that is in check, if any. */
  checkedKing(): Square | null {
    if (!this.chess.inCheck()) return null;
    const turn = this.turn();
    return (
      ALL_SQUARES.find((sq) => {
        const p = this.chess.get(sq);
        return p?.type === "k" && p.color === turn;
      }) ?? null
    );
  }

  lastMove(): MoveInput | null {
    const uci = this.moves[this.moves.length - 1];
    return uci ? fromUci(uci) : null;
  }

  /** Standard notation for each move so far ("e4", "Nf3", "O-O", "exd8=Q#"). */
  san(): string[] {
    return this.chess.history();
  }

  /** Result from the board alone. Resign, timeout and agreed draws are layered on by the app. */
  outcome(): Outcome {
    const c = this.chess;
    if (c.isCheckmate()) return { kind: "checkmate", winner: other(c.turn()) };
    if (c.isStalemate()) return { kind: "stalemate" };
    if (c.isInsufficientMaterial()) return { kind: "insufficient" };
    if (c.isThreefoldRepetition()) return { kind: "repetition" };
    if (c.isDrawByFiftyMoves()) return { kind: "fifty-moves" };
    return { kind: "playing" };
  }

  /** Whether `color` has anything left that could deliver mate (for timeouts). */
  canMate(color: Color): boolean {
    let minors = 0;
    for (const sq of ALL_SQUARES) {
      const p = this.chess.get(sq);
      if (!p || p.color !== color || p.type === "k") continue;
      if (p.type === "p" || p.type === "r" || p.type === "q") return true;
      minors++;
    }
    return minors >= 2;
  }

  pgn(headers: Record<string, string> = {}, outcome: Outcome = this.outcome()): string {
    const c = new Chess();
    for (const [k, v] of Object.entries(headers)) c.setHeader(k, v);
    for (const uci of this.moves) c.move(fromUci(uci));
    const result = resultTag(outcome);
    c.setHeader("Result", result);
    const body = c.pgn();
    // chess.js only writes a result for board-decided endings; add it for the rest.
    return body.trimEnd().endsWith(result) ? body : `${body.trimEnd()} ${result}`;
  }
}

export function resultTag(o: Outcome): string {
  switch (o.kind) {
    case "playing":
      return "*";
    case "checkmate":
    case "resigned":
    case "timeout":
      return o.winner === "w" ? "1-0" : "0-1";
    default:
      return "1/2-1/2";
  }
}

/** A sentence for the end of a game, e.g. "Checkmate. White wins." */
export function describeOutcome(o: Outcome): { title: string; detail: string } {
  switch (o.kind) {
    case "playing":
      return { title: "", detail: "" };
    case "checkmate":
      return { title: `${COLOR_NAMES[o.winner]} wins`, detail: "Checkmate." };
    case "resigned":
      return {
        title: `${COLOR_NAMES[o.winner]} wins`,
        detail: `${COLOR_NAMES[other(o.winner)]} resigned.`,
      };
    case "timeout":
      return {
        title: `${COLOR_NAMES[o.winner]} wins`,
        detail: `${COLOR_NAMES[other(o.winner)]} ran out of time.`,
      };
    case "stalemate":
      return { title: "Draw", detail: "Stalemate: no legal moves, but no check." };
    case "repetition":
      return { title: "Draw", detail: "The same position came up three times." };
    case "fifty-moves":
      return { title: "Draw", detail: "Fifty moves each with no capture or pawn move." };
    case "insufficient":
      return { title: "Draw", detail: "Neither side has enough pieces left to checkmate." };
    case "agreed":
      return { title: "Draw", detail: "Agreed by both players." };
    case "timeout-draw":
      return {
        title: "Draw",
        detail: "Out of time, but the other side doesn't have enough pieces left to checkmate.",
      };
  }
}
