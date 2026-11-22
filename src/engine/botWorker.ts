import { chooseMove, type BotLevel } from "./bot";

// The bot thinks here, off the main thread, so the board and clocks stay smooth.
self.onmessage = (event: MessageEvent<{ id: number; moves: string[]; level: BotLevel }>) => {
  const { id, moves, level } = event.data;
  const choice = chooseMove(moves, level);
  self.postMessage({ id, uci: choice?.uci ?? null });
};
