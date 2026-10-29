// 图库面板：缩略图、分组角标、筛选、编辑删除、拖出到分组/画布
import { store, on, groupLabelsFor, removeFromLibrary } from './store.js';
import { attachDraggable } from './dnd.js';
import { contextMenu, toast } from './ui.js';

export class LibraryPanel {
  constructor(els) {
    this.thumbsEl = els.thumbs;
    this.emptyEl = els.empty;
    this.filterEl = els.filter;
    this.editEl = els.editBtn;
    this.countEl = els.count;

    this.filter = '全部';
    this.editMode = false;

    this.filterEl.onchange = () => {
      this.filter = this.filterEl.value;
      this.render();
    };
    this.editEl.onclick = () => this.setEditMode(!this.editMode);

    on('library-changed', () => this.render());
    // 只在「分组归属」变化时重建（拖框线时不会触发，避免卡顿）
    on('groups-changed', () => this.render());
  }

  setEditMode(on_) {
    this.editMode = on_;
    this.editEl.classList.toggle('on', on_);
    document.body.classList.toggle('lib-editing', on_);
    this.render();
  }

  visibleImages() {
    return store.library.filter((img) => {
      const labels = groupLabelsFor(img);
      if (this.filter === '已分组') return labels.length > 0;
      if (this.filter === '未分组') return labels.length === 0;
      return true;
    });
  }

  render() {
    const imgs = this.visibleImages();
    this.countEl.textContent = `${store.library.length} 张`;
    this.emptyEl.hidden = store.library.length > 0;
    this.thumbsEl.innerHTML = '';

    for (const img of imgs) {
      this.thumbsEl.appendChild(this.makeThumb(img));
    }
  }

  makeThumb(img) {
    const el = document.createElement('div');
    el.className = 'thumb';
    el.dataset.id = img.id;

    const im = document.createElement('img');
    im.src = img.thumbUrl;
    im.alt = img.name;
    im.draggable = false;
    el.appendChild(im);

    const labels = groupLabelsFor(img);
    if (labels.length) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = labels.join('、');
      badge.title = labels.join('、');
      el.appendChild(badge);
    }

    if (this.editMode) {
      const del = document.createElement('span');
      del.className = 'del';
      el.appendChild(del);
    }

    attachDraggable(
      el,
      () => (this.editMode ? null : { imgs: [img], source: 'library', ghostUrl: img.thumbUrl }),
      {
        onTap: () => {
          if (this.editMode) this.deleteImages([img]);
        },
      },
    );

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextMenu(
        [
          {
            label: '放入当前分组',
            disabled: !store.active,
            onClick: async () => {
              const { placeIntoGroup } = await import('./store.js');
              await placeIntoGroup([img], store.active, 'library');
              toast('已放入分组');
            },
          },
          { sep: true },
          {
            label: '从图库删除',
            danger: true,
            onClick: () => this.deleteImages([img]),
          },
        ],
        e.clientX,
        e.clientY,
      );
    });

    return el;
  }

  deleteImages(imgs) {
    if (!imgs.length) return;
    removeFromLibrary(imgs);
    toast(`已删除 ${imgs.length} 张`);
  }

  deleteSelected() {
    const ids = [...this.thumbsEl.querySelectorAll('.thumb.sel')].map((el) => Number(el.dataset.id));
    const imgs = store.library.filter((i) => ids.includes(i.id));
    this.deleteImages(imgs);
  }
}
