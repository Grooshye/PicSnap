// 渲染引擎：裁切算法 + 成品图合成。与 Windows 版 app/core/renderer.py 同一套数学。
import { settings } from './settings.js';

export const GAP_UNITS = 12;   // 有框线时的缝隙（基于 1080 场景单位）
export const ART_UNITS = 1080;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 按格内缩放/平移参数计算源图裁切框（像素）。
 * ratio = 目标格宽高比；cx/cy = 可见区域中心（归一化）；zoom = 缩放倍数（>=1）
 */
export function cropBox(sw, sh, ratio, cx, cy, zoom) {
  let baseW, baseH;
  if (sw / sh > ratio) {
    baseW = sh * ratio;
    baseH = sh;
  } else {
    baseW = sw;
    baseH = sw / ratio;
  }
  const z = Math.max(1, zoom || 1);
  const w = Math.min(baseW / z, sw);
  const h = Math.min(baseH / z, sh);
  const left = clamp(cx * sw - w / 2, 0, sw - w);
  const top = clamp(cy * sh - h / 2, 0, sh - h);
  return { left, top, w, h };
}

/** 当前缝隙大小（成品图上的像素） */
export function gapFor(width, height) {
  if (!settings.gapEnabled) return 0;
  return Math.max(0, Math.round((Math.min(width, height) * GAP_UNITS) / ART_UNITS));
}

/** 把一个格子的图按参数画进目标矩形 */
export function drawCellImage(ctx, img, cell, dx, dy, dw, dh) {
  if (!img || dw <= 0 || dh <= 0) return;
  const box = cropBox(img.width, img.height, dw / dh, cell.cx, cell.cy, cell.zoom);
  ctx.drawImage(img, box.left, box.top, box.w, box.h, dx, dy, dw, dh);
}

/**
 * 合成一个分组的成品图。
 * getImage(cell) 返回可绘制的图像（ImageBitmap / Canvas / Image）。
 */
export function renderGroup(group, width, height, getImage, background = '#FFFFFF') {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';

  group.ensureCells();
  const gap = gapFor(width, height);

  group.layout.forEach(([x, y, w, h], i) => {
    const cell = group.cells[i];
    if (!cell || !cell.image) return;
    const img = getImage(cell);
    if (!img) return;

    const left = Math.round(x * width) + Math.floor(gap / 2);
    const top = Math.round(y * height) + Math.floor(gap / 2);
    const right = Math.round((x + w) * width) - Math.floor(gap / 2);
    const bottom = Math.round((y + h) * height) - Math.floor(gap / 2);
    const cw = right - left;
    const ch = bottom - top;
    if (cw <= 0 || ch <= 0) return;

    drawCellImage(ctx, img, cell, left, top, cw, ch);
  });

  return canvas;
}

/**
 * 「原图质量」输出尺寸：尽量不让图片被放大（不超过 maxSide）
 */
export function computeNativeSize(group, aspect = 1, getImage, maxSide = 6000) {
  group.ensureCells();
  let scale = 1;
  group.layout.forEach(([x, y, w, h], i) => {
    const cell = group.cells[i];
    if (!cell || !cell.image) return;
    const img = getImage ? getImage(cell) : cell.image.preview;
    if (!img) return;
    const ratio = (w * aspect) / h;
    const box = cropBox(img.width, img.height, ratio, cell.cx, cell.cy, cell.zoom);
    const need = Math.max(box.w / (w * aspect), box.h / h);
    scale = Math.max(scale, need);
  });
  const base = Math.min(maxSide, Math.round(scale));
  return [Math.max(1, Math.round(base * aspect)), Math.max(1, base)];
}
