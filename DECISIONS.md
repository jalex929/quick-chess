# Decisions

How Quick Chess was set up on purpose: what was decided, why, and what was left out. Each
decision says who made it:

- **Jay's call:** a product or design decision Jay Fox made.
- **Proposed, approved:** suggested during the build and accepted by Jay.
- **Build default:** an engineering choice made while building it, kept because it worked.
  Open to change.

Quick Chess was designed by Jay Fox and built with an AI coding assistant (Claude) as a pair
programmer. Jay set the direction, reviewed every change in the browser, and made the calls
marked below.

## What it is for

A quick, good-looking game of chess in the browser: against a bot or with a friend on one
device. It's a free, non-commercial side project (Jay's call) in the Lab on
[jayfox.design](https://jayfox.design/lab), built to explore motion, sound and game feel as
much as chess.

## Product decisions

**Neon night-city look, genre only** (Jay's call, with one adjustment). Jay wanted its own
vibe rather than the portfolio's brand colors, inspired by cyberpunk: neon, terminals, glitch.
Jay also suggested borrowing more from one specific game; that was kept to the genre instead, so
no names, logos, signature palettes, characters or UI are taken from any game, even for
non-commercial use.

**Plain words over insider jargon** (Jay's call). The setup headline first said "Jack in",
which only makes sense to cyberpunk fans. Jay replaced it with "Power up".

**Two ways to play, four bot levels** (Jay's call on the levels). Vs Bot or Pass & Play.
Easy, Medium, Hard and Expert, aimed at about 400, 800, 1200 and 1800+ ratings, so a beginner
and a club player both have something to play.

**Clocks explained in one line each** (Jay's call). Each time control says what it is (Casual,
Blitz, Rapid), with a note that "+ 2" adds 2 seconds after every move, for people who don't
play timed chess.

**The ending is a moment** (Jay's direction over many rounds):

- At checkmate the king glitches apart like a capture, in green if you won and red if you
  lost, and its square keeps crackling with static afterwards, so the final board stays
  interesting.
- A draw freezes the board in amber, a neutral color.
- The result word (VICTORY, DEFEAT, DRAW) appears first, then a short terminal log types out.
- It shows as a band across the board, not a pop-up over a dark overlay, so it feels like
  part of the game. You can hide it to study the final position.
- A main-menu button is right there at the end of a match.

**Share a replay** (Jay's idea). A GIF of the last 10 moves, made in the browser, ending on the
result word. Made on the device, so nothing is uploaded.

**Sound is optional and off by default** (Jay's call to add it; off by default proposed,
approved). Synthesized in the browser, so there are no audio files to license.

**Phone menu condensed** (Jay's call). The match setup was more than a screen tall on small
phones. It now fits on most phones, with Start right after the last choice.

**Open source under MIT** (Jay's call).

## Design decisions

**Motion with a fallback** (Jay's call). Moves slide, captures glitch apart, and a king in
check glitches. With reduced motion turned on, all of it is off.

**Never color alone** (build default, matching Jay's standard). Last move, check and selection
are shown with shape as well as color, and the result is a word, not just green or red.

**Original pieces** (build default). The piece artwork was drawn for this project.

## Engineering decisions

**Rules from chess.js, own move generator for the bot** (build default). chess.js
(BSD-2-Clause) is well tested and gives notation, PGN and every draw rule, so the rules the
player sees come from it. It's too slow for a bot to search with (about 800 move lists a
second), so the bot uses a small generator of its own, proven against published "perft" move
counts. Stockfish was ruled out: its GPL license doesn't fit an MIT project, and it's far
stronger than a casual game needs.

**The game is its move list** (build default). Board, turn, check and result are worked out by
replaying the moves, so saving, undo and resuming after a reload are simple list edits.
Resigning, running out of time and agreed draws are stored separately.

**The bot thinks off the main thread** (build default). It runs in a Web Worker within a time
budget, so the board never freezes while it thinks.

**How each level gets its character** (proposed, approved). Ratings are targets the levels
were tuned toward, not measured; a real rating needs many games against rated players.

| Level  | Target | How far it looks ahead                               | Human touches                         |
| ------ | ------ | ---------------------------------------------------- | ------------------------------------- |
| Easy   | ~400   | 1 half-move, material and placement only             | big random wobble; 22% careless moves |
| Medium | ~800   | 2 half-moves + captures                              | medium wobble; 6% careless moves      |
| Hard   | ~1200  | 3 half-moves + captures, full evaluation             | small wobble                          |
| Expert | 1800+  | deepens until ~2.5 s are up (usually 6–8 half-moves) | none                                  |

Every level takes a mate in one and never walks into one. Expert adds a transposition table,
better move ordering and check extensions.

Ladder check (`scripts/ladder.ts`, varied openings, colors alternating), 2026-11-22: Medium
beat Easy 8-0, Hard beat Medium 8-0, Expert beat Hard 6-0. Each level beats the one below; the
absolute ratings are still estimates.

**Where it's hosted** (proposed, approved). Inside the portfolio rather than on its own site:
the portfolio's sync script builds this repo and copies it to `/lab/quick-chess/`, published
with the portfolio through Bolt (Netlify). The short address `jayfox.design/quick-chess`
redirects there (Jay's request).

## Deliberately not done

- No online play, accounts or ratings: it's a quick local game.
- No lifted look from any specific game (see above).
- No paid features or ads: it's non-commercial.

## Honest limits

- The bot ratings are estimates, checked only against each other.
- Tested in headless Chromium (desktop, and emulated Pixel 7, iPhone 13 and iPhone SE).
  **Not yet tested** in Safari or Firefox, on real phones, or with a screen reader by hand.
- Expert's depth depends on the device's speed, since it stops when its time is up.
