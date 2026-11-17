import { initPage } from './pwa.js';

initPage();

const GAMES = self.H5_GAMES || [];

const list = document.getElementById('gameList');

for (const game of GAMES) {
  const card = document.createElement('a');
  card.className = 'game-card';
  card.href = game.path;
  card.innerHTML = `
    <img class="game-icon" alt="" width="64" height="64">
    <div class="game-info">
      <h2></h2>
      <p></p>
      <div class="tags"></div>
    </div>
    <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  `;
  card.querySelector('img').src = game.icon;
  card.querySelector('h2').textContent = game.name;
  card.querySelector('p').textContent = game.desc;
  const tags = card.querySelector('.tags');
  for (const t of game.tags || []) {
    const span = document.createElement('span');
    span.textContent = t;
    tags.appendChild(span);
  }
  list.appendChild(card);
}

const isStandalone =
  window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (isIOS && !isStandalone) {
  document.getElementById('installTip').hidden = false;
}
