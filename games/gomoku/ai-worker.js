import { chooseMove } from './ai.js';

self.onmessage = (e) => {
  const { id, board, player, level } = e.data;
  const result = chooseMove(board, player, level);
  self.postMessage({ id, ...result });
};
