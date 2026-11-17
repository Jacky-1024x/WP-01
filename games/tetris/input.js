// 输入：屏幕按键与键盘统一成「按下 / 松开某个动作」。
// 动作：left right soft（可按住） hard cw ccw hold（单次）。

const MOVE_ACTS = new Set(['left', 'right', 'soft']);

const KEYS = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowDown: 'soft',
  ' ': 'hard',
  ArrowUp: 'cw',
  x: 'cw',
  z: 'ccw',
  Control: 'ccw',
  c: 'hold',
  Shift: 'hold',
};

export function createInput({ pad, holdBox, onPress, onRelease, onPause, onRestart, enabled }) {
  const pointers = new Map(); // pointerId → 动作
  const keysDown = new Map(); // 键盘按键 → 动作
  const count = new Map(); // 动作 → 正在按住它的手指 / 按键数

  function setKey(act, on) {
    for (const el of pad.querySelectorAll(`[data-act="${act}"]`)) el.classList.toggle('on', on);
  }

  function down(act) {
    const n = count.get(act) || 0;
    count.set(act, n + 1);
    setKey(act, true);
    if (n === 0) onPress(act);
  }

  function up(act) {
    const n = count.get(act) || 0;
    if (n <= 0) return;
    count.set(act, n - 1);
    if (n === 1) {
      setKey(act, false);
      onRelease(act);
    }
  }

  // ------------------------------------------------------------ 屏幕按键
  pad.addEventListener('pointerdown', (e) => {
    const key = e.target.closest('.key');
    if (!key || !enabled()) return;
    e.preventDefault();
    const act = key.dataset.act;
    up(pointers.get(e.pointerId));
    pointers.set(e.pointerId, act);
    down(act);
  });

  // 按住移动键时手指滑到另一个移动键上：松开旧的、按下新的；滑到旋转 / 硬降上只松开，不触发
  window.addEventListener('pointermove', (e) => {
    const act = pointers.get(e.pointerId);
    if (!act || !MOVE_ACTS.has(act)) return;
    const next = document.elementFromPoint(e.clientX, e.clientY)?.closest('.key')?.dataset.act;
    if (!next || next === act) return;
    up(act);
    if (MOVE_ACTS.has(next)) {
      pointers.set(e.pointerId, next);
      down(next);
    } else {
      pointers.delete(e.pointerId);
    }
  });

  const endPointer = (e) => {
    const act = pointers.get(e.pointerId);
    if (!act) return;
    pointers.delete(e.pointerId);
    up(act);
  };
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  holdBox.addEventListener('pointerdown', (e) => {
    if (!enabled()) return;
    e.preventDefault();
    onPress('hold');
  });

  // ------------------------------------------------------------ 键盘
  // 浏览器自带的按键重复一律忽略，自动重复由游戏自己的 DAS / ARR 控制
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.altKey) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === 'Escape' || key === 'p') {
      e.preventDefault();
      if (!e.repeat) onPause();
      return;
    }
    if (key === 'r' && !e.ctrlKey) {
      if (!e.repeat) onRestart();
      return;
    }
    const act = KEYS[key];
    if (!act || !enabled()) return;
    e.preventDefault();
    if (e.repeat || keysDown.has(e.code)) return;
    document.activeElement?.blur?.();
    keysDown.set(e.code, act);
    down(act);
  });

  document.addEventListener('keyup', (e) => {
    const act = keysDown.get(e.code);
    if (!act) return;
    keysDown.delete(e.code);
    up(act);
  });

  return {
    // 暂停、失去焦点时清空所有按住状态，避免回来后方块自己一直往一边跑
    reset() {
      for (const [act, n] of count) {
        if (n > 0) {
          setKey(act, false);
          onRelease(act);
        }
      }
      count.clear();
      pointers.clear();
      keysDown.clear();
    },
  };
}
