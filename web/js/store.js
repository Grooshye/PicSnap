// 全局状态 + 数据操作（对应 Windows 版的主窗口 / 分组面板里的数据逻辑）
import { Group } from './models.js';
import { TEMPLATES, DEFAULT_KEY } from './templates.js';
import { settings } from './settings.js';

export const store = {
  library: [],       // ImageItem[]
  groups: [],        // Group[]
  active: null,      // 当前分组
};

const bus = new EventTarget();
export function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}
export function on(type, fn) {
  bus.addEventListener(type, (e) => fn(e.detail));
}

/* ---------------- 图库 ---------------- */
export function addToLibrary(items) {
  const fresh = items.filter((it) => !store.library.includes(it));
  if (!fresh.length) return 0;
  store.library.push(...fresh);
  emit('library-changed');
  return fresh.length;
}

export function removeFromLibrary(items) {
  const set = new Set(items);
  const before = store.library.length;
  store.library = store.library.filter((it) => !set.has(it));
  if (store.library.length === before) return;
  // 图库删除要同步从所有分组移除
  removeImagesFromAllGroups(items);
  emit('library-changed');
}

export function groupLabelsFor(img) {
  return store.groups.filter((g) => g.hasImage(img)).map((g) => g.name);
}

export function isGrouped(img) {
  return store.groups.some((g) => g.hasImage(img));
}

/* ---------------- 分组 ---------------- */
export function createGroup(name) {
  const g = new Group(name || `分组 ${store.groups.length + 1}`, DEFAULT_KEY, TEMPLATES[DEFAULT_KEY]);
  store.groups.push(g);
  setActive(g);
  emit('groups-changed');
  return g;
}

export function removeGroup(group) {
  const i = store.groups.indexOf(group);
  if (i < 0) return;
  store.groups.splice(i, 1);
  if (store.active === group) {
    store.active = store.groups[0] || null;
    emit('active-changed', store.active);
  }
  emit('groups-changed');
}

export function setActive(group) {
  if (store.active === group) return;
  store.active = group;
  emit('active-changed', group);
}

export function refreshGroup(group) {
  emit('group-modified', group);
}

/* ---------------- 图片在分组间移动 ---------------- */
export function removeFromOtherGroups(img, target) {
  for (const g of store.groups) {
    if (g !== target && g.hasImage(img)) {
      g.removeImage(img);
      refreshGroup(g);
    }
  }
}

export function moveImagesTo(imgs, target) {
  let changed = false;
  for (const img of imgs) {
    if (target.hasImage(img)) continue;
    // 记住原来格子的裁切参数，移动后保持观感
    let crop = null;
    for (const g of store.groups) {
      if (g !== target && g.hasImage(img)) {
        const idx = g.cellOf(img);
        if (idx >= 0) {
          const c = g.cells[idx];
          crop = { cx: c.cx, cy: c.cy, zoom: c.zoom, blurMode: c.blurMode, blurAmount: c.blurAmount };
        }
        g.removeImage(img);
        refreshGroup(g);
      }
    }
    const idx = target.placeImage(img);
    if (idx >= 0) {
      if (crop) {
        const c = target.cells[idx];
        c.cx = crop.cx;
        c.cy = crop.cy;
        c.zoom = crop.zoom;
        c.blurMode = crop.blurMode;
        c.blurAmount = crop.blurAmount;
      }
      changed = true;
    }
  }
  if (changed) {
    refreshGroup(target);
    emit('groups-changed');
  }
  return changed;
}

export function removeImagesFromAllGroups(imgs) {
  const set = new Set(imgs);
  let changed = false;
  for (const g of store.groups) {
    let hit = false;
    for (const c of g.cells) {
      if (c.image && set.has(c.image)) {
        c.image = null;
        hit = true;
      }
    }
    if (hit) {
      refreshGroup(g);
      changed = true;
    }
  }
  if (changed) emit('groups-changed');
  return changed;
}

/* ---------------- 放置逻辑（从图库/别的分组拖进来） ---------------- */

/**
 * 取消重复策略：当 allowDuplicate 关闭时，问用户「移动 / 复制 / 取消」
 * resolveAction 由界面层注入，返回 Promise<'move'|'copy'|'cancel'>
 */
export let resolveDuplicate = async () => 'copy';
export function setDuplicateResolver(fn) {
  resolveDuplicate = fn;
}

/** 把图片放进目标分组（自动处理「已在别的分组」的情况） */
export async function placeIntoGroup(imgs, target, source = 'library') {
  let changed = false;
  for (const img of imgs) {
    if (target.hasImage(img)) continue;

    if (source === 'library') {
      const others = store.groups.filter((g) => g !== target && g.hasImage(img));
      if (others.length && !settings.allowDuplicate) {
        const action = await resolveDuplicate(img, others[0]);
        if (action === 'cancel') continue;
        if (action === 'move') removeFromOtherGroups(img, target);
      }
    } else {
      removeFromOtherGroups(img, target);
    }

    if (target.placeImage(img) >= 0) changed = true;
  }
  if (changed) {
    refreshGroup(target);
    emit('groups-changed');
  }
  return changed;
}

/**
 * 拖到画布某个格子上（对应 canvas.drop_images_to）
 * @param {ImageItem[]} imgs
 * @param {number} targetIndex
 * @param {Group} group
 * @param {'library'|'group'} source
 */
export async function dropImagesToCell(imgs, targetIndex, group, source = 'group') {
  group.ensureCells();
  const n = group.cells.length;
  if (targetIndex < 0 || targetIndex >= n) return false;

  // 单张、且这张图已经在本组：交换两个格子
  if (imgs.length === 1 && group.hasImage(imgs[0])) {
    const src = group.cellOf(imgs[0]);
    if (src !== targetIndex && src >= 0) {
      [group.cells[src], group.cells[targetIndex]] = [group.cells[targetIndex], group.cells[src]];
      refreshGroup(group);
      emit('groups-changed');
      return true;
    }
    return false;
  }

  let changed = false;
  for (const img of imgs) {
    if (group.hasImage(img)) continue;

    const others = store.groups.filter((g) => g !== group && g.hasImage(img));
    if (others.length) {
      if (source === 'library' && !settings.allowDuplicate) {
        const action = await resolveDuplicate(img, others[0]);
        if (action === 'cancel') continue;
        if (action === 'move') removeFromOtherGroups(img, group);
      } else if (source !== 'library') {
        // 从别的分组拖过来 = 移动
        removeFromOtherGroups(img, group);
      }
    }

    // 从目标格开始向后找空格
    let placed = false;
    for (let k = 0; k < n; k++) {
      const j = (targetIndex + k) % n;
      if (!group.cells[j].image) {
        const c = group.cells[j];
        c.image = img;
        c.cx = c.cy = 0.5;
        c.zoom = 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      const c = group.cells[targetIndex];
      c.image = img;
      c.cx = c.cy = 0.5;
      c.zoom = 1;
    }
    changed = true;
  }
  if (changed) {
    refreshGroup(group);
    emit('groups-changed');
  }
  return changed;
}
