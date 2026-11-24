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

**Pass and play: say plainly what the board does, and let players pick how pieces face**
(Jay's call, 2026-11-23). "Turns each move" read as "sit across and the pieces turn to face
you", which is what "Stays put" actually did. The board choice is now "Spins each move" (hand
the device over) or "Stays put" (lay it flat, sit across), with a line explaining both. With
the board still, a second choice sets which way the pieces point: toward their own player (the
old behavior and the default), toward whoever's turn it is (they swing round after each move),
all one way (upright for White's side), or sideways (a quarter turn, readable from both sides).
Each option has a tiny picture, because the hints are hidden on phones (picture proposed,
approved).

**A draw offer is answered on the other player's side** (Jay's call). In pass and play the
accept/decline prompt sits on the board at the edge of the player who must answer, turned to
face them when they sit at the top. The offering player's panel says who it's waiting for and
can take the offer back. With a spinning board it shows in the middle and says to hand the
device over.

**The bot takes a human-feeling beat** (Jay's call). Each reply lands at a random 1 to 3
seconds instead of almost at once. Its real thinking time counts inside that wait, so Expert
isn't slowed further. On the clock the wait comes out of the bot's own time, so it's capped at
5% of what the bot has left (build default) and the pause can't lose it the game.

**Static under the checkmate crackle** (Jay's call). The mated king's square now has a quiet,
steady crushed-static hiss under the glitch bursts, so it isn't only isolated pops. It wobbles
slowly like a weak signal, fades out with the bursts over about 45 seconds, follows the sound
switch, and goes quiet when the tab is hidden. Like the rest of the sound, it's off unless
sound is on, and with reduced motion (no crackle animation) there's no static either.
Update 2026-11-23 (Jay's call): the hiss was too sharp, so it's now smooth pink noise through a
low-pass filter, slightly quieter, with no wobble: a soft, constant wash. The crackle bursts
on top keep their crunchy grain. Trade-off: less "bad signal" character, much easier to sit with.

**Click on home-screen choices** (Jay's call). With sound on, picking any setting on the home
screen (opponent, level, side, board, facing, clock) plays the short soft "select" blip. Only
when sound is on and the tab is visible, like every other sound.

**Usage counts** (Jay's call to add them; what's counted is a build default). To see which
options people choose and what they do most: setup choices, games started (from the menu or
"Play again") and their settings, how games end, games left unfinished, and uses of undo,
draw offers, resign, pause, sound, Share GIF, Copy PGN and hiding the result. Sent with a random
id per visit (nothing kept between visits) and a phone/desktop flag. Never moves, positions,
names or a device fingerprint. Skipped when the browser sends Do Not Track or Global Privacy
Control.

**Where the usage counts go** (Jay's call, 2026-11-23). To a new table in the UX Portfolio
Supabase project, where the portfolio already lives, through a small public receiver
(`supabase/`). No new account or service, and the counts are read with SQL in the Supabase
dashboard. The trade-off: no ready-made charts, and the address is public, so anyone could pad
the numbers. The receiver only stores small, well-formed events from a known app. Only the live
site counts (Jay's call): the game sends nothing from local builds, previews or tests, and the
receiver drops anything not sent from jayfox.design.

**One shared table for every Lab project** (Jay's call). Jay wants counts from all the Lab
projects, so the table is `lab_events` with an `app` column, rather than one table per game.
Each project sends `app_open` once per page load, with a single word for where the visit came
from (the Lab page, elsewhere on the site, another site, or direct), so the Lab can list its
projects in order of interest (Jay's ask; the event and the word are build defaults). If Quick
Chess moves to its own site, its rows and the receiver move with it (Jay's call); how to do
that is in `supabase/README.md`.

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

**Phone menu: pieces back, slimmer cards** (Jay's call). The three neon pieces were hidden on
phones; they now sit small (38px) to the right of the headline. The menu was also a bit large,
so cards, labels, gaps and the Start button are trimmed on phones (about 15% shorter overall).
Tap targets stay at least 40px tall.
