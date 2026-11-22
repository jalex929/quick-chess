import { Chess } from "chess.js";
import { fromUci, type Color } from "./game";
import {
  BISHOP,
  KING,
  KNIGHT,
  PAWN,
  Position,
  QUEEN,
  ROOK,
  fileOf,
  moveToUci,
  rankOf,
  type PMove,
} from "./position";

export type BotLevel = "easy" | "medium" | "hard";

export const BOT_LEVELS: { id: BotLevel; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Plays fast and loose" },
  { id: "medium", label: "Medium", hint: "Thinks a few moves ahead" },
  { id: "hard", label: "Hard", hint: "Looks deep, rarely blunders" },
];

interface LevelSettings {
  /** Deepest full search, in half-moves. */
  depth: number;
  /** Stop deepening after this long (ms); the last finished depth is used. */
  budget: number;
  /** Random wobble added to each root move's score (centipawns): makes the bot human-ish. */
  noise: number;
  /** Follow captures past the depth limit so it doesn't stop mid-trade. */
  quiescence: boolean;
}

const LEVELS: Record<BotLevel, LevelSettings> = {
  easy: { depth: 1, budget: 300, noise: 150, quiescence: false },
  medium: { depth: 3, budget: 700, noise: 30, quiescence: true },
  hard: { depth: 6, budget: 1500, noise: 0, quiescence: true },
};

/** Piece values, indexed by type (1 pawn … 6 king). */
const VALUE = [0, 100, 320, 330, 500, 900, 0];
const MATE = 100_000;
const NEAR_MATE = MATE - 1000;

/** How central a square is: 0 on the edge, 3 in the middle four. */
const centrality = (file: number, rank: number) => Math.min(file, 7 - file, rank, 7 - rank);

/**
 * Positional bonus for a piece, in centipawns, from that side's point of view.
 * `rank` counts from the piece owner's back rank (0) forward.
 */
function placement(type: number, file: number, rank: number, endgame: boolean): number {
  const c = centrality(file, rank);
  switch (type) {
    case PAWN: {
      // Push pawns forward, the centre ones especially; in the endgame every step counts.
      const centreFile = file === 3 || file === 4 ? 1 : 0;
      return endgame ? rank * 14 : rank * 4 + centreFile * rank * 5;
    }
    case KNIGHT:
      return c * 12 - 20; // knights on the rim are dim
    case BISHOP:
      return c * 6 - 6;
    case ROOK:
      return rank === 6 ? 15 : 0; // the seventh rank
    case QUEEN:
      return c * 3;
    case KING:
      // Middlegame: stay tucked in a back corner. Endgame: walk to the centre.
      return endgame ? c * 10 : rank === 0 && (file <= 2 || file >= 6) ? 25 : -rank * 15;
    default:
      return 0;
  }
}

/** Score from White's point of view, in centipawns. */
export function evaluate(pos: Position): number {
  const b = pos.board;
  let material = 0;
  for (let sq = 21; sq <= 98; sq++) {
    const t = Math.abs(b[sq]!);
    if (t >= KNIGHT && t <= QUEEN) material += VALUE[t]!;
  }
  const endgame = material <= 2 * (VALUE[ROOK]! + VALUE[KNIGHT]!);
  let score = 0;
  let bishopsW = 0;
  let bishopsB = 0;
  for (let sq = 21; sq <= 98; sq++) {
    const piece = b[sq]!;
    if (piece === 0 || piece === 7) continue;
    const type = Math.abs(piece);
    const white = piece > 0;
    const ownRank = white ? rankOf(sq) : 7 - rankOf(sq);
    const v = VALUE[type]! + placement(type, fileOf(sq), ownRank, endgame);
    score += white ? v : -v;
    if (type === BISHOP) {
      if (white) bishopsW++;
      else bishopsB++;
    }
  }
  if (bishopsW >= 2) score += 30;
  if (bishopsB >= 2) score -= 30;
  return score;
}

/** Captures first (biggest prize, cheapest attacker), then promotions, then the rest. */
function orderKey(pos: Position, m: PMove): number {
  let key = 0;
  if (m.captured)
    key += 10_000 + 10 * VALUE[Math.abs(m.captured)]! - VALUE[Math.abs(pos.board[m.from]!)]!;
  if (m.promo) key += 9_000 + VALUE[m.promo]!;
  return key;
}

function ordered(pos: Position, moves: PMove[], first?: string): PMove[] {
  const keyed = moves.map((m) => ({
    m,
    k: orderKey(pos, m) + (first && moveToUci(m) === first ? 1e6 : 0),
  }));
  keyed.sort((a, b) => b.k - a.k);
  return keyed.map((x) => x.m);
}

class Search {
  nodes = 0;
  stopped = false;
  /** Positions already seen in the game, by placement + side; repeating one scores as a draw. */
  private seen: Set<string>;
  private path: string[] = [];

  constructor(
    private pos: Position,
    private settings: LevelSettings,
    private deadline: number,
    private now: () => number,
    seen: Set<string>,
  ) {
    this.seen = seen;
  }

  private timeUp() {
    if ((++this.nodes & 1023) === 0 && this.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }

  private key() {
    return this.pos.board.join(",") + this.pos.side;
  }

  quiesce(alpha: number, beta: number, ply: number): number {
    const stand = this.pos.side * evaluate(this.pos);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 12 || this.timeUp()) return alpha;
    for (const m of ordered(this.pos, this.pos.pseudoMoves(true))) {
      if (!this.pos.make(m)) continue;
      const score = -this.quiesce(-beta, -alpha, ply + 1);
      this.pos.unmake();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  negamax(depth: number, alpha: number, beta: number, ply: number): number {
    if (this.pos.halfmove >= 100) return 0;
    const inCheck = this.pos.inCheck();
    // Look one move further when in check, so the bot doesn't miss mates and escapes.
    if (depth <= 0 && !inCheck) {
      return this.settings.quiescence
        ? this.quiesce(alpha, beta, ply)
        : this.pos.side * evaluate(this.pos);
    }
    let best = -Infinity;
    let legal = 0;
    for (const m of ordered(this.pos, this.pos.pseudoMoves())) {
      if (!this.pos.make(m)) continue;
      legal++;
      // A repeat needs at least four reversible half-moves; skip the bookkeeping until then.
      const k = this.pos.halfmove >= 4 ? this.key() : "";
      const repeat = k !== "" && (this.seen.has(k) || this.path.includes(k));
      this.path.push(k);
      const score = repeat ? 0 : -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.path.pop();
      this.pos.unmake();
      if (this.stopped) return best === -Infinity ? score : best;
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
      if (this.timeUp()) break;
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    return best;
  }

  /** Every root move with a score at `depth`, or null if time ran out part way. */
  root(moves: PMove[], depth: number): { move: PMove; score: number }[] | null {
    const scored: { move: PMove; score: number }[] = [];
    let alpha = -MATE - 1;
    for (const m of moves) {
      this.pos.make(m);
      const k = this.key();
      this.path.push(k);
      // The best move gets an exact score; the rest only need to show they're not better,
      // unless the bot adds a wobble, which needs every move's real score.
      const floor = this.settings.noise ? -MATE - 1 : alpha;
      const score = this.seen.has(k) ? 0 : -this.negamax(depth - 1, -MATE - 1, -floor, 1);
      this.path.pop();
      this.pos.unmake();
      if (this.stopped) return null;
      scored.push({ move: m, score });
      if (score > alpha) alpha = score;
    }
    return scored;
  }
}

export interface BotChoice {
  uci: string;
  /** Score for the bot after its move (centipawns; ±100000 near mate). */
  score: number;
  depth: number;
  nodes: number;
}

/**
 * Picks a move for the side to play in the game given by `moves` (long algebraic).
 * `random` and `now` are injectable so tests are repeatable.
 */
export function chooseMove(
  moves: string[],
  level: BotLevel,
  random: () => number = Math.random,
  now: () => number = () => performance.now(),
): BotChoice | null {
  const chess = new Chess();
  const seen = new Set<string>();
  const remember = () => {
    const p = Position.fromFen(chess.fen());
    seen.add(p.board.join(",") + p.side);
  };
  for (const uci of moves) {
    chess.move(fromUci(uci));
    remember();
  }
  const pos = Position.fromFen(chess.fen());
  // The current position itself isn't a repeat of anything yet.
  seen.delete(pos.board.join(",") + pos.side);
  const legal = pos.legalMoves();
  if (legal.length === 0) return null;
  const settings = LEVELS[level];
  const search = new Search(pos, settings, now() + settings.budget, now, seen);

  let scored = ordered(pos, legal).map((move) => ({ move, score: 0 }));
  let reached = 0;
  for (let depth = 1; depth <= settings.depth; depth++) {
    const result = search.root(
      scored.map((s) => s.move),
      depth,
    );
    if (!result) break;
    scored = result.sort((a, b) => b.score - a.score);
    reached = depth;
    if (scored[0]!.score > NEAR_MATE) break; // a forced mate: no need to look further
  }

  // The wobble never touches mates: even Easy takes a mate in one and avoids walking into one.
  const best = scored[0]!.score;
  const pick = scored
    .map((s) => ({
      ...s,
      pick:
        Math.abs(s.score) > NEAR_MATE || Math.abs(best) > NEAR_MATE
          ? s.score
          : s.score + (random() * 2 - 1) * settings.noise,
    }))
    .sort((a, b) => b.pick - a.pick)[0]!;
  return { uci: moveToUci(pick.move), score: pick.score, depth: reached, nodes: search.nodes };
}

/** Which color the bot plays given the human's side. */
export const botColor = (human: Color): Color => (human === "w" ? "b" : "w");
