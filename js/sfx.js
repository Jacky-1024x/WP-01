// 通用音效：用 Web Audio 实时合成，无需音频文件，离线可用、零加载延迟。
// 用法：import { play } from '../../js/sfx.js'; play('place');
// 页面中的 button / a 会自动播放点击音效：
//   data-sfx="名称" 指定其他音效，data-sfx="none" 不播放；带 aria-pressed 的按钮默认用 select。
// 带 data-sound-toggle 的按钮会成为音效开关。
//
// 可用音效：
//   界面：tap（按钮点击） select（切换/选择） error（无效操作）
//   游戏：move（滑动/移动） place（落子/放置） card（发牌/翻牌） chip（筹码/金币）
//   结果：win（胜利） lose（失败） draw（平局）

const MUTE_KEY = 'h5.sfx.muted';
const MASTER_VOLUME = 0.6;

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = readMuted();
const lastPlayed = new Map();

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

// 浏览器要求在用户手势中创建/恢复 AudioContext（iOS 尤其严格）
function unlock() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  if (!ctx) {
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(ctx.destination);
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
}

function envelope(t, dur, peak, attack) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  return g;
}

function tone(t, freq, dur, { type = 'sine', gain = 0.2, to, attack = 0.004 } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = envelope(t, dur, gain, attack);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noise(t, dur, { filter = 'bandpass', freq = 2000, to, q = 1, gain = 0.2, attack = 0.003 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = envelope(t, dur, gain, attack);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function notes(t, freqs, step, last, opts) {
  freqs.forEach((f, i) => {
    const isLast = i === freqs.length - 1;
    tone(t + i * step, f, isLast ? last : step * 1.6, opts);
  });
}

const SOUNDS = {
  tap(t) {
    tone(t, 1250, 0.045, { type: 'triangle', gain: 0.22, to: 750 });
    noise(t, 0.012, { filter: 'highpass', freq: 3500, gain: 0.06 });
  },
  select(t) {
    tone(t, 700, 0.05, { type: 'triangle', gain: 0.16 });
    tone(t + 0.045, 1050, 0.07, { type: 'triangle', gain: 0.16 });
  },
  error(t) {
    tone(t, 190, 0.09, { type: 'square', gain: 0.07, to: 150 });
    tone(t + 0.11, 170, 0.12, { type: 'square', gain: 0.07, to: 130 });
  },
  move(t) {
    noise(t, 0.07, { freq: 1400, to: 600, q: 1.5, gain: 0.22 });
    tone(t, 320, 0.05, { gain: 0.1, to: 200 });
  },
  place(t) {
    tone(t, 230, 0.1, { gain: 0.45, to: 110, attack: 0.002 });
    tone(t, 950, 0.03, { type: 'triangle', gain: 0.1, attack: 0.001 });
    noise(t, 0.018, { freq: 2600, gain: 0.18, attack: 0.001 });
  },
  card(t) {
    noise(t, 0.09, { freq: 4200, to: 1800, q: 0.8, gain: 0.28, attack: 0.006 });
    noise(t + 0.06, 0.02, { filter: 'highpass', freq: 2500, gain: 0.08 });
  },
  chip(t) {
    for (const [dt, base] of [[0, 2300], [0.055, 2600]]) {
      tone(t + dt, base, 0.12, { gain: 0.08, attack: 0.001 });
      tone(t + dt, base * 1.52, 0.09, { gain: 0.05, attack: 0.001 });
      tone(t + dt, base * 2.13, 0.06, { gain: 0.03, attack: 0.001 });
    }
  },
  win(t) {
    notes(t, [523, 659, 784, 1047], 0.09, 0.4, { type: 'triangle', gain: 0.18 });
    tone(t + 0.27, 1568, 0.35, { gain: 0.05 });
  },
  lose(t) {
    notes(t, [392, 330, 262], 0.16, 0.45, { type: 'triangle', gain: 0.18 });
  },
  draw(t) {
    notes(t, [523, 523], 0.14, 0.2, { type: 'triangle', gain: 0.15 });
  },
};

export function play(name, delay = 0) {
  if (muted || !ctx || !SOUNDS[name]) return;
  if (ctx.state !== 'running') ctx.resume().catch(() => {});
  // 同一音效 25ms 内只播一次，避免叠音爆音
  const now = performance.now() + delay * 1000;
  if (now - (lastPlayed.get(name) ?? -1e9) < 25) return;
  lastPlayed.set(name, now);
  SOUNDS[name](ctx.currentTime + 0.005 + delay);
}

export const isMuted = () => muted;

export function setMuted(value) {
  muted = !!value;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* 隐私模式下忽略 */
  }
  renderToggles();
}

const ICON_ON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_OFF =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M16 9.5l5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function renderToggles() {
  for (const btn of document.querySelectorAll('[data-sound-toggle]')) {
    btn.innerHTML = muted ? ICON_OFF : ICON_ON;
    btn.setAttribute('aria-label', muted ? '音效已关闭' : '音效已开启');
    btn.setAttribute('aria-pressed', String(!muted));
  }
}

function soundFor(el) {
  if (el.dataset.sfx) return el.dataset.sfx;
  if (el.hasAttribute('data-sound-toggle')) return 'none';
  if (el.hasAttribute('aria-pressed')) return 'select';
  return 'tap';
}

let initialized = false;

export function initSfx() {
  if (initialized) return;
  initialized = true;
  for (const type of ['pointerdown', 'touchend', 'keydown']) {
    document.addEventListener(type, unlock, { capture: true, passive: true });
  }
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest?.('button, a, [data-sfx]');
      if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
      if (el.hasAttribute('data-sound-toggle')) {
        setMuted(!muted);
        play('select');
        return;
      }
      const name = soundFor(el);
      if (name !== 'none') play(name);
    },
    true,
  );
  renderToggles();
}
