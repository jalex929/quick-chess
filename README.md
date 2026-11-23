# Quick Chess

Fast neon chess in the browser. Play a bot or pass the device to a friend, with or without a
clock. No accounts; an unfinished game survives a reload.

## What it does

- **vs Bot** at four levels aimed at ~400 / ~800 / ~1200 / 1800+ ratings (Easy, Medium, Hard,
  Expert), as White, Black or random. Undo in untimed games. Ratings are targets; the levels are
  checked against each other with `scripts/ladder.ts` (see [DECISIONS.md](DECISIONS.md)).
- **Pass & play**: the board turns for whoever's move it is, or stays put for face-to-face play
  (the far side's pieces and clock are drawn upside down).
- **Clocks**: none (casual), 3 + 2 and 5 min (blitz), 10 min and 15 + 10 (rapid); "+ 2" adds
  2 seconds after each move. Time starts after White's first move; leaving the tab pauses it.
- All the rules: check, mate, stalemate, castling, en passant, promotion (with a picker),
  threefold repetition, fifty moves, insufficient material, timeouts (a draw if the other
  side can't mate), resign, draw offers.
- Tap-tap or drag to move, legal-move markers, last move and check highlighted with shape as
  well as color. Keyboard play (arrow keys, Enter) with spoken square names and moves.
- Move list; copy the game as PGN at the end.
- Motion: moves slide, captures glitch apart, a king in check glitches. At checkmate the king
  glitches out like a capture (green if you won, red if you lost) and its ghost keeps
  crackling; draws freeze the board in amber. The result appears as a band across the board
  (hide it to study the final position). Reduced motion turns this off.
- Share GIF: an animated replay of the last 10 moves, made in the browser, ending on
  VICTORY / DEFEAT / DRAW. Recorded examples in `docs/media/`.
- Optional sound effects, synthesized in the browser (no audio files); off by default.
- Anonymous usage counts on the live site only (no moves, names or fingerprints; skipped with
  Do Not Track or Global Privacy Control). They go to a small receiver in Supabase, see
  [`supabase/README.md`](supabase/README.md).

## How it's built

React 18 + Vite + TypeScript. `src/engine` is plain TypeScript with no React:

- `game.ts`: the game is its move list; rules come from [chess.js](https://github.com/jhlywa/chess.js) (BSD-2-Clause).
- `position.ts`: a small, fast move generator for the bot (10 × 12 mailbox board), proven
  against published perft counts for five standard test positions.
- `bot.ts`: alpha-beta search with quiescence, iterative deepening and a time budget; a
  random "wobble" makes the lower levels human. Runs in a Web Worker.
- `clock.ts`: a chess clock as plain data (no drift, pause/resume, increments).

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run check      # types, lint, format, unit tests, build
npm run test:e2e   # Playwright, desktop Chrome + Pixel 7 (builds first: npm run build)
```

## Tested

- Unit: rules wrapper, clock, bot (takes free material, escapes threats, finds mate, stays in
  budget), move generator perft to depth 3–4 on five positions, matches chess.js move lists.
- Browser (desktop Chrome and Pixel 7 emulation): start, tap and drag moves, keyboard play,
  bot reply and undo, checkmate card, promotion picker, resume after reload, clocks and pause,
  resign, no sideways scroll.
- Not tested: Safari, Firefox, real phones, screen readers by hand.

## Decisions

**[DECISIONS.md](DECISIONS.md)** walks through what was decided and why, and who made each call.

## License

MIT. Piece artwork is original to this project.
