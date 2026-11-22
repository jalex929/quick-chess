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
