"""可删除图标列表基类：编辑模式下给缩略图叠红色删除标记，点图即删"""
from __future__ import annotations

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import QColor, QFontMetrics, QIcon, QPainter, QPen, QPixmap
from PySide6.QtWidgets import QListWidget, QListWidgetItem

_DANGER = QColor("#E5484D")


def with_group_badge(pixmap: QPixmap, text: str) -> QPixmap:
    """在缩略图右下角叠一个灰底白字小标签（如「分组1」），表示该图已在某分组"""
    pm = QPixmap(pixmap)
    if pm.isNull() or not text:
        return pm
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    font = p.font()
    font.setPointSize(10)
    font.setBold(True)
    p.setFont(font)
    fm = QFontMetrics(font)
    tw = fm.horizontalAdvance(text) + 10
    th = fm.height() + 6
    x = pm.width() - tw - 5
    y = pm.height() - th - 5
    p.setBrush(QColor(90, 84, 78, 215))
    p.setPen(Qt.NoPen)
    p.drawRoundedRect(QRectF(x, y, tw, th), 5, 5)
    p.setPen(QColor(255, 255, 255))
    p.drawText(QRectF(x, y, tw, th), Qt.AlignCenter, text)
    p.end()
    return pm


def with_delete_badge(pixmap: QPixmap) -> QIcon:
    """在缩略图副本上叠一层红色蒙版 + 白色叉号，作为「可删除」提示"""
    pm = QPixmap(pixmap)
    if pm.isNull():
        return QIcon()
    p = QPainter(pm)
    p.setRenderHint(QPainter.Antialiasing)
    p.fillRect(pm.rect(), QColor(229, 72, 77, 90))
    pen = QPen(QColor(255, 255, 255), 6, Qt.SolidLine, Qt.RoundCap)
    p.setPen(pen)
    s = min(pm.width(), pm.height())
    cx, cy, d = pm.width() / 2, pm.height() / 2, s * 0.26
    p.drawLine(int(cx - d), int(cy - d), int(cx + d), int(cy + d))
    p.drawLine(int(cx - d), int(cy + d), int(cx + d), int(cy - d))
    p.end()
    return QIcon(pm)


class DeletableIconList(QListWidget):
    """编辑模式基类：管理 edit_mode、图标标记与点击删除入口"""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._edit_mode = False
        self.itemClicked.connect(self._on_item_clicked)

    def set_edit_mode(self, on: bool) -> None:
        if self._edit_mode == on:
            return
        self._edit_mode = on
        self._refresh_all_icons()

    def add_image_item(self, img) -> QListWidgetItem:
        item = QListWidgetItem()
        item.setIcon(self._icon_for(img))
        item.setData(Qt.UserRole, img)
        self.addItem(item)
        return item

    def _icon_for(self, img) -> QIcon:
        if img.thumb is None:
            return QIcon()
        if self._edit_mode:
            return with_delete_badge(img.thumb)
        return QIcon(img.thumb)

    def _refresh_all_icons(self) -> None:
        for i in range(self.count()):
            item = self.item(i)
            img = item.data(Qt.UserRole)
            if img is not None:
                item.setIcon(self._icon_for(img))

    def _on_item_clicked(self, item) -> None:
        if self._edit_mode:
            self._delete_item(item)

    def _delete_item(self, item) -> None:
        """子类实现：从对应数据源移除该图"""
        raise NotImplementedError
