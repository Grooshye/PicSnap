// 导出：合成成品图 → 保存 / 分享 / 复制
import { modal, toast } from './ui.js';
import { settings, SIZE_PRESETS } from './settings.js';
import { renderGroup, computeNativeSize } from './renderer.js';

const MAX_EXPORT_SIDE = 4000;

/** 先把这一组要用到的图都解码好，再合成 */
async function prepareImages(group, size) {
  const map = new Map();
  for (const cell of group.cells) {
    const item = cell.image;
    if (!item || map.has(item)) continue;
    let bmp;
    try {
      bmp = await item.ensureFull(size);
    } catch {
      bmp = await item.ensurePreview();
    }
    map.set(item, bmp);
  }
  return map;
}

function paint(group, width, height, map) {
  return renderGroup(group, width, height, (cell) => {
    const base = map.get(cell.image);
    if (!base) return null;
    return cell.blurMode !== 'none'
      ? cell.image.processed(base, cell.blurMode, cell.blurAmount)
      : base;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) canvas.toBlob((b) => resolve(b), type, quality);
    else {
      const data = canvas.toDataURL(type, quality);
      const bin = atob(data.split(',')[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      resolve(new Blob([arr], { type }));
    }
  });
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 打开导出弹窗
 * @param {import('./models.js').Group} group
 * @param {{w:number,h:number}} initial 画布当前尺寸
 */
export function openExportDialog(group, initial) {
  if (!group || !group.images().length) {
    toast('当前分组还没有图片，请先把图片拖入分组');
    return;
  }

  const body = document.createElement('div');

  /* 尺寸 */
  const sizeRow = document.createElement('div');
  sizeRow.className = 'row';
  sizeRow.innerHTML = '<label>尺寸</label>';

  const sizeSel = document.createElement('select');
  for (const p of SIZE_PRESETS) {
    const o = document.createElement('option');
    o.value = p.name;
    o.textContent = p.name;
    sizeSel.appendChild(o);
  }
  sizeRow.appendChild(sizeSel);

  /* 自定义宽高 */
  const customRow = document.createElement('div');
  customRow.className = 'row';
  customRow.innerHTML = '<label>自定义</label>';
  const wInp = document.createElement('input');
  wInp.type = 'number';
  wInp.min = '100';
  wInp.max = '8000';
  wInp.value = String(initial.w);
  const hInp = document.createElement('input');
  hInp.type = 'number';
  hInp.min = '100';
  hInp.max = '8000';
  hInp.value = String(initial.h);
  const xLabel = document.createElement('span');
  xLabel.textContent = '×';
  xLabel.style.color = 'var(--text-light)';
  customRow.append(wInp, xLabel, hInp);

  /* 原图质量 */
  const nativeRow = document.createElement('div');
  nativeRow.className = 'check';
  const nativeChk = document.createElement('input');
  nativeChk.type = 'checkbox';
  nativeChk.id = 'chk-native';
  const nativeLbl = document.createElement('label');
  nativeLbl.htmlFor = 'chk-native';
  nativeLbl.textContent = '原图质量（不压缩画质，文件更大）';
  nativeRow.append(nativeChk, nativeLbl);

  /* 格式 */
  const fmtRow = document.createElement('div');
  fmtRow.className = 'row';
  fmtRow.innerHTML = '<label>格式</label>';
  const fmtSel = document.createElement('select');
  fmtSel.innerHTML = '<option value="png">PNG（无损）</option><option value="jpg">JPG（体积小）</option>';
  fmtRow.appendChild(fmtSel);

  /* 画质 */
  const qRow = document.createElement('div');
  qRow.className = 'row';
  qRow.innerHTML = '<label>JPG 画质</label>';
  const qRange = document.createElement('input');
  qRange.type = 'range';
  qRange.min = '1';
  qRange.max = '100';
  qRange.value = '95';
  const qVal = document.createElement('span');
  qVal.className = 'val';
  qVal.textContent = '95';
  qRange.oninput = () => (qVal.textContent = qRange.value);
  qRow.append(qRange, qVal);

  const info = document.createElement('p');
  info.style.margin = '4px 0 0';

  body.append(sizeRow, customRow, nativeRow, fmtRow, qRow, info);

  /* 初始值对齐画布当前尺寸 */
  const matchPreset = SIZE_PRESETS.findIndex((p) => p.w === initial.w && p.h === initial.h);
  if (matchPreset >= 0) sizeSel.value = SIZE_PRESETS[matchPreset].name;
  else sizeSel.value = '自定义…';

  function syncRows() {
    const isCustom = sizeSel.value === '自定义…';
    customRow.hidden = !isCustom;
    qRow.hidden = fmtSel.value !== 'jpg';
    const [w, h] = currentSize();
    info.textContent = `输出尺寸：${w} × ${h} 像素`;
    wInp.disabled = !isCustom;
    hInp.disabled = !isCustom;
  }

  function currentSize() {
    if (sizeSel.value === '自定义…') {
      return [
        Math.max(100, Math.min(8000, Number(wInp.value) || 1080)),
        Math.max(100, Math.min(8000, Number(hInp.value) || 1080)),
      ];
    }
    const p = SIZE_PRESETS.find((x) => x.name === sizeSel.value) || SIZE_PRESETS[0];
    return [p.w, p.h];
  }

  sizeSel.onchange = syncRows;
  fmtSel.onchange = syncRows;
  wInp.oninput = syncRows;
  hInp.oninput = syncRows;
  syncRows();

  let busy = false;

  const doRender = async () => {
    if (busy) return null;
    busy = true;
    const fmt = fmtSel.value;
    const quality = Number(qRange.value) / 100;

    const [pw, ph] = currentSize();
    const aspect = pw / ph;
    const map = await prepareImages(group, MAX_EXPORT_SIDE);

    let w = pw;
    let h = ph;
    if (nativeChk.checked) {
      [w, h] = computeNativeSize(group, aspect, (cell) => map.get(cell.image), 6000);
      w = Math.min(w, 8000);
      h = Math.min(h, 8000);
    }

    const canvas = paint(group, w, h, map);
    const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    const blob = await canvasToBlob(canvas, type, quality);
    busy = false;
    return { blob, canvas, ext: fmt === 'jpg' ? 'jpg' : 'png', w, h };
  };

  const filename = (ext) => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `PicSnap_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
  };

  return modal({
    title: '导出成品图',
    body,
    actions: [
      { label: '取消', class: 'ghost', value: null },
      {
        label: '复制图片',
        class: 'ghost',
        value: null,
        onClick: async () => {
          const r = await withBusy(doRender, '正在合成…');
          if (!r) return false;
          try {
            if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': r.blob })]);
            toast('已复制，可直接粘贴到微信');
          } catch {
            download(r.blob, filename(r.ext));
            toast('当前浏览器不支持复制，已改为保存图片');
          }
          return true;
        },
      },
      {
        label: '分享',
        class: 'ghost',
        value: null,
        onClick: async () => {
          const r = await withBusy(doRender, '正在合成…');
          if (!r) return false;
          const file = new File([r.blob], filename(r.ext), { type: r.blob.type });
          if (navigator.canShare?.({ files: [file] })) {
            try {
              await navigator.share({ files: [file], title: 'PicSnap 拼图' });
            } catch (err) {
              if (err?.name !== 'AbortError') download(r.blob, filename(r.ext));
            }
          } else {
            download(r.blob, filename(r.ext));
            toast('已保存到「下载」文件夹');
          }
          return true;
        },
      },
      {
        label: '保存图片',
        class: 'primary',
        value: null,
        onClick: async () => {
          const r = await withBusy(doRender, '正在合成…');
          if (!r) return false;
          download(r.blob, filename(r.ext));
          toast(`已保存（${r.w}×${r.h}）`);
          return true;
        },
      },
    ],
  });
}

/** 执行耗时任务时给个提示 */
async function withBusy(fn, msg) {
  toast(msg, 6000);
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast('合成失败，请重试');
    return null;
  }
}
