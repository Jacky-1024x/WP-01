import { generate } from './generator.js';

self.onmessage = (e) => {
  const { id, n } = e.data;
  self.postMessage({ id, puzzle: generate(n) });
};
