// 分组面板：多组并行、拖入拖出、增删改名、编辑模式删除
import {
  store, on, emit, createGroup, removeGroup, setActive, refreshGroup,
  placeIntoGroup, setDuplicateResolver, removeFromLibrary,
} from './store.js';
import { attachDraggable, registerDropTarget } from './dnd.js';
import { modal, contextMenu, toast } from './ui.js';
import { templatesForCount } from './templates.js';

export class GroupsPanel {
  constructor(els) {
    this.stripEl = els.strip;
    this.addBtn = els.addBtn;
    this.editBtn = els.editBtn;
    this.editMode = false;

    this.addBtn.onclick = () => {
      const g = createGroup();
      toast(`已新建「${g.name}」`);
    };
    this.editBtn.onclick = () => this.setEditMode(!this.editMode);

    on('groups-changed', () => this.render());
    on('library-changed', () => this.render());

    setDuplicateResolver((img, otherGroup) => this.askDuplicate(img, otherGroup));
  }

  setEditMode(v) {
    this.editMode = v;
    this.editBtn.classList.toggle('on', v);
    this.render();
  }

  /* 图片已在别的分组：问 移动 / 复制 / 取消 */
  askDuplicate(img, otherGroup) {
    return modal({
      title: '图片已在分组',
      body: `<p>这张图片已经在「${escapeHtml(otherGroup.name)}」里了。<br>要把它放进这个分组，你希望怎么处理？</p>`,
      actions: [
        { label: '取消', class: 'ghost', value: 'cancel' },
        { label: '复制一份', class: 'ghost', value: 'copy' },
        { label: '移动到这里', class: 'primary', value: 'move' },
      ],
    }).then((v) => v || 'cancel');
  }

  render() {
    const strip = this.stripEl;
    strip.innerHTML = '';

    if (!store.groups.length) {
      const tip = document.createElement('div');
      tip.className = 'group-empty';
      tip.style.cssText = 'width:100%;display:grid;place-items:center;color:var(--text-light)';
      tip.textContent = '还没有分组，点上方「＋ 新建分组」开始';
      strip.appendChild(tip);
      return;
    }

    for (const g of store.groups) {
      strip.appendChild(this.makeBox(g));
    }
  }

  makeBox(group) {
    const box = document.createElement('div');
    box.className = 'group-box' + (store.active === group ? ' active' : '');
    box.dataset.groupId = String(store.groups.indexOf(group));

    /* 标题行 */
    const head = document.createElement('div');
    head.className = 'group-head';

    const name = document.createElement('input');
    name.className = 'group-name';
    name.value = group.name;
    name.maxLength = 20;
    name.oninput = () => {
      group.name = name.value || '分组';
      emit('groups-changed-silent');
    };
    name.onblur = () => {
      if (!name.value.trim()) {
        group.name = '分组';
        name.value = group.name;
      }
      emit('groups-changed');
    };

    const del = document.createElement('button');
    del.className = 'group-del';
    del.textContent = '×';
    del.title = '删除该分组';
    del.onclick = (e) => {
      e.stopPropagation();
      this.confirmRemove(group);
    };

    head.append(name, del);
    box.appendChild(head);

    /* 缩略图 */
    const list = document.createElement('div');
    list.className = 'group-thumbs';
    const imgs = group.images();

    if (!imgs.length) {
      const empty = document.createElement('div');
      empty.className = 'group-empty';
      empty.textContent = '把图片拖进来';
      list.appendChild(empty);
    }

    for (const img of imgs) {
      const t = document.createElement('div');
      t.className = 'thumb';
      t.dataset.id = img.id;

      const im = document.createElement('img');
      im.src = img.thumbUrl;
      im.alt = img.name;
      im.draggable = false;
      t.appendChild(im);

      if (this.editMode) {
        const badge = document.createElement('span');
        badge.className = 'del';
        t.appendChild(badge);
      }

      attachDraggable(
        t,
        () => (this.editMode ? null : { imgs: [img], source: 'group', ghostUrl: img.thumbUrl }),
        {
          onTap: () => {
            if (this.editMode) {
              group.removeImage(img);
              refreshGroup(group);
              emit('groups-changed');
            } else {
              setActive(group);
            }
          },
        },
      );

      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        contextMenu(
          [
            { label: '设为当前分组', onClick: () => setActive(group) },
            { sep: true },
            {
              label: '从分组移除',
              danger: true,
              onClick: () => {
                group.removeImage(img);
                refreshGroup(group);
                emit('groups-changed');
              },
            },
          ],
          e.clientX,
          e.clientY,
        );
      });

      list.appendChild(t);
    }
    box.appendChild(list);

    /* 点击任意位置 = 设为当前分组 */
    box.addEventListener('pointerdown', () => setActive(group));

    /* 接收拖放 */
    registerDropTarget(box, {
      drop: async (payload) => {
        const ok = await placeIntoGroup(payload.imgs, group, payload.source);
        if (ok) toast(`已放入「${group.name}」`);
      },
    });

    return box;
  }

  async confirmRemove(group) {
    const n = group.images().length;
    if (!n) {
      removeGroup(group);
      return;
    }
    const r = await modal({
      title: '删除分组',
      body: `<p>确定要删除分组「${escapeHtml(group.name)}」吗？<br>该分组内有 ${n} 张图片，可选择把它们放回图片库，或一起删除。</p>`,
      actions: [
        { label: '取消', class: 'ghost', value: 'cancel' },
        { label: '删除图片和分组', class: 'danger', value: 'delete' },
        { label: '图片放回图库', class: 'primary', value: 'return' },
      ],
    });

    if (r === 'return') {
      // 图片本来就在图库里，只需从分组移除
      for (const img of group.images()) group.removeImage(img);
      removeGroup(group);
      toast('图片已保留在图库');
    } else if (r === 'delete') {
      removeFromLibrary(group.images());
      removeGroup(group);
      toast('已删除');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { templatesForCount };
