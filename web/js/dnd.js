// 图片拖拽：鼠标直接拖；触屏长按 0.35 秒后拖（不影响列表滚动）
import { toast } from './ui.js';

const targets = new Map();   // Element -> { drop(payload, clientX, clientY) }
let session = null;

export function registerDropTarget(el, handler) {
  targets.set(el, handler);
  el.dataset.dropTarget = '1';
}

export function unregisterDropTarget(el) {
  targets.delete(el);
  delete el.dataset.dropTarget;
}

export function isDragging() {
  return !!session;
}

/**
 * 开始拖拽
 * @param {{imgs: Array, source: 'library'|'group', ghostUrl?: string}} payload
 * @param {number} x 起始 clientX
 * @param {number} y 起始 clientY
 */
export function startDrag(payload, x, y) {
  if (session) return;
  const ghost = document.getElementById('drag-ghost');
  ghost.src = payload.ghostUrl || '';
  ghost.hidden = !payload.ghostUrl;
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;

  session = { payload, lastTarget: null, x, y };

  // 拖动期间阻止页面滚动（触屏）
  const blockScroll = (e) => {
    if (session) e.preventDefault();
  };
  document.addEventListener('touchmove', blockScroll, { passive: false });

  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('pointerup', onUp, true);
  document.addEventListener('pointercancel', onUp, true);

  document.body.style.userSelect = 'none';
  document.body.style.cursor = 'grabbing';
  document.addEventListener('contextmenu', preventCtx, true);

  // 拖出后的兜底提示
  setTimeout(() => {
    if (session && !session.moved) toast('拖到分组或画布格子里松手', 1400);
  }, 600);

  function preventCtx(e) {
    e.preventDefault();
  }

  function onMove(e) {
    if (!session) return;
    session.moved = true;
    session.x = e.clientX;
    session.y = e.clientY;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;

    const hit = findTarget(e.clientX, e.clientY);
    if (session.lastTarget && session.lastTarget !== hit) {
      session.lastTarget.classList.remove('drop-hot');
    }
    session.lastTarget = hit;
    if (hit) hit.classList.add('drop-hot');
  }

  function onUp(e) {
    if (!session) return;
    const { payload } = session;
    const hit = findTarget(e.clientX, e.clientY);
    cleanup();
    if (hit) {
      const handler = targets.get(hit);
      handler?.drop(payload, e.clientX, e.clientY);
    }
  }

  function cleanup() {
    document.removeEventListener('touchmove', blockScroll, { passive: false });
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('pointerup', onUp, true);
    document.removeEventListener('pointercancel', onUp, true);
    document.removeEventListener('contextmenu', preventCtx, true);
    if (session?.lastTarget) session.lastTarget.classList.remove('drop-hot');
    ghost.hidden = true;
    ghost.src = '';
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    session = null;
  }
}

function findTarget(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest('[data-drop-target]');
}

/**
 * 给元素绑定「按下后可拖出」的能力
 * - 鼠标：移动 6px 即开始拖
 * - 触屏：按住 350ms 后开始拖
 * @param {HTMLElement} el
 * @param {() => ({imgs: Array, source: string, ghostUrl?: string})|null} getPayload
 * @param {{onTap?: (e)=>void, holdMs?: number}} opts
 */
export function attachDraggable(el, getPayload, opts = {}) {
  const holdMs = opts.holdMs ?? 350;
  let start = null;
  let timer = null;
  let dragged = false;

  const cancelTimer = () => {
    clearTimeout(timer);
    timer = null;
  };

  const beginDrag = (e) => {
    const payload = getPayload();
    if (!payload || !payload.imgs?.length) return false;
    dragged = true;
    cancelTimer();
    startDrag(payload, e.clientX, e.clientY);
    cleanup();
    return true;
  };

  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType };
    dragged = false;

    if (e.pointerType !== 'mouse') {
      cancelTimer();
      timer = setTimeout(() => {
        if (start && !dragged) beginDrag({ clientX: start.x, clientY: start.y });
      }, holdMs);
    }
  };

  const onMove = (e) => {
    if (!start || dragged) return;
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (e.pointerType === 'mouse') {
      if (dist > 6) beginDrag(e);
    } else if (dist > 10) {
      // 手指在动 = 用户在滚动列表，放弃长按拖拽
      cancelTimer();
      start = null;
    }
  };

  const onUp = (e) => {
    cancelTimer();
    const wasStart = start;
    start = null;
    if (!dragged && wasStart && opts.onTap) {
      const dist = Math.hypot(e.clientX - wasStart.x, e.clientY - wasStart.y);
      if (dist < 10) opts.onTap(e);
    }
  };

  const cleanup = () => {
    cancelTimer();
    start = null;
    dragged = false;
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
  };

  el.addEventListener('pointerdown', (e) => {
    onDown(e);
    if (!start) return;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  });

  return () => {
    cleanup();
  };
}
