/**
 * A small, fast chess position for the bot's search. chess.js stays the source of truth for
 * the rules the player sees; this exists because the bot needs hundreds of thousands of
 * positions a second, and chess.js works out notation and check for every move it lists.
 *
 * Board: the classic 10 × 12 "mailbox". Real squares are 21–98; a border of OFF squares
 * means a piece stepping off the board lands on OFF and stops, with no bounds checks.
 * Pieces are signed: White positive, Black negative.
 * Correctness is checked by perft (counting every legal line to a fixed depth) against
 * published counts, in position.test.ts.
 */

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
const OFF = 7;

const KNIGHT_STEPS = [-21, -19, -12, -8, 8, 12, 19, 21];
const BISHOP_STEPS = [-11, -9, 9, 11];
const ROOK_STEPS = [-10, -1, 1, 10];
const KING_STEPS = [-11, -10, -9, -1, 1, 9, 10, 11];

const WK = 1;
const WQ = 2;
const BK = 4;
const BQ = 8;

export const sq120 = (file: number, rank: number) => 21 + file + rank * 10;
export const fileOf = (sq: number) => (sq % 10) - 1;
export const rankOf = (sq: number) => Math.floor(sq / 10) - 2;
export const squareName = (sq: number) => "abcdefgh"[fileOf(sq)]! + (rankOf(sq) + 1);
export const parseSquare = (name: string) => sq120(name.charCodeAt(0) - 97, Number(name[1]) - 1);

/** Castling rights that survive a piece leaving or arriving on each square. */
const CASTLE_KEEP = new Uint8Array(120).fill(15);
CASTLE_KEEP[sq120(4, 0)] = 15 & ~(WK | WQ);
CASTLE_KEEP[sq120(7, 0)] = 15 & ~WK;
CASTLE_KEEP[sq120(0, 0)] = 15 & ~WQ;
CASTLE_KEEP[sq120(4, 7)] = 15 & ~(BK | BQ);
CASTLE_KEEP[sq120(7, 7)] = 15 & ~BK;
CASTLE_KEEP[sq120(0, 7)] = 15 & ~BQ;

/** A move: from, to, and (for promotions) the new piece type. Flags mark special moves. */
export interface PMove {
  from: number;
  to: number;
  promo: number;
  /** Captured piece (signed), or 0. */
  captured: number;
  flag: 0 | typeof EP | typeof CASTLE | typeof DOUBLE;
}
const EP = 1;
const CASTLE = 2;
const DOUBLE = 3;

interface Undo {
  move: PMove;
  castling: number;
  ep: number;
  halfmove: number;
}

const PIECE_CHARS = " pnbrqk";

export class Position {
  board = new Int8Array(120).fill(OFF);
  /** 1 for White to move, -1 for Black. */
  side = 1;
  castling = 0;
  /** En passant target square, or 0. */
  ep = 0;
  halfmove = 0;
  kings = { 1: 0, [-1]: 0 } as Record<number, number>;
  private history: Undo[] = [];

  static fromFen(fen: string): Position {
    const p = new Position();
    const [placement, side, castling, ep, halfmove] = fen.split(" ");
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) p.board[sq120(f, r)] = EMPTY;
    let rank = 7;
    let file = 0;
    for (const ch of placement!) {
      if (ch === "/") {
        rank--;
        file = 0;
      } else if (ch >= "1" && ch <= "8") {
        file += Number(ch);
      } else {
        const type = PIECE_CHARS.indexOf(ch.toLowerCase());
        const color = ch === ch.toUpperCase() ? 1 : -1;
        const sq = sq120(file, rank);
        p.board[sq] = type * color;
        if (type === KING) p.kings[color] = sq;
        file++;
      }
    }
    p.side = side === "b" ? -1 : 1;
    p.castling =
      (castling?.includes("K") ? WK : 0) |
      (castling?.includes("Q") ? WQ : 0) |
      (castling?.includes("k") ? BK : 0) |
      (castling?.includes("q") ? BQ : 0);
    p.ep = ep && ep !== "-" ? parseSquare(ep) : 0;
    p.halfmove = Number(halfmove ?? 0) || 0;
    return p;
  }

  /** Is `sq` attacked by side `by` (1 or -1)? */
  attacked(sq: number, by: number): boolean {
    const b = this.board;
    // Pawns: a White pawn on x attacks x+9 and x+11.
    const pawn = PAWN * by;
    if (b[sq - 9 * by] === pawn || b[sq - 11 * by] === pawn) return true;
    for (const d of KNIGHT_STEPS) if (b[sq + d] === KNIGHT * by) return true;
    for (const d of KING_STEPS) if (b[sq + d] === KING * by) return true;
    for (const d of BISHOP_STEPS) {
      let t = sq + d;
      while (b[t] === EMPTY) t += d;
      if (b[t] === BISHOP * by || b[t] === QUEEN * by) return true;
    }
    for (const d of ROOK_STEPS) {
      let t = sq + d;
      while (b[t] === EMPTY) t += d;
      if (b[t] === ROOK * by || b[t] === QUEEN * by) return true;
    }
    return false;
  }

  inCheck(): boolean {
    return this.attacked(this.kings[this.side]!, -this.side);
  }

  /** Moves that may leave the mover's own king in check; `capturesOnly` for quiescence. */
  pseudoMoves(capturesOnly = false): PMove[] {
    const out: PMove[] = [];
    const b = this.board;
    const us = this.side;
    const add = (from: number, to: number, promo = 0, flag: PMove["flag"] = 0) =>
      out.push({ from, to, promo, captured: flag === EP ? -us * PAWN : b[to]!, flag });

    for (let from = 21; from <= 98; from++) {
      const piece = b[from]!;
      if (piece === OFF || piece === EMPTY || Math.sign(piece) !== us) continue;
      const type = Math.abs(piece);
      if (type === PAWN) {
        const fwd = 10 * us;
        const lastRank = us === 1 ? 7 : 0;
        const startRank = us === 1 ? 1 : 6;
        const pushTo = (to: number) => {
          if (rankOf(to) === lastRank)
            for (const pr of [QUEEN, KNIGHT, ROOK, BISHOP]) add(from, to, pr);
          else add(from, to);
        };
        const one = from + fwd;
        if (b[one] === EMPTY && (!capturesOnly || rankOf(one) === lastRank)) {
          pushTo(one);
          if (!capturesOnly && rankOf(from) === startRank && b[one + fwd] === EMPTY)
            add(from, one + fwd, 0, DOUBLE);
        }
        for (const side of [fwd - 1, fwd + 1]) {
          const to = from + side;
          const t = b[to]!;
          if (t !== OFF && t !== EMPTY && Math.sign(t) === -us) pushTo(to);
          else if (to === this.ep && this.ep) add(from, to, 0, EP);
        }
        continue;
      }
      const steps =
        type === KNIGHT
          ? KNIGHT_STEPS
          : type === BISHOP
            ? BISHOP_STEPS
            : type === ROOK
              ? ROOK_STEPS
              : KING_STEPS;
      const slides = type === BISHOP || type === ROOK || type === QUEEN;
      for (const d of steps) {
        let to = from + d;
        while (true) {
          const t = b[to]!;
          if (t === OFF) break;
          if (t === EMPTY) {
            if (!capturesOnly) add(from, to);
          } else {
            if (Math.sign(t) === -us) add(from, to);
            break;
          }
          if (!slides) break;
          to += d;
        }
      }
      if (type === KING && !capturesOnly) this.castles(from, add);
    }
    return out;
  }

  private castles(
    from: number,
    add: (from: number, to: number, promo: number, flag: PMove["flag"]) => void,
  ) {
    const us = this.side;
    const b = this.board;
    const [kSide, qSide] = us === 1 ? [WK, WQ] : [BK, BQ];
    const home = us === 1 ? sq120(4, 0) : sq120(4, 7);
    if (from !== home || !(this.castling & (kSide | qSide)) || this.attacked(home, -us)) return;
    if (
      this.castling & kSide &&
      b[home + 1] === EMPTY &&
      b[home + 2] === EMPTY &&
      b[home + 3] === ROOK * us &&
      !this.attacked(home + 1, -us) &&
      !this.attacked(home + 2, -us)
    )
      add(from, home + 2, 0, CASTLE);
    if (
      this.castling & qSide &&
      b[home - 1] === EMPTY &&
      b[home - 2] === EMPTY &&
      b[home - 3] === EMPTY &&
      b[home - 4] === ROOK * us &&
      !this.attacked(home - 1, -us) &&
      !this.attacked(home - 2, -us)
    )
      add(from, home - 2, 0, CASTLE);
  }

  /** Plays `m`. Returns false (and takes it back) if it leaves the mover in check. */
  make(m: PMove): boolean {
    const b = this.board;
    const us = this.side;
    this.history.push({ move: m, castling: this.castling, ep: this.ep, halfmove: this.halfmove });
    const piece = b[m.from]!;
    b[m.to] = m.promo ? m.promo * us : piece;
    b[m.from] = EMPTY;
    if (m.flag === EP) b[m.to - 10 * us] = EMPTY;
    if (m.flag === CASTLE) {
      const kingside = m.to > m.from;
      const rookFrom = kingside ? m.from + 3 : m.from - 4;
      const rookTo = kingside ? m.from + 1 : m.from - 1;
      b[rookTo] = b[rookFrom]!;
      b[rookFrom] = EMPTY;
    }
    if (Math.abs(piece) === KING) this.kings[us] = m.to;
    this.castling &= CASTLE_KEEP[m.from]! & CASTLE_KEEP[m.to]!;
    this.ep = m.flag === DOUBLE ? m.from + 10 * us : 0;
    this.halfmove = Math.abs(piece) === PAWN || m.captured ? 0 : this.halfmove + 1;
    this.side = -us;
    if (this.attacked(this.kings[us]!, -us)) {
      this.unmake();
      return false;
    }
    return true;
  }

  unmake(): void {
    const u = this.history.pop()!;
    const m = u.move;
    const b = this.board;
    this.side = -this.side;
    const us = this.side;
    const moved = m.promo ? PAWN * us : b[m.to]!;
    b[m.from] = moved;
    b[m.to] = m.flag === EP ? EMPTY : m.captured;
    if (m.flag === EP) b[m.to - 10 * us] = m.captured;
    if (m.flag === CASTLE) {
      const kingside = m.to > m.from;
      const rookFrom = kingside ? m.from + 3 : m.from - 4;
      const rookTo = kingside ? m.from + 1 : m.from - 1;
      b[rookFrom] = b[rookTo]!;
      b[rookTo] = EMPTY;
    }
    if (Math.abs(moved) === KING) this.kings[us] = m.from;
    this.castling = u.castling;
    this.ep = u.ep;
    this.halfmove = u.halfmove;
  }

  /** Fully legal moves. */
  legalMoves(): PMove[] {
    return this.pseudoMoves().filter((m) => {
      if (!this.make(m)) return false;
      this.unmake();
      return true;
    });
  }

  /** Counts every legal line `depth` half-moves deep (for testing against published counts). */
  perft(depth: number): number {
    if (depth === 0) return 1;
    let n = 0;
    for (const m of this.pseudoMoves()) {
      if (!this.make(m)) continue;
      n += this.perft(depth - 1);
      this.unmake();
    }
    return n;
  }
}

export function moveToUci(m: PMove): string {
  return squareName(m.from) + squareName(m.to) + (m.promo ? " pnbrq"[m.promo] : "");
}
