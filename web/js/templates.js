// 内置宫格模板：归一化矩形 [x, y, w, h]，0~1 坐标（相邻格共享边，缝隙由画布绘制）
// 与 Windows 版 app/core/templates.py 完全一致

const row = (n) => Array.from({ length: n }, (_, i) => [i / n, 0, 1 / n, 1]);
const col = (n) => Array.from({ length: n }, (_, i) => [0, i / n, 1, 1 / n]);
const grid = (r, c) =>
  Array.from({ length: r * c }, (_, k) => [(k % c) / c, Math.floor(k / c) / r, 1 / c, 1 / r]);

export const TEMPLATES = {
  '单图 1': [[0, 0, 1, 1]],
  '横排 2': row(2),
  '竖排 2': col(2),
  '横排 3': row(3),
  '竖排 3': col(3),
  '1大2小 3': [[0, 0, 0.5, 1], [0.5, 0, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
  '田字 4': grid(2, 2),
  '横排 4': row(4),
  '1大3小 4': [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1 / 3], [0.5, 1 / 3, 0.5, 1 / 3], [0.5, 2 / 3, 0.5, 1 / 3]],
  '横排 5': row(5),
  '2×3 6': grid(2, 3),
  '3×2 6': grid(3, 2),
  '横排 6': row(6),
  '横排 7': row(7),
  '2×4 8': grid(2, 4),
  '横排 8': row(8),
  '3×3 9': grid(3, 3),
  '横排 9': row(9),
};

export const DEFAULT_KEY = '3×3 9';

export function templatesForCount(n) {
  return Object.keys(TEMPLATES).filter((k) => TEMPLATES[k].length === n);
}
