// 通用界面组件：轻提示 / 弹窗 / 上下文菜单 / 长按

const $ = (sel) => document.querySelector(sel);

let toastTimer = null;
export function toast(msg, ms = 1900) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

/**
 * 弹窗
 * @param {{title?:string, body?:string|Node, actions?:Array, onMount?:(root:HTMLElement, close:Function)=>void}} opts
 * @returns {Promise<any>} 点击按钮的 value，点遮罩/取消为 null
 */
export function modal(opts) {
  const backdrop = $('#modal-backdrop');
  const box = $('#modal');
  box.innerHTML = '';

  return new Promise((resolve) => {
    let done = false;
    const close = (val) => {
      if (done) return;
      done = true;
      backdrop.hidden = true;
      box.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(null);
    };

    if (opts.title) {
      const h = document.createElement('h3');
      h.textContent = opts.title;
      box.appendChild(h);
    }
    if (opts.body) {
      if (typeof opts.body === 'string') {
        const wrap = document.createElement('div');
        wrap.innerHTML = opts.body;
        box.appendChild(wrap);
      } else {
        box.appendChild(opts.body);
      }
    }

    const actions = opts.actions || [{ label: '关闭', class: 'ghost', value: null }];
    const row = document.createElement('div');
    row.className = 'actions';
    for (const a of actions) {
      const btn = document.createElement('button');
      btn.className = a.class || 'ghost';
      btn.textContent = a.label;
      btn.onclick = () => {
        if (a.onClick) {
          const r = a.onClick();
          if (r === false) return;   // 阻止关闭
        }
        close(a.value !== undefined ? a.value : a.label);
      };
      row.appendChild(btn);
    }
    box.appendChild(row);

    backdrop.onclick = (e) => {
      if (e.target === backdrop) close(null);
    };
    document.addEventListener('keydown', onKey);
    backdrop.hidden = false;

    opts.onMount?.(box, close);
  });
}

/** 简单确认框 */
export function confirmDialog({ title, text, cancelText = '取消', okText = '确定', danger = false }) {
  return modal({
    title,
    body: `<p>${text}</p>`,
    actions: [
      { label: cancelText, class: 'ghost', value: false },
      { label: okText, class: danger ? 'danger' : 'primary', value: true },
    ],
  });
}

/* ---------------- 上下文菜单 ---------------- */
let ctxEl = null;

export function contextMenu(items, x, y) {
  closeContextMenu();
  const el = $('#ctxmenu');
  el.innerHTML = '';
  for (const it of items) {
    if (it.sep) {
      const sep = document.createElement('div');
      sep.style.cssText = 'height:1px;background:var(--border);margin:4px 2px';
      el.appendChild(sep);
      continue;
    }
    const btn = document.createElement('button');
    btn.textContent = it.label;
    if (it.danger) btn.classList.add('danger');
    if (it.disabled) btn.disabled = true;
    btn.onclick = (e) => {
      e.stopPropagation();
      closeContextMenu();
      it.onClick?.();
    };
    el.appendChild(btn);
  }
  el.hidden = false;

  // 避免超出屏幕
  const r = el.getBoundingClientRect();
  const px = Math.min(x, window.innerWidth - r.width - 8);
  const py = Math.min(y, window.innerHeight - r.height - 8);
  el.style.left = `${Math.max(8, px)}px`;
  el.style.top = `${Math.max(8, py)}px`;

  ctxEl = el;
  setTimeout(() => {
    document.addEventListener('pointerdown', onDocDown, { capture: true });
  }, 0);
}

function onDocDown(e) {
  if (ctxEl && !ctxEl.contains(e.target)) closeContextMenu();
}

export function closeContextMenu() {
  if (!ctxEl) return;
  ctxEl = null;
  $('#ctxmenu').hidden = true;
  document.removeEventListener('pointerdown', onDocDown, { capture: true });
}

/**
 * 长按处理：按住 500ms 且没有移动，触发 callback。
 * 返回一个清理函数。
 */
export function attachLongPress(el, callback, { ms = 500, moveTolerance = 10 } = {}) {
  let timer = null;
  let startX = 0;
  let startY = 0;

  const clear = () => {
    clearTimeout(timer);
    timer = null;
  };
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => {
      timer = null;
      callback(e);
    }, ms);
  };
  const onMove = (e) => {
    if (!timer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > moveTolerance) clear();
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', clear);
  el.addEventListener('pointercancel', clear);
  el.addEventListener('pointerleave', clear);

  return () => {
    clear();
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', clear);
    el.removeEventListener('pointercancel', clear);
    el.removeEventListener('pointerleave', clear);
  };
}
