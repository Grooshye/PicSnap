// 入口：装配工具条、标签页、导入与画布联动
import { settings, SIZE_PRESETS, FREE_MODE_INDEX } from './settings.js';
import { TEMPLATES, templatesForCount } from './templates.js';
import { store, on, emit, createGroup, setActive, refreshGroup } from './store.js';
import { CollageCanvas } from './canvas.js';
import { LibraryPanel } from './library.js';
import { GroupsPanel } from './groups.js';
import { importFiles, filesFromDataTransfer } from './importer.js';
import { addToLibrary } from './store.js';
import { modal, toast } from './ui.js';
import { openExportDialog } from './exporter.js';

const $ = (s) => document.querySelector(s);

/* ---------------- 画布 ---------------- */
const canvas = new CollageCanvas($('#collage'), $('#canvas-wrap'));

/* ---------------- 面板 ---------------- */
const library = new LibraryPanel({
  thumbs: $('#lib-thumbs'),
  empty: $('#lib-empty'),
  filter: $('#lib-filter'),
  editBtn: $('#lib-edit'),
  count: $('#lib-count'),
});

const groups = new GroupsPanel({
  strip: $('#group-strip'),
  addBtn: $('#grp-add'),
  editBtn: $('#grp-edit'),
});

/* ---------------- 工具条 ---------------- */
const selCount = $('#sel-count');
const selTemplate = $('#sel-template');
const selSize = $('#sel-size');
const customSize = $('#custom-size');
const inpW = $('#inp-w');
const inpH = $('#inp-h');
const btnGap = $('#btn-gap');
const btnDup = $('#btn-dup');

for (let n = 1; n <= 9; n++) selCount.add(new Option(String(n), String(n)));
selCount.add(new Option('随意', '随意'));

for (const p of SIZE_PRESETS) selSize.add(new Option(p.name, p.name));
selSize.add(new Option('自由模式', '自由模式'));

function fillTemplates(apply) {
  const mode = selCount.value;
  const keys = mode === '随意' ? Object.keys(TEMPLATES) : templatesForCount(Number(mode));
  selTemplate.innerHTML = '';
  for (const k of keys) selTemplate.add(new Option(k, k));

  const g = store.active;
  if (!apply && g && keys.includes(g.templateName)) {
    selTemplate.value = g.templateName;
  } else if (keys.length) {
    selTemplate.selectedIndex = 0;
    if (apply) applyTemplate(keys[0]);
  }
}

function applyTemplate(name) {
  const g = store.active;
  if (!g || !TEMPLATES[name]) return;
  g.templateName = name;
  g.layout = TEMPLATES[name].map((r) => [...r]);
  g.ensureCells();
  refreshGroup(g);
  canvas.schedule();
  canvas.select(null);
  canvas.setEditing(null);
}

selCount.onchange = () => fillTemplates(true);
selTemplate.onchange = () => applyTemplate(selTemplate.value);

/* 尺寸 */
function syncSizeRows() {
  const free = selSize.value === '自由模式';
  const custom = selSize.value === '自定义…';
  customSize.hidden = !custom;
  if (free) {
    settings.freeMode = true;
    canvas.schedule();
    toast('自由模式：拖动画布四角「+」四边「—」改尺寸');
    return;
  }
  settings.freeMode = false;
  if (custom) {
    canvas.setArtSize(Number(inpW.value) || 1080, Number(inpH.value) || 1440);
  } else {
    const p = SIZE_PRESETS.find((x) => x.name === selSize.value);
    if (p) canvas.setArtSize(p.w, p.h);
  }
}
selSize.onchange = syncSizeRows;
inpW.oninput = () => {
  if (selSize.value === '自定义…') canvas.setArtSize(Number(inpW.value) || 1080, Number(inpH.value) || 1440);
};
inpH.oninput = () => {
  if (selSize.value === '自定义…') canvas.setArtSize(Number(inpW.value) || 1080, Number(inpH.value) || 1440);
};

/* 去缝隙 / 允许重复 */
btnGap.onclick = () => {
  settings.gapEnabled = !settings.gapEnabled;
  btnGap.classList.toggle('on', !settings.gapEnabled);
  canvas.schedule();
};
btnDup.onclick = () => {
  settings.allowDuplicate = !settings.allowDuplicate;
  btnDup.classList.toggle('on', settings.allowDuplicate);
  toast(settings.allowDuplicate ? '已允许重复：同一张图可放到多个分组' : '已关闭重复：拖已分组的图会询问');
};

/* 画布尺寸被拖动改变时，同步输入框 */
on('art-size-changed', ({ w, h }) => {
  inpW.value = Math.round(w);
  inpH.value = Math.round(h);
});

/* ---------------- 导入 ---------------- */
const fileInput = $('#file-input');

$('#btn-import').onclick = () => fileInput.click();
fileInput.onchange = async () => {
  if (!fileInput.files?.length) return;
  await doImport(fileInput.files);
  fileInput.value = '';
};

async function doImport(files) {
  toast('正在读取图片…', 10000);
  const items = await importFiles(files, (done, total) => {
    if (total > 2) toast(`正在读取 ${done}/${total}…`, 3000);
  });
  const n = addToLibrary(items);
  if (!n) {
    toast('没有可用的图片');
    return;
  }
  toast(`已导入 ${n} 张`);
}

/* 拖文件进来（桌面端） */
['dragenter', 'dragover'].forEach((t) =>
  document.addEventListener(t, (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }),
);
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  await doImport(filesFromDataTransfer(e.dataTransfer));
});

/* ---------------- 导出 ---------------- */
$('#btn-export').onclick = () => {
  const g = store.active;
  if (!g) {
    toast('先新建一个分组');
    return;
  }
  openExportDialog(g, { w: Math.round(canvas.artW), h: Math.round(canvas.artH) });
};

/* ---------------- 帮助 ---------------- */
$('#btn-help').onclick = () => {
  modal({
    title: '怎么用',
    body: `
      <ul class="help">
        <li><b>导入</b>：点「导入图片」选照片，或直接拖进来。</li>
        <li><b>放图</b>：把缩略图拖到下方分组，或拖到画布的格子里。</li>
        <li><b>复制粘贴</b>：桌面上 <b>Ctrl+V</b> 可直接粘贴截图。</li>
        <li><b>换位</b>：在画布里拖动某个格子里的图到另一格，两张就互换。</li>
        <li><b>改格子大小</b>：拖格子之间的<b>分割线</b>。</li>
        <li><b>调整单张</b>：<b>长按</b>（电脑上右键）图 → 「编辑这张图」，单指拖=平移，双指捏=缩放，滚轮也能缩放。</li>
        <li><b>模糊/打码</b>：长按图片 → 「模糊处理…」，可选高斯模糊或马赛克。</li>
        <li><b>无框线</b>：点顶部「无框线」，图片无缝拼贴。</li>
        <li><b>自由尺寸</b>：尺寸选「自由模式」，拖画布四角的 ＋ 和四边的 — 。</li>
        <li><b>导出</b>：点「导出 / 复制」，可保存、分享到微信、或复制。</li>
      </ul>`,
    actions: [{ label: '知道了', class: 'primary', value: null }],
  });
};

/* ---------------- 分组与画布联动 ---------------- */
on('active-changed', (g) => {
  canvas.setGroup(g);
  $('#canvas-empty').hidden = !!g;
  syncCombos(g);
});

on('groups-changed', () => {
  if (!store.active) {
    canvas.setGroup(null);
    $('#canvas-empty').hidden = false;
  } else {
    canvas.schedule();
  }
});

on('group-modified', () => canvas.schedule());

on('editing-changed', (idx) => {
  if (idx != null) toast('编辑中：拖动=平移，双指=缩放；长按可退出', 2200);
});

function syncCombos(g) {
  if (!g) return;
  const n = g.layout.length;
  selCount.value = n >= 1 && n <= 9 ? String(n) : '随意';
  fillTemplates(false);
  if (g.templateName && TEMPLATES[g.templateName]) {
    selTemplate.value = g.templateName;
  }
}

/* ---------------- 手机标签页 ---------------- */
const tabbar = $('#tabbar');
const panels = {
  library: $('#panel-library'),
  groups: $('#panel-groups'),
  canvas: $('#panel-canvas'),
};

function showTab(name) {
  for (const [k, el] of Object.entries(panels)) el.classList.toggle('shown', k === name);
  for (const b of tabbar.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.tab === name);
  }
  if (name === 'canvas') {
    requestAnimationFrame(() => canvas.relayout());
  }
}

tabbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (btn) showTab(btn.dataset.tab);
});

const isNarrow = () => window.matchMedia('(max-width: 960px)').matches;
function applyResponsive() {
  if (isNarrow()) {
    const current = [...tabbar.querySelectorAll('button')].find((b) => b.classList.contains('active'))?.dataset.tab || 'canvas';
    showTab(current);
  } else {
    for (const el of Object.values(panels)) el.classList.add('shown');
  }
  requestAnimationFrame(() => canvas.relayout());
}
window.addEventListener('resize', applyResponsive);

/* ---------------- 启动 ---------------- */
function boot() {
  applyResponsive();
  // 一开始就建好第一个分组，和 Windows 版一致
  if (!store.groups.length) createGroup('分组 1');
  setActive(store.groups[0]);
  syncCombos(store.groups[0]);
  btnGap.classList.toggle('on', !settings.gapEnabled);
  btnDup.classList.toggle('on', settings.allowDuplicate);
  showTab('canvas');

  // 注册 Service Worker（离线可用 / 添加到桌面）
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 支持 ?tab=library / groups / canvas 直接打开某个标签
  const tabParam = new URLSearchParams(location.search).get('tab');
  if (tabParam && panels[tabParam]) showTab(tabParam);

  // ?demo=1 载入示例图片，方便预览效果 / 自动测试
  if (new URLSearchParams(location.search).has('demo')) loadDemo();
}

/** 生成 6 张示例图并放进当前分组 */
async function loadDemo() {
  const colors = ['#FF6B6B', '#4ECDC4', '#FFD93D', '#6C5CE7', '#FF8C1A', '#2ED573'];
  const files = [];
  for (let i = 0; i < colors.length; i++) {
    const cv = document.createElement('canvas');
    cv.width = 900;
    cv.height = 1200;
    const c = cv.getContext('2d');
    const grad = c.createLinearGradient(0, 0, 900, 1200);
    grad.addColorStop(0, colors[i]);
    grad.addColorStop(1, '#FFFFFF');
    c.fillStyle = grad;
    c.fillRect(0, 0, 900, 1200);
    c.fillStyle = 'rgba(255,255,255,.9)';
    c.font = 'bold 200px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(i + 1), 450, 600);
    const blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9));
    files.push(new File([blob], `示例${i + 1}.jpg`, { type: 'image/jpeg' }));
  }

  const items = await importFiles(files);
  addToLibrary(items);
  const g = store.active;
  if (g) {
    selCount.value = '3';
    fillTemplates(true);
    items.forEach((it, i) => {
      if (i < g.cells.length) g.cells[i].image = it;
    });
    refreshGroup(g);
    emit('groups-changed');
    canvas.setGroup(g);
    canvas.schedule();
  }
}

// 调试用接口（不影响正常使用）
window.__picsnap = { store, canvas, library, groups, settings, importFiles, addToLibrary, refreshGroup };

boot();
