// 拼图画布：宫格渲染 + 拖拽换位 + 框线拖动 + 格内编辑（平移/缩放）+ 自由模式外框
// 逻辑对照 Windows 版 app/ui/canvas.py
import { settings, MIN_ART, MAX_ART } from './settings.js';
import { drawCellImage, clamp } from './renderer.js';
import { registerDropTarget, startDrag } from './dnd.js';
import { contextMenu, toast } from './ui.js';
import { dropImagesToCell, emit, store } from './store.js';
import { openBlurDialog } from './blur.js';

const EPS = 1e-6;
const MIN_CELL = 0.05;
const MAX_ZOOM = 10;

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** 从布局推断可拖动的框线 */
function computeDividers(layout) {
  const verts = new Map();
  const horiz = new Map();
  for (const [x, y, w, h] of layout) {
    const x2 = x + w;
    const y2 = y + h;
    for (const bx of [x, x2]) {
      if (bx > EPS && bx < 1 - EPS) {
        const m = verts.get(bx) || [1, 0];
        m[0] = Math.min(m[0], y);
        m[1] = Math.max(m[1], y2);
        verts.set(bx, m);
      }
    }
    for (const by of [y, y2]) {
      if (by > EPS && by < 1 - EPS) {
        const m = horiz.get(by) || [1, 0];
        m[0] = Math.min(m[0], x);
        m[1] = Math.max(m[1], x2);
        horiz.set(by, m);
      }
    }
  }
  return { verts, horiz };
}

/** 移动一条框线，返回 [新布局, 实际位移] */
function moveLayout(layout, orientation, pos, delta) {
  let lo, hi;
  if (orientation === 'v') {
    const leftMin = Math.min(...layout.filter((r) => Math.abs(r[0] + r[2] - pos) < EPS).map((r) => r[2]), MIN_CELL);
    const rightMin = Math.min(...layout.filter((r) => Math.abs(r[0] - pos) < EPS).map((r) => r[2]), MIN_CELL);
    lo = -(leftMin - MIN_CELL);
    hi = rightMin - MIN_CELL;
  } else {
    const topMin = Math.min(...layout.filter((r) => Math.abs(r[1] + r[3] - pos) < EPS).map((r) => r[3]), MIN_CELL);
    const botMin = Math.min(...layout.filter((r) => Math.abs(r[1] - pos) < EPS).map((r) => r[3]), MIN_CELL);
    lo = -(topMin - MIN_CELL);
    hi = botMin - MIN_CELL;
  }
  lo += EPS;
  hi -= EPS;
  const dx = Math.max(lo, Math.min(hi, delta));
  if (Math.abs(dx) < 1e-9) return [layout, 0];

  const next = layout.map(([x, y, w, h]) => {
    if (orientation === 'v') {
      if (Math.abs(x + w - pos) < EPS) return [x, y, w + dx, h];
      if (Math.abs(x - pos) < EPS) return [x + dx, y, w - dx, h];
    } else {
      if (Math.abs(y + h - pos) < EPS) return [x, y, w, h + dx];
      if (Math.abs(y - pos) < EPS) return [x, y + dx, w, h - dx];
    }
    return [x, y, w, h];
  });
  return [next, dx];
}

export class CollageCanvas {
  constructor(canvasEl, wrapEl) {
    this.canvas = canvasEl;
    this.wrap = wrapEl;
    this.ctx = canvasEl.getContext('2d');

    this.group = null;
    this.selected = null;
    this.editing = null;

    this.artW = settings.artW;
    this.artH = settings.artH;
    this.scale = 1;   // CSS 像素 / 画布单位
    this.k = 1;       // 设备像素 / 画布单位

    this.mode = null;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this._raf = null;
    this._press = null;
    this._holdTimer = null;

    this._bindEvents();

    this.ro = new ResizeObserver(() => {
      this.relayout();
    });
    this.ro.observe(wrapEl);

    registerDropTarget(canvasEl, {
      drop: (payload, x, y) => this._handleDrop(payload, x, y),
    });
  }

  /* ---------------- 尺寸 ---------------- */
  get gap() {
    // 有框线时有缝隙；无框线时无缝无描边
    return settings.gapEnabled ? 12 : 0;
  }

  get freeMode() {
    return settings.freeMode;
  }

  relayout() {
    const rect = this.wrap.getBoundingClientRect();
    const availW = Math.max(80, rect.width);
    const availH = Math.max(80, rect.height);
    const scale = Math.min(availW / this.artW, availH / this.artH);
    const cssW = Math.max(40, Math.floor(this.artW * scale));
    const cssH = Math.max(40, Math.floor(this.artH * scale));

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    this.scale = cssW / this.artW;
    this.k = bw / this.artW;
    this.schedule();
  }

  /** n 个 CSS 像素换算成画布单位 */
  sp(n) {
    return n / (this.scale || 1);
  }

  schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = null;
      this.draw();
    });
  }

  setGroup(group) {
    this.group = group;
    this.selected = null;
    this.editing = null;
    this.relayout();
  }

  setArtSize(w, h) {
    w = clamp(w, MIN_ART, MAX_ART);
    h = clamp(h, MIN_ART, MAX_ART);
    if (Math.abs(w - this.artW) < 0.5 && Math.abs(h - this.artH) < 0.5) return;
    this.artW = w;
    this.artH = h;
    settings.artW = w;
    settings.artH = h;
    this.relayout();
    emit('art-size-changed', { w, h });
  }

  select(index) {
    if (this.selected === index) return;
    this.selected = index;
    this.schedule();
  }

  setEditing(index) {
    if (index != null && !(index >= 0 && index < (this.group?.cells.length || 0))) index = null;
    if (this.editing === index) return;
    this.editing = index;
    if (index != null) this.selected = index;
    this.canvas.style.cursor = index != null ? 'move' : 'default';
    this.schedule();
    emit('editing-changed', index);
  }

  /* ---------------- 几何 ---------------- */
  cellRect(i) {
    const [x, y, w, h] = this.group.layout[i];
    return { x: x * this.artW, y: y * this.artH, w: w * this.artW, h: h * this.artH };
  }

  innerRect(i) {
    const r = this.cellRect(i);
    const g = this.gap;
    return { x: r.x + g / 2, y: r.y + g / 2, w: r.w - g, h: r.h - g };
  }

  hitCell(x, y) {
    if (!this.group) return -1;
    for (let i = 0; i < this.group.layout.length; i++) {
      const r = this.cellRect(i);
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return i;
    }
    return -1;
  }

  handleRects(i) {
    const r = this.innerRect(i);
    const s = Math.max(this.sp(18), 14);
    return [
      { x: r.x, y: r.y },
      { x: r.x + r.w, y: r.y },
      { x: r.x, y: r.y + r.h },
      { x: r.x + r.w, y: r.y + r.h },
    ].map((p) => ({ x: p.x - s / 2, y: p.y - s / 2, w: s, h: s }));
  }

  hitHandle(i, x, y) {
    const rects = this.handleRects(i);
    for (let k = 0; k < rects.length; k++) {
      const h = rects[k];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return k;
    }
    return null;
  }

  boardHandlePoints() {
    const w = this.artW;
    const h = this.artH;
    return {
      tl: { x: 0, y: 0 }, tr: { x: w, y: 0 }, bl: { x: 0, y: h }, br: { x: w, y: h },
      left: { x: 0, y: h / 2 }, right: { x: w, y: h / 2 },
      top: { x: w / 2, y: 0 }, bottom: { x: w / 2, y: h },
    };
  }

  hitBoardHandle(x, y) {
    if (!this.freeMode) return null;
    const r = Math.max(this.sp(14), 10);
    const pts = this.boardHandlePoints();
    for (const [kind, p] of Object.entries(pts)) {
      if (Math.hypot(x - p.x, y - p.y) <= r) return kind;
    }
    return null;
  }

  hitDivider(x, y) {
    if (!this.group || this.editing != null) return null;
    const tol = Math.max(this.sp(10), 3);
    const { verts, horiz } = computeDividers(this.group.layout);
    for (const [pos, span] of verts) {
      const px = pos * this.artW;
      const y0 = span[0] * this.artH;
      const y1 = span[1] * this.artH;
      if (Math.abs(x - px) <= tol && y >= y0 - tol && y <= y1 + tol) {
        return { orientation: 'v', pos };
      }
    }
    for (const [pos, span] of horiz) {
      const py = pos * this.artH;
      const x0 = span[0] * this.artW;
      const x1 = span[1] * this.artW;
      if (Math.abs(y - py) <= tol && x >= x0 - tol && x <= x1 + tol) {
        return { orientation: 'h', pos };
      }
    }
    return null;
  }

  nearBoarder(x, y) {
    const m = this.sp(14);
    return Math.abs(x) < m || Math.abs(x - this.artW) < m || Math.abs(y) < m || Math.abs(y - this.artH) < m;
  }

  toArt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - r.left) / r.width) * this.artW,
      y: ((clientY - r.top) / r.height) * this.artH,
    };
  }

  /* ---------------- 绘制 ---------------- */
  draw() {
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const aw = this.artW;
    const ah = this.artH;
    const k = this.k;

    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, aw, ah);

    if (!this.group || !this.group.layout.length) return;

    const g = this.gap;
    const rr = Math.min(4, this.sp(4));
    const layout = this.group.layout;

    for (let i = 0; i < layout.length; i++) {
      const cell = this.group.cells[i];
      const r = this.innerRect(i);
      if (r.w <= 0 || r.h <= 0) continue;

      if (cell && cell.image) {
        const img = cell.image.preview;
        if (img) {
          ctx.save();
          roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
          ctx.clip();
          const src = cell.blurMode && cell.blurMode !== 'none'
            ? cell.image.processed(img, cell.blurMode, cell.blurAmount)
            : img;
          drawCellImage(ctx, src, cell, r.x, r.y, r.w, r.h);
          ctx.restore();
        } else {
          // 预览图还在解码
          ctx.fillStyle = '#F3EBE2';
          roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
          ctx.fill();
          cell.image.ensurePreview().then(() => this.schedule()).catch(() => {});
        }

        // 有框线时才画格子描边（无框线 = 真正的无缝无边框）
        if (g > 0) {
          ctx.strokeStyle = '#E8DCCE';
          ctx.lineWidth = this.sp(1);
          roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
          ctx.stroke();
        }
      } else {
        // 空格子：虚线框 + 提示文字
        ctx.save();
        ctx.strokeStyle = '#D8CCC0';
        ctx.lineWidth = this.sp(1);
        ctx.setLineDash([this.sp(5), this.sp(4)]);
        roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#B0A090';
        ctx.font = `${this.sp(13)}px "Microsoft YaHei", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('拖入图片', r.x + r.w / 2, r.y + r.h / 2);
      }
    }

    // 选中框 / 编辑框 + 四角手柄
    if (this.selected != null && this.group.cells[this.selected]?.image) {
      const r = this.innerRect(this.selected);
      const isEdit = this.editing === this.selected;
      ctx.strokeStyle = '#FF8C1A';
      ctx.lineWidth = this.sp(isEdit ? 3 : 2);
      roundRectPath(ctx, r.x, r.y, r.w, r.h, rr);
      ctx.stroke();

      if (isEdit) {
        ctx.fillStyle = '#FF8C1A';
        for (const h of this.handleRects(this.selected)) {
          ctx.beginPath();
          ctx.arc(h.x + h.w / 2, h.y + h.h / 2, h.w / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#FFFFFF';
          ctx.lineWidth = this.sp(2);
          ctx.stroke();
        }
      }
    }

    // 框线
    if (this.editing == null) {
      const { verts, horiz } = computeDividers(layout);
      ctx.strokeStyle = '#E0C8B0';
      ctx.lineWidth = this.sp(2);
      ctx.beginPath();
      for (const [pos, span] of verts) {
        ctx.moveTo(pos * aw, span[0] * ah);
        ctx.lineTo(pos * aw, span[1] * ah);
      }
      for (const [pos, span] of horiz) {
        ctx.moveTo(span[0] * aw, pos * ah);
        ctx.lineTo(span[1] * aw, pos * ah);
      }
      ctx.stroke();
    }

    // 自由模式：外框 + 八个手柄
    if (this.freeMode) {
      ctx.strokeStyle = '#FF8C1A';
      ctx.lineWidth = this.sp(2);
      ctx.strokeRect(0, 0, aw, ah);

      for (const [kind, p] of Object.entries(this.boardHandlePoints())) {
        const rad = Math.max(this.sp(10), 7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, rad, 0, Math.PI * 2);
        ctx.fillStyle = '#FF8C1A';
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = this.sp(2);
        ctx.stroke();

        const d = rad * 0.45;
        ctx.beginPath();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = this.sp(2);
        ctx.lineCap = 'round';
        ctx.moveTo(p.x - d, p.y);
        ctx.lineTo(p.x + d, p.y);
        if (kind === 'tl' || kind === 'tr' || kind === 'bl' || kind === 'br') {
          ctx.moveTo(p.x, p.y - d);
          ctx.lineTo(p.x, p.y + d);
        }
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
  }

  /* ---------------- 交互 ---------------- */
  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', (e) => this._onUp(e));
    c.addEventListener('contextmenu', (e) => this._onContextMenu(e));

    // 桌面：编辑状态下滚轮缩放该格
    c.addEventListener('wheel', (e) => {
      if (this.editing == null || !this.group) return;
      const cell = this.group.cells[this.editing];
      if (!cell?.image) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      cell.zoom = clamp(cell.zoom * factor, 1, MAX_ZOOM);
      this.schedule();
      emit('group-modified', this.group);
    }, { passive: false });
  }

  _onDown(e) {
    if (e.button === 2) return;   // 右键交给 contextmenu
    closeHold(this);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 2) {
      if (this._startPinch()) e.preventDefault();
      return;
    }
    if (this.pointers.size > 2) return;

    const p = this.toArt(e.clientX, e.clientY);
    this._pressPoint = p;

    // 1) 编辑状态下先判四角手柄
    if (this.editing != null) {
      const hi = this.hitHandle(this.editing, p.x, p.y);
      if (hi != null) {
        const cell = this.group.cells[this.editing];
        const r = this.innerRect(this.editing);
        const cx = r.x + r.w / 2;
        const cy = r.y + r.h / 2;
        this.mode = 'cell-zoom';
        this.drag = {
          index: this.editing,
          startZoom: cell.zoom,
          startDist: Math.hypot(p.x - cx, p.y - cy) || 1,
          cx, cy,
        };
        this.canvas.setPointerCapture?.(e.pointerId);
        return;
      }
    }

    // 2) 自由模式外框手柄
    const bh = this.hitBoardHandle(p.x, p.y);
    if (bh) {
      this.mode = 'art-resize';
      this.drag = { kind: bh, startW: this.artW, startH: this.artH, startX: p.x, startY: p.y };
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    // 3) 框线
    const d = this.hitDivider(p.x, p.y);
    if (d) {
      this.mode = 'divider';
      this.drag = { ...d, start: p };
      this.canvas.style.cursor = d.orientation === 'v' ? 'ew-resize' : 'ns-resize';
      this.canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    // 4) 格子
    const idx = this.hitCell(p.x, p.y);
    if (idx >= 0 && this.group) {
      if (this.editing != null && this.editing !== idx) this.setEditing(null);
      this.select(idx);
      const cell = this.group.cells[idx];

      if (cell?.image && this.editing === idx) {
        this.mode = 'cell-pan';
        this.drag = { index: idx, last: p };
        this.canvas.setPointerCapture?.(e.pointerId);
        return;
      }

      this.mode = 'cell-press';
      this.drag = { index: idx, start: p, startClient: { x: e.clientX, y: e.clientY } };

      // 长按 / 右键 → 菜单
      const client = { x: e.clientX, y: e.clientY };
      this._holdTimer = setTimeout(() => {
        if (this.mode === 'cell-press') {
          this.mode = null;
          this._openCellMenu(idx, client.x, client.y);
        }
      }, 500);
      return;
    }

    // 5) 空白
    this.select(null);
    this.setEditing(null);
    if (this.group && !this.freeMode && this.nearBoarder(p.x, p.y)) {
      toast('请选择「自由模式」后再拖动边框');
    }
    this.mode = null;
  }

  _onMove(e) {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (this.mode === 'pinch') {
      this._pinchUpdate();
      return;
    }

    if (this.mode === 'cell-zoom' && this.drag) {
      const p = this.toArt(e.clientX, e.clientY);
      const dist = Math.hypot(p.x - this.drag.cx, p.y - this.drag.cy) || 1;
      const cell = this.group.cells[this.drag.index];
      cell.zoom = clamp((this.drag.startZoom * this.drag.startDist) / dist, 1, MAX_ZOOM);
      this.schedule();
      return;
    }

    if (this.mode === 'cell-pan' && this.drag) {
      const p = this.toArt(e.clientX, e.clientY);
      this._panBy(this.drag.index, p.x - this.drag.last.x, p.y - this.drag.last.y);
      this.drag.last = p;
      return;
    }

    if (this.mode === 'divider' && this.drag) {
      const p = this.toArt(e.clientX, e.clientY);
      const d = this.drag.orientation === 'v'
        ? (p.x - this.drag.start.x) / this.artW
        : (p.y - this.drag.start.y) / this.artH;
      const [next, moved] = moveLayout(this.group.layout, this.drag.orientation, this.drag.pos, d);
      if (moved !== 0) {
        this.group.layout = next;
        this.drag.pos += moved;
        this.drag.start = p;
        this.schedule();
        emit('group-modified', this.group);
      }
      return;
    }

    if (this.mode === 'art-resize' && this.drag) {
      const p = this.toArt(e.clientX, e.clientY);
      const dx = p.x - this.drag.startX;
      const dy = p.y - this.drag.startY;
      const k = this.drag.kind;
      let w = this.drag.startW;
      let h = this.drag.startH;
      if (k === 'right' || k === 'tr' || k === 'br') w += dx;
      if (k === 'left' || k === 'tl' || k === 'bl') w -= dx;
      if (k === 'bottom' || k === 'bl' || k === 'br') h += dy;
      if (k === 'top' || k === 'tl' || k === 'tr') h -= dy;
      this.setArtSize(w, h);
      return;
    }

    if (this.mode === 'cell-press' && this.drag) {
      const dx = e.clientX - this.drag.startClient.x;
      const dy = e.clientY - this.drag.startClient.y;
      if (Math.hypot(dx, dy) > 8) {
        const cell = this.group?.cells[this.drag.index];
        const idx = this.drag.index;
        closeHold(this);
        this.mode = null;
        if (cell?.image) {
          const img = cell.image;
          const thumb = img.thumbUrl;
          startDrag(
            { imgs: [img], source: 'group', ghostUrl: thumb },
            e.clientX, e.clientY,
          );
          this.select(idx);
        }
      }
      return;
    }

    // 悬停光标
    if (!this.pointers.size) {
      const p = this.toArt(e.clientX, e.clientY);
      const d = this.hitDivider(p.x, p.y);
      this.canvas.style.cursor = d ? (d.orientation === 'v' ? 'ew-resize' : 'ns-resize') : 'default';
    }
  }

  _onUp(e) {
    closeHold(this);
    this.pointers.delete(e.pointerId);

    if (this.mode === 'pinch' && this.pointers.size < 2) {
      this.mode = null;
      this.pinch = null;
      emit('group-modified', this.group);
    }
    if (this.mode === 'divider' || this.mode === 'cell-zoom' || this.mode === 'cell-pan' || this.mode === 'art-resize') {
      if (this.mode !== 'art-resize') emit('group-modified', this.group);
    }
    if (this.canvas.hasPointerCapture?.(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }
    this.mode = null;
    this.drag = null;
    this.canvas.style.cursor = this.editing != null ? 'move' : 'default';
  }

  _startPinch() {
    if (!this.group) return false;
    const pts = [...this.pointers.values()];
    if (pts.length < 2) return false;
    const a = this.toArt(pts[0].x, pts[0].y);
    const b = this.toArt(pts[1].x, pts[1].y);
    const i1 = this.hitCell(a.x, a.y);
    const i2 = this.hitCell(b.x, b.y);
    if (i1 < 0 || i1 !== i2) return false;
    const cell = this.group.cells[i1];
    if (!cell?.image) return false;

    closeHold(this);
    this.setEditing(i1);
    this.mode = 'pinch';
    this.pinch = {
      index: i1,
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      zoom: cell.zoom,
    };
    return true;
  }

  _pinchUpdate() {
    const pts = [...this.pointers.values()];
    if (pts.length < 2 || !this.pinch) return;
    const a = this.toArt(pts[0].x, pts[0].y);
    const b = this.toArt(pts[1].x, pts[1].y);
    const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    const cell = this.group.cells[this.pinch.index];
    if (!cell?.image) return;
    cell.zoom = clamp((this.pinch.zoom * dist) / this.pinch.dist, 1, MAX_ZOOM);
    this.schedule();
  }

  /** 格内平移：与 Windows 版 _pan_by 同一套换算 */
  _panBy(index, dx, dy) {
    const cell = this.group.cells[index];
    if (!cell?.image) return;
    const img = cell.image.preview;
    if (!img) return;
    const r = this.innerRect(index);
    const cw = Math.max(1, r.w);
    const ch = Math.max(1, r.h);
    const ratio = cw / ch;
    let baseW, baseH;
    if (img.width / img.height > ratio) {
      baseW = img.height * ratio;
      baseH = img.height;
    } else {
      baseW = img.width;
      baseH = img.width / ratio;
    }
    const z = Math.max(1, cell.zoom);
    const sx = (z * cw) / baseW;
    const sy = (z * ch) / baseH;
    cell.cx = clamp(cell.cx - dx / (sx * img.width), 0, 1);
    cell.cy = clamp(cell.cy - dy / (sy * img.height), 0, 1);
    this.schedule();
  }

  /* ---------------- 菜单 ---------------- */
  _onContextMenu(e) {
    e.preventDefault();
    if (!this.group) return;
    const p = this.toArt(e.clientX, e.clientY);
    const idx = this.hitCell(p.x, p.y);
    this._openCellMenu(idx >= 0 ? idx : null, e.clientX, e.clientY);
  }

  _openCellMenu(index, clientX, clientY) {
    if (!this.group) return;
    if (index == null) {
      contextMenu([{ label: '这里没有图片', disabled: true }], clientX, clientY);
      return;
    }
    const cell = this.group.cells[index];
    const hasImage = !!cell?.image;
    const editing = this.editing === index;

    if (!hasImage) {
      contextMenu(
        [
          { label: '这一格是空的', disabled: true },
          { label: '从图片库拖一张进来', disabled: true },
        ],
        clientX, clientY,
      );
      return;
    }

    const items = [
      editing
        ? { label: '退出编辑', onClick: () => this.setEditing(null) }
        : { label: '编辑这张图', onClick: () => this.setEditing(index) },
      {
        label: cell.blurMode !== 'none' ? '模糊处理…（已开启）' : '模糊处理…',
        onClick: () => openBlurDialog(cell, () => this.schedule()),
      },
      {
        label: '复位（居中 / 原始大小）',
        onClick: () => {
          cell.cx = 0.5;
          cell.cy = 0.5;
          cell.zoom = 1;
          this.schedule();
          emit('group-modified', this.group);
          toast('已复位');
        },
      },
      { sep: true },
      {
        label: '从分组移除',
        danger: true,
        onClick: () => {
          cell.image = null;
          if (this.editing === index) this.setEditing(null);
          this.schedule();
          emit('group-modified', this.group);
          emit('groups-changed');
        },
      },
    ];
    contextMenu(items, clientX, clientY);
  }

  /* ---------------- 接收拖放 ---------------- */
  async _handleDrop(payload, clientX, clientY) {
    if (!this.group) {
      toast('先新建一个分组');
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    if (clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom) return;

    const p = this.toArt(clientX, clientY);
    let idx = this.hitCell(p.x, p.y);
    if (idx < 0) idx = 0;

    const ok = await dropImagesToCell(payload.imgs, idx, this.group, payload.source || 'library');
    if (ok) {
      this.select(idx);
      this.schedule();
      toast('已放入');
    }
  }
}

/* ---------------- 长按清理 ---------------- */
function closeHold(canvas) {
  if (canvas._holdTimer) {
    clearTimeout(canvas._holdTimer);
    canvas._holdTimer = null;
  }
}
