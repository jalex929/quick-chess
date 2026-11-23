import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { Position, moveToUci } from "./position";

// Published perft counts (chessprogramming.org/Perft_Results). Matching them shows castling,
// en passant, promotion and check rules all agree with real chess.
const CASES: { name: string; fen: string; counts: number[] }[] = [
  {
    name: "start position",
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    counts: [20, 400, 8902, 197281],
  },
  {
    name: "Kiwipete (castling, pins, en passant)",
    fen: "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    counts: [48, 2039, 97862],
  },
  {
    name: "position 3 (en passant discovered checks)",
    fen: "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    counts: [14, 191, 2812, 43238],
  },
  {
    name: "position 4 (promotions)",
    fen: "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    counts: [6, 264, 9467],
  },
  {
    name: "position 5",
    fen: "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    counts: [44, 1486, 62379],
  },
];

describe("Position (bot move generator)", () => {
  for (const c of CASES) {
    it(`matches perft for ${c.name}`, () => {
      const p = Position.fromFen(c.fen);
      c.counts.forEach((count, i) => expect(p.perft(i + 1), `depth ${i + 1}`).toBe(count));
    });
  }

  it("lists the same legal moves as chess.js", () => {
    for (const { fen } of CASES) {
      const ours = Position.fromFen(fen).legalMoves().map(moveToUci).sort();
      const theirs = new Chess(fen)
        .moves({ verbose: true })
        .map((m) => m.from + m.to + (m.promotion ?? ""))
        .sort();
      expect(ours).toEqual(theirs);
    }
  });

  it("keeps its fingerprint right through every move, and back", () => {
    const check = (p: Position, depth: number): void => {
      expect([p.hashLo, p.hashHi]).toEqual(p.computeHash());
      if (depth === 0) return;
      for (const m of p.pseudoMoves()) {
        if (!p.make(m)) continue;
        check(p, depth - 1);
        p.unmake();
      }
    };
    for (const c of CASES) check(Position.fromFen(c.fen), 2);
  });

  it("gives transposed move orders the same fingerprint", () => {
    const a = Position.fromFen(CASES[0]!.fen);
    const b = Position.fromFen(CASES[0]!.fen);
    const play = (p: Position, ucis: string[]) => {
      for (const u of ucis) p.make(p.legalMoves().find((m) => moveToUci(m) === u)!);
    };
    play(a, ["g1f3", "g8f6", "b1c3"]);
    play(b, ["b1c3", "g8f6", "g1f3"]);
    expect(a.key).toBe(b.key);
  });

  it("make then unmake restores the board exactly", () => {
    const p = Position.fromFen(CASES[1]!.fen);
    const before = Array.from(p.board).join();
    for (const m of p.legalMoves()) {
      p.make(m);
      p.unmake();
      expect(Array.from(p.board).join()).toBe(before);
    }
  });
});
