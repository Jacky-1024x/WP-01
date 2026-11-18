// 主页入口的使用记录：每个游戏的点击次数和最后点击时间，只存在本机。
// 排序：次数多的在前；次数相同时最近点过的在前；从没点过的保持游戏清单中的原顺序，排在最后。

export const USAGE_KEY = 'h5.home.usage';

function valid(entry) {
  return !!entry && Number.isInteger(entry.count) && entry.count > 0 && Number.isFinite(entry.last);
}

export function recordClick(usage, id, now = Date.now()) {
  const prev = valid(usage[id]) ? usage[id] : { count: 0, last: 0 };
  return { ...usage, [id]: { count: prev.count + 1, last: now } };
}

export function sortByUsage(games, usage) {
  const stat = (g) => (valid(usage?.[g.id]) ? usage[g.id] : { count: 0, last: 0 });
  return games
    .map((game, index) => ({ game, index, ...stat(game) }))
    .sort((a, b) => b.count - a.count || b.last - a.last || a.index - b.index)
    .map((e) => e.game);
}
