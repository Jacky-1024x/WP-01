import { createPuzzle } from './generator.js';

self.onmessage = (e) => {
  const { id, difficulty } = e.data;
  self.postMessage({ id, ...createPuzzle(difficulty) });
};
