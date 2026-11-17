# H5-Game

浏览器里直接运行的 H5 小游戏合集，支持作为 **PWA** 安装到 iPhone / Android 主屏幕，**离线可玩**。

纯 HTML / CSS / 原生 JavaScript（ES modules），**没有构建步骤**，任意静态服务器或 GitHub Pages 都能直接部署；所有路径都是相对路径，部署在子路径（如 `/H5-Game/`）下也能正常工作。

## 已有游戏

| 游戏 | 说明 |
| --- | --- |
| 数字华容道 | 3×3 ~ 6×6 四档难度；打乱时从完成状态随机合法移动，保证必定可解；首次移动开始计时、计步；按难度记录最短用时与最少步数；支持点击（整排推动）与滑动手势 |
| 五子棋 | 15×15 人机对战（自由五子棋，无禁手）；简单 / 普通 / 困难三档 AI；可选执黑先手或执白后手；悔棋、重新开始、获胜连线高亮、最后一手标记、防误触的「确认落子」模式；对局自动保存 |
| 21 点 | 6 副牌，庄家软 17 停牌，Blackjack 赔 3:2；支持加倍、分牌（最多 4 手，分 A 只补一张）；庄家明牌为 A / 10 点时先查暗牌；筹码与牌局自动保存，输光可领取救济筹码；记录战绩与最高筹码 |
| 密码灯 | Mastermind 类推理游戏：答案是 4–7 种颜色（可选，默认 4 种）中的 4 种（不重复），7 次机会；简单模式逐盏提示、进阶模式只给数量；底部「下一盏 / 换色 / 确定」三键单手操作，同一行颜色互斥；确认后不可撤销；对局自动保存，按模式和颜色数量记录战绩。设计文档见 `docs/codelights/PRD.md` |
| 数独 | 9×9 经典数独，简单 / 中等 / 困难 / 专家四档：难度按解题所需的最难技巧划分，每题都校验唯一解且只靠逻辑即可解出（不需要猜）；在 Web Worker 中实时出题，超时改用内置题库并做等价变换；笔记（候选数）、自动笔记、填数自动清除笔记、撤销 / 重做、即时纠错或只查冲突；每局 3 次三级提示（指方向 → 讲方法 → 给答案）；对局自动保存，按难度记录最佳用时、完美通关与连胜。设计文档见 `docs/sudoku/PRD.md` |

## 项目结构

```
H5-Game/
├── index.html              # 主页（游戏列表）
├── manifest.webmanifest    # PWA 清单
├── sw.js                   # Service Worker：预缓存全部资源，离线可用
├── css/
│   ├── common.css          # 共享样式：配色变量/深色模式、安全区、按钮、弹窗等
│   └── home.css            # 主页样式
├── js/
│   ├── games.js            # 游戏清单（唯一数据源，主页与 sw.js 共用）
│   ├── home.js             # 主页渲染
│   ├── pwa.js              # 共享工具：注册 SW、屏蔽缩放手势、localStorage、toast
│   └── sfx.js              # 通用音效（Web Audio 实时合成）与音效开关
├── games/
│   ├── klotski/            # 数字华容道
│   │   ├── index.html
│   │   ├── klotski.css
│   │   ├── klotski.js      # 界面与交互
│   │   └── puzzle.js       # 纯逻辑（打乱、可解性校验、移动）
│   ├── gomoku/             # 五子棋
│   │   ├── index.html
│   │   ├── gomoku.css
│   │   ├── gomoku.js       # 界面、canvas 绘制、对局流程
│   │   ├── ai.js           # AI 纯逻辑
│   │   └── ai-worker.js    # 在 Web Worker 中运行 AI，避免卡住界面
│   ├── blackjack/          # 21 点
│   │   ├── index.html
│   │   ├── blackjack.css
│   │   ├── blackjack.js    # 界面、下注与发牌动画
│   │   └── engine.js       # 纯逻辑（牌靴、点数、要牌/停牌/加倍/分牌、结算）
│   ├── codelights/         # 密码灯
│   │   ├── index.html
│   │   ├── codelights.css
│   │   ├── codelights.js   # 界面、反馈动画、存档与战绩
│   │   └── engine.js       # 纯逻辑（出题、判定、选中/换色/颜色互斥、提交、存档校验）
│   └── sudoku/             # 数独
│       ├── index.html
│       ├── sudoku.css
│       ├── sudoku.js       # 界面、高亮、笔记、提示面板、计时、存档与统计
│       ├── board.js        # 纯逻辑（填数/笔记/撤销、冲突检测、提示选择、存档校验）
│       ├── solver.js       # 纯逻辑（回溯数解、逻辑求解器：技巧识别与难度评级）
│       ├── generator.js    # 纯逻辑（终盘生成、对称挖空、评级、题库等价变换）
│       ├── puzzles.js      # 内置题库（脚本生成）
│       └── worker.js       # 在 Web Worker 中出题
├── docs/codelights/        # 密码灯产品设计文档与配图
├── docs/sudoku/            # 数独产品设计文档与配图
├── icons/                  # SVG 源图标与生成的 PNG（180 / 192 / 512）
├── scripts/gen-icons.sh    # 从 icons/icon.svg 生成 PNG 图标
├── scripts/gen-sudoku-bank.mjs  # 重新生成数独内置题库
├── tests/smoke.mjs         # 冒烟测试（华容道可解性、五子棋 AI、21 点规则与结算、密码灯规则、数独出题与对局逻辑）
└── package.json            # 仅用于声明 ES module 与快捷脚本，无任何依赖
```

## 本地运行

Service Worker 和 ES modules 需要通过 HTTP 访问（不能直接双击打开 `file://`）：

```bash
git clone git@github.com:Jacky-1024x/H5-Game.git
cd H5-Game
python3 -m http.server 8000
# 浏览器访问 http://localhost:8000/
```

想在手机上调试：保证手机与电脑在同一局域网，访问 `http://<电脑IP>:8000/`。注意 Service Worker 只在 `localhost` 或 HTTPS 下生效，局域网 HTTP 访问时游戏可以玩，但离线缓存不会启用。

运行冒烟测试（需要 Node.js 18+，约 1 分钟，包含 AI 自对弈）：

```bash
node tests/smoke.mjs
```

## 部署到 GitHub Pages

1. 推送代码到 GitHub 仓库的 `main` 分支。
2. 打开仓库 **Settings → Pages**，**Source** 选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`，保存。
3. 等待一两分钟，访问 `https://<用户名>.github.io/H5-Game/`（本仓库即 `https://jacky-1024x.github.io/H5-Game/`）。

GitHub Pages 自带 HTTPS，满足 PWA 要求。

## 添加到 iPhone 主屏幕

1. 用 iPhone 上的 **Safari** 打开上面的网址（必须是 Safari）。
2. 点击底部工具栏的 **分享** 按钮 → 选择 **“添加到主屏幕”** → 点 **添加**。
3. 从主屏幕图标启动后为全屏模式，打开过一次后即可离线游玩；游戏进度与最佳成绩保存在本机。

## 新增游戏

1. 在 `games/` 下新建目录，例如 `games/snake/`，放入 `index.html` 及其 CSS / JS。可以复制现有游戏的 `index.html` 作为模板，保留：
   - `<head>` 中的 viewport、`apple-mobile-web-app-*`、manifest、apple-touch-icon 等 meta 与 link（路径用 `../../`）；
   - 引用 `../../css/common.css`；
   - 顶栏中返回主页的链接 `<a class="icon-btn" href="../../">`；
   - 顶栏中的音效开关 `<button class="icon-btn" data-sound-toggle aria-label="音效开关"></button>`；
   - 在脚本中 `import { initPage } from '../../js/pwa.js'; initPage();`（注册 Service Worker、屏蔽缩放手势、启用音效）。
2. 在 `js/games.js` 的 `H5_GAMES` 数组中追加一项：

   ```js
   {
     id: 'snake',
     name: '贪吃蛇',
     desc: '一句话介绍',
     path: 'games/snake/',
     icon: 'icons/snake.svg',
     tags: ['休闲'],
     files: ['index.html', 'snake.css', 'snake.js'], // 需要离线缓存的文件，相对 path
   },
   ```

   主页会自动出现新卡片，Service Worker 也会自动预缓存 `files` 中列出的文件。
3. **修改 `sw.js` 顶部的 `VERSION`**（例如 `v1.0.0` → `v1.1.0`）。Service Worker 采用缓存优先策略，每次发布任何改动都要更新版本号，用户下次打开时才会拿到新版本（新版本接管后页面会自动刷新一次）。

## 音效

`js/sfx.js` 用 Web Audio API 实时合成音效，没有音频文件，离线可用、无加载延迟；首次触摸 / 点击 / 按键时解锁音频（浏览器要求），开关状态保存在本机。

- **自动点击音**：所有页面的 `button` 和 `a` 点击时自动播放 `tap`，带 `aria-pressed` 的切换按钮播放 `select`。可用 `data-sfx="chip"` 等指定其他音效，`data-sfx="none"` 关闭。
- **在游戏中播放**：`import { play } from '../../js/sfx.js'; play('place');`，第二个参数为延迟秒数，如 `play('win', 0.3)`。

| 分类 | 名称 | 用途 |
| --- | --- | --- |
| 界面 | `tap` / `select` / `error` | 按钮点击 / 切换选择 / 无效操作 |
| 游戏 | `move` / `place` / `card` / `chip` | 滑动移动 / 落子放置 / 发牌翻牌 / 筹码金币 |
| 结果 | `win` / `lose` / `draw` | 胜利 / 失败 / 平局 |

修改 `icons/icon.svg` 后可运行 `bash scripts/gen-icons.sh` 重新生成 PNG（依次尝试 rsvg-convert、ImageMagick、macOS 自带的 qlmanage + sips）。

## 五子棋 AI 说明

- **棋型识别**：以某点为中心取一条线上的 9 格，每格有空 / 己方 / 阻挡三种状态，启动时预计算全部 3^9 种组合对应的棋型（五连、活四、冲四、活三、眠三、活二、眠二）。棋型按「再落一子能变成什么」递归定义，跳活三、边界阻挡等都能准确识别。
- **候选点**：只考虑已有棋子周围两格内的空点，按「己方进攻棋型 + 对方防守棋型」评分（含双活三、冲四活三、双四等组合加成）排序，只保留前 K 个。
- **局面评估**：枚举全盘所有连续 5 格的「五元组」，只包含一方棋子的五元组按子数计分，落子 / 撤销时增量更新。
- **搜索**：负极大值 + alpha-beta 剪枝 + 迭代加深 + 时间限制；强制规则：能连五立即连五 → 对方冲四必须封堵 → 己方能成活四 / 双四直接判胜 → 对方有活三时只考虑封堵点或己方冲四反击；强制封堵不消耗搜索深度。
- **难度**：简单为一层贪心加随机扰动；普通为 4 层搜索（约 0.8 秒上限）；困难为最多 10 层迭代加深（约 1.3 秒上限）。三档都会执行上面的强制规则。
- AI 在 Web Worker 中运行，不会卡住界面；若浏览器不支持 module worker，会自动回退到主线程计算。
