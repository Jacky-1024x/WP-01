// 所有页面共享：注册 Service Worker，并屏蔽 iOS 上干扰游戏的缩放手势。

const ROOT = new URL('../', import.meta.url);

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker
    .register(new URL('sw.js', ROOT), { scope: ROOT.pathname })
    .catch((err) => console.warn('Service Worker 注册失败', err));
  // 新版本接管后自动刷新一次，保证页面与缓存版本一致
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}

export function preventZoom() {
  // iOS Safari 会忽略 user-scalable=no，这里兜底拦截双指缩放与双击放大
  const stop = (e) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  document.addEventListener('gesturechange', stop, { passive: false });
  document.addEventListener('dblclick', stop, { passive: false });
  let lastTouchEnd = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd < 300 && !e.target.closest('input, textarea, select, button, a')) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false },
  );
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
}

export function toast(text, ms = 1600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function storage(key, fallback) {
  return {
    get() {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* 隐私模式或配额已满时忽略 */
      }
    },
  };
}

export function initPage() {
  registerServiceWorker();
  preventZoom();
}
