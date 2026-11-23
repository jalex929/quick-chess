# Decisions

## D1: Rules from chess.js, own move generator for the bot (2026-11-22)

chess.js (BSD-2-Clause) is well tested and gives SAN, PGN and every draw rule, so the rules the
player sees come from it. It is slow for search (about 800 verbose move lists a second, since
it computes notation and check for each move), so the bot uses a small mailbox generator,
verified by perft against published counts. Stockfish was ruled out: GPL, and far stronger than
a quick casual game needs.

## D2: Neon cyberpunk look, genre-inspired only (2026-11-22)

The owner wants a standalone micro game with its own vibe, not the portfolio's brand colors.
Inspired by the genre (neon, night city, terminals, glitch), with no names, logos, palettes,
characters or UI lifted from any specific game, including fan or non-commercial use.

## D3: The game is its move list (2026-11-22)

Board, turn, check and result are derived by replaying the moves, so saving, undo and resuming
are list edits. Resign, timeout and agreed draws are stored separately as `ending`.

## D4: Four bot levels aimed at ~400 / ~800 / ~1200 / 1800+ (2026-11-22)

The owner asked for Easy, Medium, Hard and Expert at roughly those ratings. The ratings are
targets the levels were tuned toward, not measured: a real rating needs many games against
rated players. How each level gets its character:

| Level  | Target | Search                                                 | Human touches                         |
| ------ | ------ | ------------------------------------------------------ | ------------------------------------- |
| Easy   | ~400   | 1 half-move, material and placement only               | big random wobble; 22% careless moves |
| Medium | ~800   | 2 half-moves + captures                                | medium wobble; 6% careless moves      |
| Hard   | ~1200  | 3 half-moves + captures, full evaluation               | small wobble                          |
| Expert | 1800+  | iterative deepening to ~2.5 s (usually 6-8 half-moves) | none                                  |

Every level always takes a mate in one and never walks into one. Expert adds a transposition
table (Zobrist fingerprints in `position.ts`), killer and history move ordering and check
extensions; the full evaluation adds passed, doubled and isolated pawns, rooks on open files
and the king's pawn shield.

Ladder check (`scripts/ladder.ts`, varied openings, colors alternating), 2026-11-22:
Medium beat Easy 8-0, Hard beat Medium 8-0, Expert beat Hard 6-0. Every level beats the one
below it; the absolute ratings remain estimates.
