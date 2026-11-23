import { describe, expect, it } from "vitest";
import { chooseMove, evaluate } from "./bot";
import {
  flagged,
  formatTime,
  newClock,
  pause,
  press,
  speakTime,
  start,
  timeLeft,
  TIME_CONTROLS,
} from "./clock";
import {
  ALL_SQUARES,
  Game,
  describeOutcome,
  fromUci,
  isLightSquare,
  resultTag,
  toUci,
} from "./game";
import { Chess } from "chess.js";
import { Position } from "./position";

const play = (...uci: string[]) => new Game(uci);

describe("Game", () => {
  it("starts with White to move and 20 legal moves", () => {
    const g = new Game();
    expect(g.turn()).toBe("w");
    expect(ALL_SQUARES.flatMap((sq) => g.targets(sq))).toHaveLength(20);
    expect(g.pieceAt("e1")).toEqual({ type: "k", color: "w" });
  });

  it("is immutable: play and undo return new games", () => {
    const g = new Game();
    const next = g.play({ from: "e2", to: "e4" })!;
    expect(g.moves).toEqual([]);
    expect(next.moves).toEqual(["e2e4"]);
    expect(next.undo().moves).toEqual([]);
    expect(next.turn()).toBe("b");
  });

  it("rejects illegal moves", () => {
    expect(new Game().play({ from: "e2", to: "e5" })).toBeNull();
    expect(new Game().play({ from: "e7", to: "e5" })).toBeNull(); // not Black's turn
  });

  it("replays a saved move list and stops at the first bad move", () => {
    expect(play("e2e4", "e7e5", "zzzz", "g1f3").moves).toEqual(["e2e4", "e7e5"]);
  });

  it("knows checkmate and the winner (fool's mate)", () => {
    const g = play("f2f3", "e7e5", "g2g4", "d8h4");
    expect(g.outcome()).toEqual({ kind: "checkmate", winner: "b" });
    expect(g.inCheck()).toBe(true);
    expect(g.checkedKing()).toBe("e1");
    expect(g.play({ from: "a2", to: "a3" })).toBeNull(); // the game is over
    expect(describeOutcome(g.outcome()).title).toBe("Black wins");
  });

  it("knows stalemate", () => {
    // Shortest known stalemate (Sam Loyd, 10 moves).
    const g = play(
      "e2e3",
      "a7a5",
      "d1h5",
      "a8a6",
      "h5a5",
      "h7h5",
      "h2h4",
      "a6h6",
      "a5c7",
      "f7f6",
      "c7d7",
      "e8f7",
      "d7b7",
      "d8d3",
      "b7b8",
      "d3h7",
      "b8c8",
      "f7g6",
      "c8e6",
    );
    expect(g.outcome()).toEqual({ kind: "stalemate" });
  });

  it("knows threefold repetition", () => {
    const shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"];
    expect(play(...shuffle, ...shuffle).outcome()).toEqual({ kind: "repetition" });
  });

  it("castles, en passant and promotes", () => {
    const castle = play("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1");
    expect(castle.pieceAt("g1")).toEqual({ type: "k", color: "w" });
    expect(castle.pieceAt("f1")).toEqual({ type: "r", color: "w" });

    const ep = play("e2e4", "a7a6", "e4e5", "d7d5");
    expect(ep.targets("e5")).toContain("d6");
    expect(ep.play({ from: "e5", to: "d6" })!.pieceAt("d5")).toBeNull();

    const promo = play("h2h4", "g7g5", "h4g5", "h7h6", "g5h6", "g8f6", "h6h7", "f6g8");
    expect(promo.isPromotion("h7", "g8")).toBe(true);
    expect(promo.isPromotion("a2", "a3")).toBe(false);
    const knighted = promo.play({ from: "h7", to: "g8", promotion: "n" })!;
    expect(knighted.pieceAt("g8")).toEqual({ type: "n", color: "w" });
    expect(knighted.moves.at(-1)).toBe("h7g8n");
  });

  it("writes PGN with the right result, including resignations", () => {
    const mate = play("f2f3", "e7e5", "g2g4", "d8h4");
    expect(mate.pgn()).toMatch(/1\. f3 e5 2\. g4 Qh4# 0-1$/);
    const resigned = play("e2e4").pgn({ White: "You" }, { kind: "resigned", winner: "w" });
    expect(resigned).toContain('[White "You"]');
    expect(resigned.trim().endsWith("1-0")).toBe(true);
    expect(resultTag({ kind: "agreed" })).toBe("1/2-1/2");
  });

  it("can tell when a side can't mate (for timeouts)", () => {
    expect(new Game().canMate("w")).toBe(true);
  });

  it("long algebraic round-trips", () => {
    expect(toUci(fromUci("e7e8q"))).toBe("e7e8q");
    expect(fromUci("g1f3")).toEqual({ from: "g1", to: "f3" });
  });

  it("colors squares like a real board (a1 dark, h1 light)", () => {
    expect(isLightSquare("a1")).toBe(false);
    expect(isLightSquare("h1")).toBe(true);
    expect(ALL_SQUARES[0]).toBe("a8");
  });
});

describe("Clock", () => {
  const tc = TIME_CONTROLS.find((t) => t.id === "3+2")!;

  it("does not run until the first move, then runs for the side to move", () => {
    let c = newClock(tc);
    expect(timeLeft(c, "w", 5000)).toBe(180_000);
    c = press(c, "w", 1000); // White's first move starts Black's time
    expect(c.running).toBe("b");
    expect(timeLeft(c, "w", 9000)).toBe(180_000); // no increment for the pre-clock move
    expect(timeLeft(c, "b", 4000)).toBe(177_000);
  });

  it("adds the increment to the mover and switches sides", () => {
    let c = start(newClock(tc), "w", 0);
    c = press(c, "w", 10_000);
    expect(c.remaining.w).toBe(172_000);
    expect(c.running).toBe("b");
  });

  it("pauses and resumes without losing time", () => {
    let c = start(newClock(tc), "w", 0);
    c = pause(c, 30_000);
    expect(timeLeft(c, "w", 999_999)).toBe(150_000);
    c = start(c, "w", 1_000_000);
    expect(timeLeft(c, "w", 1_010_000)).toBe(140_000);
  });

  it("flags at zero and never shows negative time", () => {
    const c = start(newClock(tc), "b", 0);
    expect(flagged(c, 179_999)).toBeNull();
    expect(flagged(c, 180_000)).toBe("b");
    expect(timeLeft(c, "b", 500_000)).toBe(0);
  });

  it("formats and speaks times", () => {
    expect(formatTime(180_000)).toBe("3:00");
    expect(formatTime(59_001)).toBe("1:00");
    expect(formatTime(9_400)).toBe("0:09.4");
    expect(formatTime(-5)).toBe("0:00.0");
    expect(formatTime(3_720_000)).toBe("1:02:00");
    expect(speakTime(61_000)).toBe("1 minute 1 second");
    expect(speakTime(120_000)).toBe("2 minutes");
  });
});

describe("Bot", () => {
  // A fixed "random" so the wobble is repeatable; the real clock keeps each search short.
  const frozen = () => performance.now();
  const steady = () => 0.5;

  it("evaluates the start position as level", () => {
    expect(evaluate(Position.fromFen(new Chess().fen()))).toBe(0);
  });

  it("plays only legal moves", () => {
    const g = new Game();
    for (const level of ["easy", "medium", "hard", "expert"] as const) {
      const choice = chooseMove(g.moves, level, steady, frozen)!;
      expect(g.play(fromUci(choice.uci))).not.toBeNull();
    }
  });

  it("takes a free queen", () => {
    // 1. e4 d5 2. Qg4?? and the c8 bishop can take the queen.
    const g = play("e2e4", "d7d5", "d1g4");
    for (const level of ["easy", "medium", "hard", "expert"] as const) {
      expect(chooseMove(g.moves, level, steady, frozen)!.uci, level).toBe("c8g4");
    }
  });

  it("saves its attacked queen", () => {
    // 1. e4 e5 2. Qh5 Nc6 3. a3 g6: the pawn on g6 hits the queen; it has to move.
    const g = play("e2e4", "e7e5", "d1h5", "b8c6", "a2a3", "g7g6");
    for (const level of ["easy", "medium", "hard", "expert"] as const) {
      expect(fromUci(chooseMove(g.moves, level, steady, frozen)!.uci).from, level).toBe("h5");
    }
  });

  it("finds mate in one", () => {
    // Scholar's mate set-up: Qxf7#.
    const g = play("e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6");
    for (const level of ["easy", "medium", "hard", "expert"] as const) {
      expect(chooseMove(g.moves, level, Math.random, frozen)!.uci, level).toBe("h5f7");
    }
  });

  it("returns null when there are no moves", () => {
    expect(chooseMove(play("f2f3", "e7e5", "g2g4", "d8h4").moves, "hard")).toBeNull();
  });

  it("expert searches deep and stays inside its time budget in a busy middlegame", () => {
    const g = play("e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "d2d3", "f8c5", "c2c3", "d7d6");
    const t0 = performance.now();
    const choice = chooseMove(g.moves, "expert")!;
    const took = performance.now() - t0;
    expect(g.play(fromUci(choice.uci))).not.toBeNull();
    expect(took).toBeLessThan(3500);
    expect(choice.depth).toBeGreaterThanOrEqual(5);
  });

  it("expert finds a mate in two that the lower levels can miss", () => {
    // Legal's mate: after 5... Bxd1, White mates with 6. Bxf7+ Ke7 7. Nd5#.
    const g = play("e2e4", "e7e5", "g1f3", "d7d6", "f1c4", "c8g4", "b1c3", "g7g6", "f3e5", "g4d1");
    const choice = chooseMove(g.moves, "expert", () => 0.5)!;
    expect(choice.uci).toBe("c4f7");
    expect(choice.score).toBeGreaterThan(90_000);
  });
});
