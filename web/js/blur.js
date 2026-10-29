// 模糊 / 马赛克 处理弹窗（作用在单个格子上，画布和导出都生效）
import { modal } from './ui.js';

const MODES = [
  { key: 'none', label: '不处理' },
  { key: 'blur', label: '高斯模糊' },
  { key: 'mosaic', label: '马赛克' },
];

/**
 * @param {import('./models.js').Cell} cell
 * @param {Function} redraw 参数变化时重绘画布
 */
export function openBlurDialog(cell, redraw) {
  const before = { mode: cell.blurMode, amount: cell.blurAmount };

  const wrap = document.createElement('div');

  const modeRow = document.createElement('div');
  modeRow.className = 'row';
  modeRow.innerHTML = '<label>方式</label>';
  const seg = document.createElement('div');
  seg.style.cssText = 'display:flex;gap:6px;flex:1 1 auto';

  const segButtons = MODES.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ghost';
    b.style.flex = '1 1 0';
    b.textContent = m.label;
    b.onclick = () => {
      cell.blurMode = m.key;
      paintSeg();
      redraw();
    };
    seg.appendChild(b);
    return { btn: b, key: m.key };
  });
  modeRow.appendChild(seg);

  const amountRow = document.createElement('div');
  amountRow.className = 'row';
  amountRow.innerHTML = '<label>强度</label>';

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '1';
  range.max = '100';
  range.value = String(cell.blurAmount || 30);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = range.value;

  range.oninput = () => {
    cell.blurAmount = Number(range.value);
    val.textContent = range.value;
    if (cell.blurMode === 'none') {
      cell.blurMode = 'blur';
      paintSeg();
    }
    redraw();
  };
  amountRow.append(range, val);

  const tip = document.createElement('p');
  tip.style.cssText = 'margin:0 0 12px;font-size:12px;line-height:1.7;color:var(--text-light)';
  tip.textContent = '提示：模糊只作用于当前这一格，导出成品时同样生效。想只遮住一小块，可以先把图放大到那一块再加大模糊。';

  wrap.append(modeRow, amountRow, tip);

  function paintSeg() {
    for (const s of segButtons) s.btn.classList.toggle('on', s.key === cell.blurMode);
    amountRow.style.opacity = cell.blurMode === 'none' ? '.45' : '1';
    range.disabled = cell.blurMode === 'none';
  }
  paintSeg();

  return modal({
    title: '模糊处理',
    body: wrap,
    actions: [
      {
        label: '取消',
        class: 'ghost',
        value: 'cancel',
        onClick: () => {
          cell.blurMode = before.mode;
          cell.blurAmount = before.amount;
          redraw();
        },
      },
      {
        label: '完成',
        class: 'primary',
        value: 'ok',
        onClick: () => {
          redraw();
        },
      },
    ],
  });
}
