"""分组面板：多组并行，可拖入图片、跨组拖动、增删组、编辑模式删除"""
from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QAction, QDrag
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QListWidget,
    QMenu,
    QMessageBox,
    QPushButton,
    QSplitter,
    QVBoxLayout,
    QWidget,
)

from app.core import dnd
from app.core import importer
from app.core.templates import DEFAULT_KEY, TEMPLATES
from app.models import Group, ImageData
from app.ui.deletable_list import DeletableIconList


class GroupImageList(DeletableIconList):
    """一个分组内的图片缩略图列表，支持拖入/拖出与编辑模式删除"""

    def __init__(self, group: Group, controller: "GroupsPanel", parent=None) -> None:
        super().__init__(parent)
        self.group = group
        self.controller = controller
        self.setViewMode(QListWidget.IconMode)
        self.setIconSize(QSize(120, 120))
        self.setGridSize(QSize(136, 136))
        self.setResizeMode(QListWidget.Adjust)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setSpacing(4)
        self.setAcceptDrops(True)
        self.setDragDropMode(QAbstractItemView.DropOnly)
        self.viewport().setAcceptDrops(True)
        self.setDropIndicatorShown(True)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._on_context_menu)
        self._drag_start_pos = None

    def refresh(self) -> None:
        self.clear()
        for img in self.group.images():
            self.add_image_item(img)

    # ---- 拖出（跨组移动） ----
    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self._drag_start_pos = event.position().toPoint()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event) -> None:
        if self._edit_mode:
            super().mouseMoveEvent(event)
            return
        if event.buttons() & Qt.LeftButton and self._drag_start_pos is not None:
            delta = event.position().toPoint() - self._drag_start_pos
            if delta.manhattanLength() >= QApplication.startDragDistance():
                item = self.itemAt(self._drag_start_pos)
                if item is not None:
                    imgs = self._drag_images(item)
                    if imgs:
                        drag = QDrag(self)
                        if len(imgs) == 1:
                            drag.setMimeData(dnd.image_mime(imgs[0]))
                        else:
                            drag.setMimeData(dnd.images_mime(imgs))
                        if imgs[0].thumb is not None:
                            drag.setPixmap(imgs[0].thumb)
                        drag.exec(Qt.MoveAction)
                        self._drag_start_pos = None
                        return
        super().mouseMoveEvent(event)

    def _drag_images(self, item) -> list[ImageData]:
        img = item.data(Qt.UserRole)
        if img is None:
            return []
        if len(self.selectedItems()) > 1 and item.isSelected():
            return [it.data(Qt.UserRole) for it in self.selectedItems() if it.data(Qt.UserRole) is not None]
        return [img]

    # ---- 拖入 ----
    def dragEnterEvent(self, event) -> None:
        mime = event.mimeData()
        if mime.hasFormat(dnd.MIME_IMAGE) or mime.hasFormat(dnd.MIME_IMAGES) or mime.hasUrls():
            event.acceptProposedAction()

    def dragMoveEvent(self, event) -> None:
        mime = event.mimeData()
        if mime.hasFormat(dnd.MIME_IMAGE) or mime.hasFormat(dnd.MIME_IMAGES) or mime.hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        mime = event.mimeData()
        imgs = dnd.images_from_mime(mime)
        if imgs:
            if dnd.source_from_mime(mime) == "library":
                self.controller.place_from_library(imgs, self.group)
            else:
                self.controller.move_images_to(imgs, self.group)
        else:
            paths = [u.toLocalFile() for u in mime.urls() if u.isLocalFile()]
            if paths:
                self.controller.import_paths_into(paths, self.group)
        event.acceptProposedAction()

    # ---- 删除（编辑模式点图 / 右键移除） ----
    def _delete_item(self, item) -> None:
        img = item.data(Qt.UserRole)
        self.group.remove_image(img)
        self.controller.refresh_group(self.group)
        self.controller.notify_changed()

    def _on_context_menu(self, pos) -> None:
        menu = QMenu(self)
        act = QAction("从分组移除", self)
        act.triggered.connect(self._remove_selected)
        menu.addAction(act)
        menu.exec(self.mapToGlobal(pos))

    def _remove_selected(self) -> None:
        for item in list(self.selectedItems()):
            img = item.data(Qt.UserRole)
            self.group.remove_image(img)
        self.controller.refresh_group(self.group)
        self.controller.notify_changed()


class GroupBox(QWidget):
    delete_requested = Signal()
    activated = Signal()

    def __init__(self, group: Group, controller: "GroupsPanel", parent=None) -> None:
        super().__init__(parent)
        self.group = group
        self.setObjectName("GroupBox")
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        layout.setSpacing(4)
        title_row = QHBoxLayout()
        self.title_edit = QLineEdit(group.name)
        self.title_edit.textChanged.connect(self._on_rename)
        del_btn = QPushButton("×")
        del_btn.setObjectName("CloseBtn")
        del_btn.setFixedSize(28, 28)
        del_btn.setToolTip("删除该分组（可选择把图片放回图库）")
        del_btn.clicked.connect(self.delete_requested.emit)
        title_row.addWidget(self.title_edit, 1)
        title_row.addWidget(del_btn)
        layout.addLayout(title_row)
        self.count_label = QLabel("0 张")
        self.count_label.setObjectName("CountLabel")
        layout.addWidget(self.count_label)
        self.list = GroupImageList(group, controller, self)
        self.list.itemClicked.connect(lambda _: self.activated.emit())
        layout.addWidget(self.list, 1)
        self.update_count()

    def _on_rename(self, text: str) -> None:
        self.group.name = text or "分组"

    def update_count(self) -> None:
        self.count_label.setText(f"{len(self.group.images())} 张")

    def mousePressEvent(self, event) -> None:
        self.activated.emit()
        super().mousePressEvent(event)


class GroupsPanel(QWidget):
    groups_changed = Signal()
    active_changed = Signal(object)
    return_images = Signal(list)   # 删除分组时选择「放回图库」
    delete_images = Signal(list)   # 删除分组时选择「一起删除」

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        top = QHBoxLayout()
        add_btn = QPushButton("＋ 新建分组")
        add_btn.clicked.connect(self.add_group)
        self.edit_btn = QPushButton("编辑")
        self.edit_btn.setObjectName("GhostBtn")
        self.edit_btn.setCheckable(True)
        self.edit_btn.setToolTip("编辑模式：点分组里的图片即可移除")
        self.edit_btn.toggled.connect(self._set_edit_mode)
        top.addWidget(add_btn)
        top.addWidget(self.edit_btn)
        top.addStretch(1)
        layout.addLayout(top)
        self.splitter = QSplitter(Qt.Horizontal)
        layout.addWidget(self.splitter, 1)
        self.groups: list[Group] = []
        self.boxes: list[GroupBox] = []
        self.active_group: Group | None = None
        self.allow_duplicate = False

    def _set_edit_mode(self, on: bool) -> None:
        for b in self.boxes:
            b.list.set_edit_mode(on)

    # ---- 分组管理 ----
    def add_group(self, name: str | None = None) -> Group:
        g = Group(name=name or f"分组 {len(self.groups) + 1}")
        g.template_name = DEFAULT_KEY
        g.layout = list(TEMPLATES[DEFAULT_KEY])
        self.groups.append(g)
        box = GroupBox(g, self)
        box.list.set_edit_mode(self.edit_btn.isChecked())
        box.delete_requested.connect(lambda b=box: self._confirm_remove_group(b))
        box.activated.connect(lambda b=box: self.set_active(b.group))
        self.boxes.append(box)
        self.splitter.addWidget(box)
        self.set_active(g)
        self.groups_changed.emit()
        return g

    def _confirm_remove_group(self, box: GroupBox) -> None:
        g = box.group
        n = len(g.images())
        msg = QMessageBox(self)
        msg.setWindowTitle("删除分组")
        msg.setText(f"确定要删除分组「{g.name}」吗？")
        if n:
            msg.setInformativeText(f"该分组内有 {n} 张图片，可选择把它们放回图片库，或一起删除。")
        btn_return = msg.addButton("图片放回图库", QMessageBox.ActionRole)
        btn_delete = msg.addButton("删除图片和分组", QMessageBox.DestructiveRole)
        btn_cancel = msg.addButton("取消", QMessageBox.RejectRole)
        msg.setDefaultButton(btn_cancel)
        msg.exec()
        clicked = msg.clickedButton()
        if clicked is btn_cancel:
            return
        if clicked is btn_return:
            self.return_images.emit(g.images())
        else:
            self.delete_images.emit(g.images())
        self.remove_group(box)

    def remove_group(self, box: GroupBox) -> None:
        if box.group in self.groups:
            self.groups.remove(box.group)
        if box in self.boxes:
            self.boxes.remove(box)
        box.setParent(None)
        box.deleteLater()
        if self.active_group is box.group:
            self.active_group = self.groups[0] if self.groups else None
        self.groups_changed.emit()

    def set_active(self, group: Group) -> None:
        self.active_group = group
        for b in self.boxes:
            b.setProperty("active", b.group is group)
            b.style().unpolish(b)
            b.style().polish(b)
        self.active_changed.emit(group)

    # ---- 图片移动 ----
    def move_image_to(self, img: ImageData, target: Group) -> None:
        self.move_images_to([img], target)

    def move_images_to(self, imgs: list[ImageData], target: Group) -> None:
        changed = False
        for img in imgs:
            if target.has_image(img):
                continue
            src_crop = None
            for g in self.groups:
                if g is not target and g.has_image(img):
                    idx = g.cell_of(img)
                    if idx >= 0:
                        src_crop = (g.cells[idx].cx, g.cells[idx].cy, g.cells[idx].zoom)
                    g.remove_image(img)
                    self.refresh_group(g)
            idx = target.place_image(img)
            if idx >= 0:
                if src_crop is not None:
                    c = target.cells[idx]
                    c.cx, c.cy, c.zoom = src_crop
                changed = True
        if changed:
            self.refresh_group(target)
            self.groups_changed.emit()

    def resolve_library_duplicate(self, img: ImageData, target: Group) -> str:
        """从图库拖入、图片已在别的分组时：返回 'move' / 'copy' / 'cancel'"""
        others = [g for g in self.groups if g is not target and g.has_image(img)]
        if not others or self.allow_duplicate:
            return "copy"
        name = others[0].name
        msg = QMessageBox(self)
        msg.setWindowTitle("图片已在分组")
        msg.setText(f"这张图片已经在「{name}」里了。")
        msg.setInformativeText("要把它放进这个分组，你希望怎么处理？")
        btn_move = msg.addButton("移动到这里", QMessageBox.ActionRole)
        btn_copy = msg.addButton("复制一份（两个分组都有）", QMessageBox.ActionRole)
        btn_cancel = msg.addButton("取消", QMessageBox.RejectRole)
        msg.setDefaultButton(btn_cancel)
        msg.exec()
        clicked = msg.clickedButton()
        if clicked is btn_move:
            return "move"
        if clicked is btn_copy:
            return "copy"
        return "cancel"

    def remove_from_other_groups(self, img: ImageData, target: Group) -> None:
        for g in self.groups:
            if g is not target and g.has_image(img):
                g.remove_image(img)
                self.refresh_group(g)

    def place_from_library(self, imgs: list[ImageData], target: Group) -> None:
        """从图库拖入分组：对已在别的分组的图按开关决定移动/复制/取消"""
        changed = False
        for img in imgs:
            if target.has_image(img):
                continue
            action = self.resolve_library_duplicate(img, target)
            if action == "cancel":
                continue
            if action == "move":
                self.remove_from_other_groups(img, target)
            if target.place_image(img) >= 0:
                changed = True
        if changed:
            self.refresh_group(target)
            self.groups_changed.emit()

    def remove_images_from_all(self, imgs: list[ImageData]) -> None:
        """从所有分组中移除指定图片（图库删除时同步调用）"""
        idset = set(id(i) for i in imgs)
        changed = False
        for g in self.groups:
            before = len(g.images())
            for c in g.cells:
                if c.image is not None and id(c.image) in idset:
                    c.image = None
            if len(g.images()) != before:
                self.refresh_group(g)
                changed = True
        if changed:
            self.groups_changed.emit()

    def import_paths_into(self, paths: list[str], target: Group) -> None:
        images = importer.load_from_paths(paths)
        if not images:
            return
        target.ensure_cells()
        for img in images:
            target.place_image(img)
        self.refresh_group(target)
        self.groups_changed.emit()

    def refresh_group(self, group: Group) -> None:
        for b in self.boxes:
            if b.group is group:
                b.list.refresh()
                b.update_count()

    def notify_changed(self) -> None:
        self.groups_changed.emit()
