/**
 * Plays bot levels against each other to check the ladder: each level should beat the one
 * below it. Usage: npx vite-node scripts/ladder.ts <lower> <higher> [games]
 * Games start from a handful of common openings, with colors alternating.
 */
import { chooseMove, type BotLevel } from "../src/engine/bot";
import { Game, fromUci } from "../src/engine/game";

const OPENINGS = [
  ["e2e4", "e7e5"],
  ["d2d4", "d7d5"],
  ["e2e4", "c7c5"],
  ["d2d4", "g8f6"],
  ["c2c4", "e7e5"],
  ["e2e4", "e7e6"],
  ["g1f3", "d7d5"],
  ["e2e4", "c7c6"],
];

const [lower, higher, count = "6"] = process.argv.slice(2) as [BotLevel, BotLevel, string?];
const games = Number(count);
const MAX_PLIES = 200;

let higherPoints = 0;
const results: string[] = [];
for (let i = 0; i < games; i++) {
  const higherIsWhite = i % 2 === 0;
  let game = new Game(OPENINGS[i % OPENINGS.length]);
  while (game.outcome().kind === "playing" && game.moves.length < MAX_PLIES) {
    const whiteToMove = game.turn() === "w";
    const level = whiteToMove === higherIsWhite ? higher : lower;
    const choice = chooseMove(game.moves, level);
    if (!choice) break;
    game = game.play(fromUci(choice.uci)) ?? game;
  }
  const o = game.outcome();
  let points = 0.5;
  let text = o.kind === "playing" ? "draw (move limit)" : o.kind;
  if (o.kind === "checkmate") {
    const higherWon = (o.winner === "w") === higherIsWhite;
    points = higherWon ? 1 : 0;
    text = `${higherWon ? higher : lower} wins by checkmate`;
  }
  higherPoints += points;
  results.push(
    `game ${i + 1} (${higher} ${higherIsWhite ? "White" : "Black"}): ${text}, ${game.moves.length} plies`,
  );
  console.log(results.at(-1));
}
console.log(`${higher} vs ${lower}: ${higherPoints} / ${games} for ${higher}`);
