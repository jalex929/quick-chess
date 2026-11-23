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

export type BotLevel = "easy" | "medium" | "hard" | "expert";

/**
 * Four levels aimed at roughly these ratings: Easy ~400, Medium ~800, Hard ~1200,
 * Expert 1800+. The ratings are targets the levels were tuned toward, not measured;
 * the levels are checked against each other (each beats the one below), see
 * docs/decisions.md.
 */
export const BOT_LEVELS: { id: BotLevel; label: string; hint: string; rating: string }[] = [
  { id: "easy", label: "Easy", hint: "New to chess", rating: "~400" },
  { id: "medium", label: "Medium", hint: "Knows the basics", rating: "~800" },
  { id: "hard", label: "Hard", hint: "Club player", rating: "~1200" },
  { id: "expert", label: "Expert", hint: "Strong player", rating: "1800+" },
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
  /** Chance of a careless move: any legal move that isn't walking into mate in one. */
  careless: number;
  /** Positional knowledge beyond material and piece placement (pawn structure, rooks, king). */
  fullEval: boolean;
}

const LEVELS: Record<BotLevel, LevelSettings> = {
  easy: { depth: 1, budget: 300, noise: 220, quiescence: false, careless: 0.22, fullEval: false },
  medium: { depth: 2, budget: 600, noise: 90, quiescence: true, careless: 0.06, fullEval: false },
  hard: { depth: 3, budget: 1200, noise: 30, quiescence: true, careless: 0, fullEval: true },
  expert: { depth: 30, budget: 2500, noise: 0, quiescence: true, careless: 0, fullEval: true },
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

/**
 * Score from White's point of view, in centipawns. `full` adds pawn structure (passed,
 * doubled, isolated pawns), rooks on open files and the pawn shield in front of the king.
 */
export function evaluate(pos: Position, full = true): number {
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
  // Pawns per file, and the furthest/nearest rank of each side's pawns on each file.
  const pawnsW = new Int8Array(8);
  const pawnsB = new Int8Array(8);
  const maxRankW = new Int8Array(8).fill(-1);
  const minRankW = new Int8Array(8).fill(8);
  const minRankB = new Int8Array(8).fill(8);
  const maxRankB = new Int8Array(8).fill(-1);
  for (let sq = 21; sq <= 98; sq++) {
    const piece = b[sq]!;
    if (piece === 0 || piece === 7) continue;
    const type = Math.abs(piece);
    const white = piece > 0;
    const file = fileOf(sq);
    const rank = rankOf(sq);
    const ownRank = white ? rank : 7 - rank;
    const v = VALUE[type]! + placement(type, file, ownRank, endgame);
    score += white ? v : -v;
    if (type === BISHOP) {
      if (white) bishopsW++;
      else bishopsB++;
    }
    if (type === PAWN) {
      if (white) {
        pawnsW[file]!++;
        maxRankW[file] = Math.max(maxRankW[file]!, rank);
        minRankW[file] = Math.min(minRankW[file]!, rank);
      } else {
        pawnsB[file]!++;
        minRankB[file] = Math.min(minRankB[file]!, rank);
        maxRankB[file] = Math.max(maxRankB[file]!, rank);
      }
    }
  }
  if (bishopsW >= 2) score += 30;
  if (bishopsB >= 2) score -= 30;
  if (!full) return score;

  for (let f = 0; f < 8; f++) {
    // Doubled pawns.
    if (pawnsW[f]! > 1) score -= 15 * (pawnsW[f]! - 1);
    if (pawnsB[f]! > 1) score += 15 * (pawnsB[f]! - 1);
    // Isolated pawns: no friendly pawn on either neighbouring file.
    const wNeighbours = (f > 0 ? pawnsW[f - 1]! : 0) + (f < 7 ? pawnsW[f + 1]! : 0);
    const bNeighbours = (f > 0 ? pawnsB[f - 1]! : 0) + (f < 7 ? pawnsB[f + 1]! : 0);
    if (pawnsW[f]! && !wNeighbours) score -= 12;
    if (pawnsB[f]! && !bNeighbours) score += 12;
    // Passed pawns: no enemy pawn ahead on this or a neighbouring file. Worth more the
    // further they've gone, and much more in the endgame.
    if (pawnsW[f]!) {
      const r = maxRankW[f]!;
      let passed = true;
      for (let g = Math.max(0, f - 1); g <= Math.min(7, f + 1); g++)
        if (maxRankB[g]! > r) passed = false;
      if (passed) score += (endgame ? 20 : 10) + r * r * (endgame ? 6 : 3);
    }
    if (pawnsB[f]!) {
      const r = minRankB[f]!;
      let passed = true;
      for (let g = Math.max(0, f - 1); g <= Math.min(7, f + 1); g++)
        if (minRankW[g]! < r) passed = false;
      const adv = 7 - r;
      if (passed) score -= (endgame ? 20 : 10) + adv * adv * (endgame ? 6 : 3);
    }
  }
  // Rooks on open (no pawns) and half-open (no own pawns) files.
  for (let sq = 21; sq <= 98; sq++) {
    const piece = b[sq]!;
    if (Math.abs(piece) !== ROOK) continue;
    const f = fileOf(sq);
    const own = piece > 0 ? pawnsW[f]! : pawnsB[f]!;
    const theirs = piece > 0 ? pawnsB[f]! : pawnsW[f]!;
    const bonus = !own && !theirs ? 25 : !own ? 12 : 0;
    score += piece > 0 ? bonus : -bonus;
  }
  // Pawn shield: pawns just in front of a castled king.
  if (!endgame) {
    for (const side of [1, -1]) {
      const k = pos.kings[side]!;
      const f = fileOf(k);
      const homeRank = side === 1 ? 0 : 7;
      if (rankOf(k) !== homeRank || (f > 2 && f < 5)) continue;
      let shield = 0;
      for (let g = Math.max(0, f - 1); g <= Math.min(7, f + 1); g++) {
        const one = k + (g - f) + 10 * side;
        const two = one + 10 * side;
        if (b[one] === PAWN * side) shield += 12;
        else if (b[two] === PAWN * side) shield += 6;
      }
      score += side * shield;
    }
  }
  return score;
}

const moveCode = (m: PMove) => m.from | (m.to << 7) | (m.promo << 14);

interface TTEntry {
  depth: number;
  score: number;
  /** 0 exact, 1 lower bound (failed high), 2 upper bound (failed low). */
  flag: 0 | 1 | 2;
  best: number;
}

/** Mate scores are stored relative to the node, so they stay right when reached by another path. */
const toTT = (score: number, ply: number) =>
  score > NEAR_MATE ? score + ply : score < -NEAR_MATE ? score - ply : score;
const fromTT = (score: number, ply: number) =>
  score > NEAR_MATE ? score - ply : score < -NEAR_MATE ? score + ply : score;

class Search {
  nodes = 0;
  stopped = false;
  /** Positions already searched, by fingerprint: their score, how deep, and the best move. */
  private tt = new Map<number, TTEntry>();
  /** Two quiet moves per ply that recently caused a cut-off; tried early next time. */
  private killers: number[][] = [];
  /** How often each quiet from→to move caused a cut-off. */
  private history = new Int32Array(1 << 14);
  private path: number[] = [];

  constructor(
    private pos: Position,
    private settings: LevelSettings,
    private deadline: number,
    private now: () => number,
    /** Positions seen earlier in the game; reaching one again scores as a draw. */
    private seen: Set<number>,
  ) {}

  private timeUp() {
    if ((++this.nodes & 1023) === 0 && this.now() > this.deadline) this.stopped = true;
    return this.stopped;
  }

  private score() {
    return this.pos.side * evaluate(this.pos, this.settings.fullEval);
  }

  /**
   * Move order: the remembered best move, then captures (biggest prize, cheapest attacker),
   * promotions, this ply's killer moves, then quiet moves by history.
   */
  private ordered(moves: PMove[], ply: number, best = -1): PMove[] {
    const b = this.pos.board;
    const killers = this.killers[ply] ?? [];
    const keyed = moves.map((m) => {
      const code = moveCode(m);
      let k: number;
      if (code === best) k = 1e9;
      else if (m.captured)
        k = 1e7 + 10 * VALUE[Math.abs(m.captured)]! - VALUE[Math.abs(b[m.from]!)]!;
      else if (m.promo) k = 9e6 + VALUE[m.promo]!;
      else if (code === killers[0]) k = 8e6;
      else if (code === killers[1]) k = 7e6;
      else k = this.history[(m.from << 7) | m.to]!;
      return { m, k };
    });
    keyed.sort((x, y) => y.k - x.k);
    return keyed.map((x) => x.m);
  }

  quiesce(alpha: number, beta: number, ply: number): number {
    const stand = this.score();
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 30 || this.timeUp()) return alpha;
    for (const m of this.ordered(this.pos.pseudoMoves(true), ply)) {
      // Skip captures that can't lift the score to alpha even if they win the piece outright.
      if (!m.promo && stand + VALUE[Math.abs(m.captured)]! + 200 < alpha) continue;
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
    // In check: look one move further, so mates and escapes aren't cut off.
    if (inCheck && ply < 40) depth++;
    if (depth <= 0) return this.settings.quiescence ? this.quiesce(alpha, beta, ply) : this.score();

    const key = this.pos.key;
    const entry = this.tt.get(key);
    if (entry && entry.depth >= depth) {
      const s = fromTT(entry.score, ply);
      if (entry.flag === 0) return s;
      if (entry.flag === 1 && s >= beta) return s;
      if (entry.flag === 2 && s <= alpha) return s;
    }

    const alphaStart = alpha;
    let best = -Infinity;
    let bestCode = 0;
    let legal = 0;
    for (const m of this.ordered(this.pos.pseudoMoves(), ply, entry?.best)) {
      if (!this.pos.make(m)) continue;
      legal++;
      // A repeat needs at least four reversible half-moves; skip the bookkeeping until then.
      const k = this.pos.key;
      const repeat = this.pos.halfmove >= 4 && (this.seen.has(k) || this.path.includes(k));
      this.path.push(k);
      const score = repeat ? 0 : -this.negamax(depth - 1, -beta, -alpha, ply + 1);
      this.path.pop();
      this.pos.unmake();
      if (this.stopped) return best === -Infinity ? score : best;
      if (score > best) {
        best = score;
        bestCode = moveCode(m);
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (!m.captured) {
          const code = moveCode(m);
          const killers = (this.killers[ply] ??= []);
          if (killers[0] !== code) {
            killers[1] = killers[0]!;
            killers[0] = code;
          }
          this.history[(m.from << 7) | m.to]! += depth * depth;
        }
        break;
      }
      if (this.timeUp()) break;
    }
    if (legal === 0) return inCheck ? -MATE + ply : 0;
    if (!this.stopped) {
      if (this.tt.size > 400_000) this.tt.clear();
      this.tt.set(key, {
        depth,
        score: toTT(best, ply),
        flag: best <= alphaStart ? 2 : best >= beta ? 1 : 0,
        best: bestCode,
      });
    }
    return best;
  }

  /** Every root move with a score at `depth`, or null if time ran out part way. */
  root(moves: PMove[], depth: number): { move: PMove; score: number }[] | null {
    const scored: { move: PMove; score: number }[] = [];
    let alpha = -MATE - 1;
    for (const m of moves) {
      this.pos.make(m);
      const k = this.pos.key;
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
  const seen = new Set<number>();
  for (const uci of moves) {
    chess.move(fromUci(uci));
    seen.add(Position.fromFen(chess.fen()).key);
  }
  const pos = Position.fromFen(chess.fen());
  seen.delete(pos.key); // the current position isn't a repeat of itself
  const legal = pos.legalMoves();
  if (legal.length === 0) return null;
  const settings = LEVELS[level];
  const search = new Search(pos, settings, now() + settings.budget, now, seen);

  // Start with captures first; each depth then re-sorts by score.
  let scored = legal
    .map((move) => ({ move, score: move.captured ? VALUE[Math.abs(move.captured)]! : 0 }))
    .sort((a, b) => b.score - a.score)
    .map((s) => ({ ...s, score: 0 }));
  let reached = 0;
  for (let depth = 1; depth <= settings.depth; depth++) {
    const result = search.root(
      scored.map((s) => s.move),
      depth,
    );
    if (!result) break;
    scored = result.sort((a, b) => b.score - a.score);
    reached = depth;
    if (Math.abs(scored[0]!.score) > NEAR_MATE) break; // a forced mate either way
  }

  const best = scored[0]!;
  const forcedMate = Math.abs(best.score) > NEAR_MATE;

  // A careless move: anything that doesn't walk straight into mate. Never when a mate is on.
  if (!forcedMate && settings.careless && random() < settings.careless) {
    const safe = scored.filter((s) => s.score > -NEAR_MATE);
    const pick = safe[Math.floor(random() * safe.length)] ?? best;
    return { uci: moveToUci(pick.move), score: pick.score, depth: reached, nodes: search.nodes };
  }

  // The wobble never touches mates: every level takes a mate in one and dodges one.
  const pick = scored
    .map((s) => ({
      ...s,
      pick:
        Math.abs(s.score) > NEAR_MATE || forcedMate
          ? s.score
          : s.score + (random() * 2 - 1) * settings.noise,
    }))
    .sort((a, b) => b.pick - a.pick)[0]!;
  return { uci: moveToUci(pick.move), score: pick.score, depth: reached, nodes: search.nodes };
}

/** Which color the bot plays given the human's side. */
export const botColor = (human: Color): Color => (human === "w" ? "b" : "w");
