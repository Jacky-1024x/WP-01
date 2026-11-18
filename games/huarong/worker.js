import { hint } from './engine.js';

self.onmessage = (e) => {
  const { id, pieces } = e.data;
  self.postMessage({ id, hint: hint(pieces) });
};
