import { initPage, storage } from './pwa.js';
import { USAGE_KEY, recordClick, sortByUsage } from './usage.js';

initPage();

const GAMES = self.H5_GAMES || [];
const usageStore = storage(USAGE_KEY, {});

const list = document.getElementById('gameList');

function createCard(game) {
  const card = document.createElement('a');
  card.className = 'game-card';
  card.href = game.path;
  card.dataset.id = game.id;
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
  return card;
}

const cards = new Map(GAMES.map((g) => [g.id, createCard(g)]));

// 只在打开主页时排序，点击后不立即挪动卡片
function renderList() {
  list.replaceChildren(...sortByUsage(GAMES, usageStore.get()).map((g) => cards.get(g.id)));
}

list.addEventListener('click', (e) => {
  const card = e.target.closest('.game-card');
  if (card) usageStore.set(recordClick(usageStore.get(), card.dataset.id));
});

// 从游戏页返回时页面可能直接从往返缓存恢复，不会重新执行脚本，这里补一次排序
window.addEventListener('pageshow', (e) => {
  if (e.persisted) renderList();
});

renderList();

const isStandalone =
  window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
if (isIOS && !isStandalone) {
  document.getElementById('installTip').hidden = false;
}
