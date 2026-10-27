"""缩略图库面板：导入的图片 + 编辑模式删除 + 拖出到分组"""
from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QAction, QDrag, QIcon, QPixmap
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QComboBox,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QMenu,
    QPushButton,
    QVBoxLayout,
    QWidget,
)

from app.core import dnd
from app.models import ImageData
from app.ui.deletable_list import DeletableIconList, with_delete_badge, with_group_badge


class _LibraryList(DeletableIconList):
    """图库内部的图标列表：拖入文件、拖出到分组、编辑模式删除"""

    def __init__(self, panel: "LibraryPanel") -> None:
        super().__init__()
        self.panel = panel
        self.setViewMode(QListWidget.IconMode)
        self.setIconSize(QSize(160, 160))
        self.setGridSize(QSize(184, 184))
        self.setResizeMode(QListWidget.Adjust)
        self.setMovement(QListWidget.Static)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setSpacing(8)
        self.setAcceptDrops(True)
        self.setDragDropMode(QAbstractItemView.DropOnly)
        self.viewport().setAcceptDrops(True)
        self.setDropIndicatorShown(True)
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._on_context_menu)
        self._drag_start_pos = None

    # ---- 拖出到分组 ----
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
                            drag.setMimeData(dnd.image_mime(imgs[0], source="library"))
                        else:
                            drag.setMimeData(dnd.images_mime(imgs, source="library"))
                        if imgs[0].thumb is not None:
                            drag.setPixmap(imgs[0].thumb)
                        drag.exec(Qt.CopyAction)
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

    def _icon_for(self, img) -> QIcon:
        """图库缩略图：普通图原样，已分组的叠「分组N」标签（可多个），编辑模式再叠删除标记"""
        if img.thumb is None:
            return QIcon()
        pm = QPixmap(img.thumb)
        labels = self.panel._group_labels(img)
        if labels:
            pm = with_group_badge(pm, "、".join(labels))
        if self._edit_mode:
            return with_delete_badge(pm)
        return QIcon(pm)

    # ---- 删除（编辑模式点图 / 右键 / 删除选中按钮） ----
    def _delete_item(self, item) -> None:
        img = item.data(Qt.UserRole)
        if img is not None:
            self.panel._remove_image(img)

    def _on_context_menu(self, pos) -> None:
        menu = QMenu(self)
        act_remove = QAction("删除选中图片", self)
        act_remove.triggered.connect(self._remove_selected)
        menu.addAction(act_remove)
        menu.exec(self.mapToGlobal(pos))

    def _remove_selected(self) -> None:
        imgs = [it.data(Qt.UserRole) for it in self.selectedItems() if it.data(Qt.UserRole) is not None]
        if imgs:
            self.panel._remove_images(imgs)

    # ---- 拖入文件 ----
    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dragMoveEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        paths = [u.toLocalFile() for u in event.mimeData().urls() if u.isLocalFile()]
        if paths:
            self.panel.files_dropped.emit(paths)
        event.acceptProposedAction()


class LibraryPanel(QWidget):
    files_dropped = Signal(list)    # 拖入的文件路径列表
    images_changed = Signal()       # 图库内容变化
    images_deleted = Signal(list)   # 图片被从图库删除（用于同步移除分组中的同名图）

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._images: list[ImageData] = []
        self.groups = None          # 由主窗口注入，用于判断图片是否已分组
        self._filter = "全部"        # 全部 / 未分组 / 已分组
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(6)

        top = QHBoxLayout()
        self.filter_combo = QComboBox()
        self.filter_combo.addItems(["全部", "未分组", "已分组"])
        self.filter_combo.currentTextChanged.connect(self._on_filter_changed)
        self.edit_btn = QPushButton("编辑")
        self.edit_btn.setObjectName("GhostBtn")
        self.edit_btn.setCheckable(True)
        self.edit_btn.setToolTip("编辑模式：点图片即可删除")
        self.edit_btn.toggled.connect(self._set_edit_mode)
        self.del_btn = QPushButton("删除选中")
        self.del_btn.setObjectName("DangerBtn")
        self.del_btn.setVisible(False)
        self.count_label = QLabel("0 张")
        self.count_label.setObjectName("CountLabel")
        top.addWidget(self.filter_combo)
        top.addWidget(self.edit_btn)
        top.addWidget(self.del_btn)
        top.addStretch(1)
        top.addWidget(self.count_label)
        layout.addLayout(top)

        self.list = _LibraryList(self)
        self.del_btn.clicked.connect(self.list._remove_selected)
        layout.addWidget(self.list, 1)

    # ---- 编辑模式 ----
    def _set_edit_mode(self, on: bool) -> None:
        self.list.set_edit_mode(on)
        self.del_btn.setVisible(on)

    # ---- 数据 ----
    def add_images(self, images: list[ImageData]) -> None:
        added = False
        for img in images:
            if img in self._images:
                continue
            self._images.append(img)
            added = True
        if added:
            self._rebuild_items()
            self.images_changed.emit()
            self._update_count()

    def images(self) -> list[ImageData]:
        return list(self._images)

    def remove_images(self, images: list[ImageData]) -> None:
        """从图库移除指定图片（来自删除分组的「删除图片」选项）"""
        if not images:
            return
        idset = set(id(i) for i in images)
        keep = [img for img in self._images if id(img) not in idset]
        if len(keep) == len(self._images):
            return
        self._images = keep
        self._rebuild_items()
        self.images_changed.emit()
        self._update_count()

    # ---- 内部：删除与刷新 ----
    def _remove_image(self, img: ImageData) -> None:
        if img in self._images:
            self._images.remove(img)
        self._rebuild_items()
        self.images_deleted.emit([img])
        self.images_changed.emit()
        self._update_count()

    def _remove_images(self, imgs: list[ImageData]) -> None:
        removed = [img for img in imgs if img in self._images]
        for img in removed:
            self._images.remove(img)
        if not removed:
            return
        self._rebuild_items()
        self.images_deleted.emit(removed)
        self.images_changed.emit()
        self._update_count()

    def _rebuild_items(self) -> None:
        self.list.clear()
        for img in self._images:
            labels = self._group_labels(img)
            if self._filter == "已分组" and not labels:
                continue
            if self._filter == "未分组" and labels:
                continue
            self.list.add_image_item(img)

    def _update_count(self) -> None:
        self.count_label.setText(f"{len(self._images)} 张")

    # ---- 分组标记 / 页签筛选 ----
    def _group_labels(self, img: ImageData) -> list[str]:
        """返回图片所在的所有分组名（可多个），不在任何分组返回空列表"""
        if self.groups is None:
            return []
        return [g.name for g in self.groups.groups if g.has_image(img)]

    def _on_filter_changed(self, text: str) -> None:
        self._filter = text
        self._rebuild_items()

    def refresh_badges(self) -> None:
        """分组变化时刷新缩略图角标与筛选结果"""
        self._rebuild_items()
