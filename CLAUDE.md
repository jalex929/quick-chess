# Working in quick-chess

Read `README.md` and `DECISIONS.md` first.

- Rules shown to the player come from chess.js via `src/engine/game.ts`. The bot uses its own
  fast generator in `position.ts`; any change there must keep the perft tests passing.
- Keep the bot off the main thread (Web Worker) and inside its time budget.
- Look: neon night-city, genre-inspired only. Never use another game's name, logo, signature
  palette, characters, places or UI.
- Never show state by color alone; every control reachable by keyboard; respect reduced motion.
- Before pushing: `npm run check`, and `npm run build && npm run test:e2e` when the UI changed.
- Commits use the GitHub no-reply email, never a personal address.
