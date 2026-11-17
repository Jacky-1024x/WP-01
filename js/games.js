// 游戏清单（唯一数据源）：主页据此渲染卡片，sw.js 通过 importScripts 读取并预缓存资源。
// 保持为普通脚本（非 ES module），这样 Service Worker 也能加载。
// 新增游戏时在这里追加一项；path 相对项目根目录，files/icon 相对于 path / 根目录。
self.H5_GAMES = [
  {
    id: 'klotski',
    name: '数字华容道',
    desc: '滑动数字方块，按顺序还原。3×3 到 6×6 多种难度。',
    path: 'games/klotski/',
    icon: 'icons/klotski.svg',
    tags: ['益智', '单人'],
    files: ['index.html', 'klotski.css', 'klotski.js', 'puzzle.js'],
  },
  {
    id: 'gomoku',
    name: '五子棋',
    desc: '15×15 人机对战，三档 AI 难度，可悔棋、可选先后手。',
    path: 'games/gomoku/',
    icon: 'icons/gomoku.svg',
    tags: ['棋类', '人机'],
    files: ['index.html', 'gomoku.css', 'gomoku.js', 'ai.js', 'ai-worker.js'],
  },
  {
    id: 'blackjack',
    name: '21 点',
    desc: '和庄家比点数，支持加倍、分牌，Blackjack 赔 3:2。',
    path: 'games/blackjack/',
    icon: 'icons/blackjack.svg',
    tags: ['纸牌', '休闲'],
    files: ['index.html', 'blackjack.css', 'blackjack.js', 'engine.js'],
  },
  {
    id: 'mahjong',
    name: '卡五星',
    desc: '湖北三人麻将。屁胡只能自摸，卡五星、杠上炮和大胡可以接炮。',
    path: 'games/mahjong/',
    icon: 'icons/mahjong.svg',
    tags: ['麻将', '人机'],
    files: ['index.html', 'mahjong.css', 'mahjong.js', 'engine.js', 'ai.js', 'tiles.js'],
  },
  {
    id: 'codelights',
    name: '密码灯',
    desc: '猜出 4 盏灯的颜色和顺序，4–7 种颜色可选，7 次机会，简单 / 进阶两种提示。',
    path: 'games/codelights/',
    icon: 'icons/codelights.svg',
    tags: ['益智', '推理'],
    files: ['index.html', 'codelights.css', 'codelights.js', 'engine.js'],
  },
];
