"""拼图画布：宫格模式——自由放格、格内缩放/平移、框线拖动、自由模式拖外框、Ctrl+滚轮缩放"""
from __future__ import annotations

import io
import math

from PIL import Image
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (
    QAction,
    QBrush,
    QColor,
    QDrag,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
)
from PySide6.QtWidgets import (
    QApplication,
    QGraphicsItem,
    QGraphicsRectItem,
    QGraphicsScene,
    QGraphicsView,
    QMenu,
    QToolTip,
)

from app.core import dnd, settings
from app.core.renderer import crop_box
from app.models import Group, ImageData
from app.theme import ORANGE, ORANGE_HOVER

EPS = 1e-6
MIN_CELL = 0.05  # 框线拖动时格子的最小边长占比


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def _pil_to_qpixmap(pil: Image.Image) -> QPixmap:
    bio = io.BytesIO()
    pil.convert("RGB").save(bio, "PNG")
    pm = QPixmap()
    pm.loadFromData(bio.getvalue(), "PNG")
    return pm


def _compute_dividers(layout):
    """从布局推断可拖动的框线，返回 (竖直框线, 水平框线)，值为 span [start, end]"""
    verts: dict[float, list] = {}
    horiz: dict[float, list] = {}
    for x, y, w, h in layout:
        x2, y2 = x + w, y + h
        for bx in (x, x2):
            if EPS < bx < 1 - EPS:
                m = verts.setdefault(bx, [1.0, 0.0])
                m[0] = min(m[0], y)
                m[1] = max(m[1], y2)
        for by in (y, y2):
            if EPS < by < 1 - EPS:
                m = horiz.setdefault(by, [1.0, 0.0])
                m[0] = min(m[0], x)
                m[1] = max(m[1], x2)
    return verts, horiz


def _move_layout(layout, orientation, pos, delta):
    """移动一条框线，返回 (新布局, 实际位移)。位移被钳制以保持格子不小于 MIN_CELL"""
    if orientation == "v":
        left_min = min((w for x, y, w, h in layout if abs(x + w - pos) < EPS), default=MIN_CELL)
        right_min = min((w for x, y, w, h in layout if abs(x - pos) < EPS), default=MIN_CELL)
        lo = -(left_min - MIN_CELL)
        hi = right_min - MIN_CELL
    else:
        top_min = min((h for x, y, w, h in layout if abs(y + h - pos) < EPS), default=MIN_CELL)
        bot_min = min((h for x, y, w, h in layout if abs(y - pos) < EPS), default=MIN_CELL)
        lo = -(top_min - MIN_CELL)
        hi = bot_min - MIN_CELL
    lo += EPS
    hi -= EPS
    dx = max(lo, min(hi, delta))
    if abs(dx) < 1e-9:
        return layout, 0.0
    new = []
    for x, y, w, h in layout:
        if orientation == "v":
            if abs(x + w - pos) < EPS:
                w += dx
            elif abs(x - pos) < EPS:
                x += dx
                w -= dx
        else:
            if abs(y + h - pos) < EPS:
                h += dx
            elif abs(y - pos) < EPS:
                y += dx
                h -= dx
        new.append((x, y, w, h))
    return new, dx


class GridCellItem(QGraphicsRectItem):
    def __init__(self, index: int, group: Group, canvas: "CollageCanvas") -> None:
        super().__init__()
        self.index = index
        self.group = group
        self.canvas = canvas
        self.image: ImageData | None = None
        self._full_pm: QPixmap | None = None
        self._mode: str | None = None
        self._drag_start = None
        self._start_scene = None
        self._start_zoom = 1.0
        self._start_dist = 0.0
        self.setAcceptDrops(True)
        self.setAcceptedMouseButtons(Qt.LeftButton | Qt.RightButton)

    def cell(self):
        return self.group.cells[self.index]

    def _inner(self) -> QRectF:
        m = self.canvas.GAP / 2
        return self.rect().adjusted(m, m, -m, -m)

    def set_image(self, img: ImageData | None) -> None:
        self.image = img
        self._full_pm = None
        self.update()

    def _full_pixmap(self) -> QPixmap:
        if self._full_pm is None:
            if self.image is None:
                self._full_pm = QPixmap()
            else:
                try:
                    pil = self.image.full_image()
                except Exception:
                    self._full_pm = QPixmap()
                else:
                    pil.thumbnail((2048, 2048), Image.LANCZOS)
                    self._full_pm = _pil_to_qpixmap(pil)
        return self._full_pm

    # ---- 绘制 ----
    def paint(self, painter, option, widget=None) -> None:
        painter.setRenderHint(QPainter.Antialiasing, True)
        rect = self.rect()
        inner = self._inner()
        cell = self.cell()
        if self.image is not None:
            pm = self._full_pixmap()
            if not pm.isNull():
                fw, fh = pm.width(), pm.height()
                ratio = inner.width() / inner.height() if inner.height() > 0 else 1.0
                box = crop_box((fw, fh), ratio, cell.cx, cell.cy, cell.zoom)
                src = QRectF(box[0], box[1], box[2] - box[0], box[3] - box[1])
                painter.save()
                path = QPainterPath()
                path.addRoundedRect(inner, 4, 4)
                painter.setClipPath(path)
                painter.drawPixmap(inner, pm, src)
                painter.restore()
        else:
            # 空格子：虚线框 + 提示文字（始终显示，便于知道可以拖图）
            painter.setPen(QPen(QColor("#D8CCC0"), 1, Qt.DashLine))
            painter.setBrush(Qt.NoBrush)
            painter.drawRoundedRect(inner, 4, 4)
            painter.setPen(QColor("#B0A090"))
            painter.drawText(rect, Qt.AlignCenter, "拖入图片")

        # 有图片时：有框线才画格子描边（无框线 = 无缝无边框）
        if self.image is not None and self.canvas.GAP > 0:
            painter.setPen(QPen(QColor("#E8DCCE"), 1))
            painter.setBrush(Qt.NoBrush)
            painter.drawRoundedRect(inner, 4, 4)

        if self.canvas.selected_index == self.index and self.image is not None:
            editing = self.canvas.editing_index == self.index
            painter.setPen(QPen(QColor(ORANGE), 3 if editing else 2))
            painter.setBrush(Qt.NoBrush)
            painter.drawRoundedRect(inner, 4, 4)
            if editing:
                painter.setPen(Qt.NoPen)
                painter.setBrush(QColor(ORANGE))
                for h in self._handle_rects():
                    painter.drawRect(h)

    def _handle_rects(self) -> list[QRectF]:
        inner = self._inner()
        s = self.canvas.HANDLE
        corners = [
            (inner.left(), inner.top()),
            (inner.right(), inner.top()),
            (inner.left(), inner.bottom()),
            (inner.right(), inner.bottom()),
        ]
        return [QRectF(x - s / 2, y - s / 2, s, s) for x, y in corners]

    def _hit_handle(self, pos: QPointF) -> int | None:
        for i, h in enumerate(self._handle_rects()):
            if h.contains(pos):
                return i
        return None

    # ---- 鼠标交互：选中 / 平移 / 缩放 / 换位 ----
    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            # 点另一个格子时先退出当前编辑
            if self.canvas.editing_index is not None and self.canvas.editing_index != self.index:
                self.canvas.set_edit_index(None)
            pos = event.scenePos()
            self.canvas.select_cell(self.index)
            cell = self.cell()
            # 只有「编辑这张图」状态下才允许格内缩放/平移
            if cell.image is not None and self.canvas.editing_index == self.index:
                self._start_scene = pos
                if self._hit_handle(pos) is not None:
                    self._mode = "zoom"
                    self._start_zoom = cell.zoom
                    c = self._inner().center()
                    self._start_dist = math.hypot(pos.x() - c.x(), pos.y() - c.y())
                    event.accept()
                    return
                if self._inner().contains(pos):
                    self._mode = "pan"
                    event.accept()
                    return
            self._mode = "swap"
            self._drag_start = pos
            event.accept()
            return
        super().mousePressEvent(event)

    def contextMenuEvent(self, event) -> None:
        """右键：进入/退出本格编辑（编辑时框线锁定）"""
        if self.image is None:
            return
        menu = QMenu(self.canvas)
        if self.canvas.editing_index == self.index:
            act = QAction("退出编辑", self.canvas)
            act.triggered.connect(lambda: self.canvas.set_edit_index(None))
        else:
            act = QAction("编辑这张图", self.canvas)
            act.triggered.connect(lambda: self.canvas.set_edit_index(self.index))
        menu.addAction(act)
        menu.exec(event.screenPos())

    def mouseMoveEvent(self, event) -> None:
        pos = event.scenePos()
        if self._mode == "pan":
            dx = pos.x() - self._start_scene.x()
            dy = pos.y() - self._start_scene.y()
            self._start_scene = pos
            self._pan_by(dx, dy)
            event.accept()
            return
        if self._mode == "zoom":
            c = self._inner().center()
            dist = math.hypot(pos.x() - c.x(), pos.y() - c.y())
            factor = self._start_zoom * self._start_dist / max(dist, 1e-3)
            self.cell().zoom = _clamp(factor, 1.0, 10.0)
            self.update()
            event.accept()
            return
        if self._mode == "swap" and event.buttons() & Qt.LeftButton and self._drag_start is not None:
            delta = pos - self._drag_start
            if delta.manhattanLength() >= QApplication.startDragDistance():
                if self.image is not None:
                    drag = QDrag(self.canvas.viewport())
                    drag.setMimeData(dnd.image_mime(self.image))
                    pm = self.image.thumb if self.image.thumb is not None else self._full_pixmap()
                    if pm is not None and not pm.isNull():
                        drag.setPixmap(pm)
                    drag.exec(Qt.MoveAction)
                    self._drag_start = None
                    self._mode = None
                    return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        self._mode = None
        self._drag_start = None
        self._start_scene = None
        super().mouseReleaseEvent(event)

    # ---- 平移 / 缩放计算 ----
    def _pan_by(self, dx: float, dy: float) -> None:
        cell = self.cell()
        if cell.image is None:
            return
        pm = self._full_pixmap()
        fw, fh = pm.width(), pm.height()
        if fw <= 0 or fh <= 0:
            return
        inner = self._inner()
        cw = max(1.0, inner.width())
        ch = max(1.0, inner.height())
        ratio = cw / ch
        if fw / fh > ratio:
            base_w, base_h = fh * ratio, fh
        else:
            base_w, base_h = fw, fw / ratio
        z = max(1.0, cell.zoom)
        sx = z * cw / base_w
        sy = z * ch / base_h
        cell.cx = _clamp(cell.cx - dx / (sx * fw), 0.0, 1.0)
        cell.cy = _clamp(cell.cy - dy / (sy * fh), 0.0, 1.0)
        self.update()

    def _zoom_by(self, factor: float) -> None:
        """围绕画面中心缩放（factor>1 放大，<1 缩小）"""
        cell = self.cell()
        if cell.image is None:
            return
        cell.zoom = _clamp(cell.zoom * factor, 1.0, 10.0)
        self.update()

    # ---- 拖入（换位 / 放置新图） ----
    def dragEnterEvent(self, event) -> None:
        mime = event.mimeData()
        if mime.hasFormat(dnd.MIME_IMAGE) or mime.hasFormat(dnd.MIME_IMAGES):
            event.acceptProposedAction()

    def dragMoveEvent(self, event) -> None:
        mime = event.mimeData()
        if mime.hasFormat(dnd.MIME_IMAGE) or mime.hasFormat(dnd.MIME_IMAGES):
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        mime = event.mimeData()
        imgs = dnd.images_from_mime(mime)
        if imgs:
            self.canvas.drop_images_to(imgs, self.index, dnd.source_from_mime(mime))
        event.acceptProposedAction()


class DividerItem(QGraphicsItem):
    """可拖动的框线：竖直/水平分割线"""

    def __init__(self, canvas: "CollageCanvas", orientation: str, pos: float, span: tuple) -> None:
        super().__init__()
        self.canvas = canvas
        self.orientation = orientation  # "v" | "h"
        self.pos = pos                  # 归一化位置
        self.span = span                # 归一化 [start, end]
        self.setZValue(5)
        self.setCursor(Qt.SizeHorCursor if orientation == "v" else Qt.SizeVerCursor)
        self.setAcceptHoverEvents(True)
        self._drag_start = None
        self._hover = False

    def boundingRect(self) -> QRectF:
        aw, ah = self.canvas.art_w, self.canvas.art_h
        hit = 8
        if self.orientation == "v":
            x = self.pos * aw
            return QRectF(x - hit / 2, self.span[0] * ah, hit, (self.span[1] - self.span[0]) * ah)
        y = self.pos * ah
        return QRectF(self.span[0] * aw, y - hit / 2, (self.span[1] - self.span[0]) * aw, hit)

    def paint(self, painter, option, widget=None) -> None:
        painter.setRenderHint(QPainter.Antialiasing, True)
        color = QColor(ORANGE if self._hover else "#E0C8B0")
        painter.setPen(QPen(color, 2))
        aw, ah = self.canvas.art_w, self.canvas.art_h
        if self.orientation == "v":
            x = self.pos * aw
            painter.drawLine(QPointF(x, self.span[0] * ah), QPointF(x, self.span[1] * ah))
        else:
            y = self.pos * ah
            painter.drawLine(QPointF(self.span[0] * aw, y), QPointF(self.span[1] * aw, y))

    def hoverEnterEvent(self, event) -> None:
        self._hover = True
        self.update()

    def hoverLeaveEvent(self, event) -> None:
        self._hover = False
        self.update()

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self._drag_start = event.scenePos()
            event.accept()

    def mouseMoveEvent(self, event) -> None:
        if event.buttons() & Qt.LeftButton and self._drag_start is not None:
            aw, ah = self.canvas.art_w, self.canvas.art_h
            if self.orientation == "v":
                d = (event.scenePos().x() - self._drag_start.x()) / aw
            else:
                d = (event.scenePos().y() - self._drag_start.y()) / ah
            moved = self.canvas.move_divider(self.orientation, self.pos, d)
            if moved != 0.0:
                self.prepareGeometryChange()
                self.pos += moved
                self.update()
            self._drag_start = event.scenePos()
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        self._drag_start = None
        self.canvas.refresh_crops()
        super().mouseReleaseEvent(event)


class BorderHandle(QGraphicsRectItem):
    """自由模式下的画布外框拖动手柄：四角「+」、四边「—」"""

    SIZE = 20.0

    def __init__(self, canvas: "CollageCanvas", kind: str) -> None:
        super().__init__()
        self.canvas = canvas
        self.kind = kind  # tl/tr/bl/br/left/right/top/bottom
        self.setRect(-self.SIZE / 2, -self.SIZE / 2, self.SIZE, self.SIZE)
        self.setZValue(8)
        self.setAcceptHoverEvents(True)
        cursors = {
            "tl": Qt.SizeFDiagCursor, "br": Qt.SizeFDiagCursor,
            "tr": Qt.SizeBDiagCursor, "bl": Qt.SizeBDiagCursor,
            "left": Qt.SizeHorCursor, "right": Qt.SizeHorCursor,
            "top": Qt.SizeVerCursor, "bottom": Qt.SizeVerCursor,
        }
        self.setCursor(cursors[kind])
        self._start = None
        self._start_w = 0.0
        self._start_h = 0.0

    def _refresh_pos(self) -> None:
        w, h = self.canvas.art_w, self.canvas.art_h
        x = {"tl": 0.0, "tr": w, "bl": 0.0, "br": w, "left": 0.0, "right": w, "top": w / 2, "bottom": w / 2}[self.kind]
        y = {"tl": 0.0, "tr": 0.0, "bl": h, "br": h, "left": h / 2, "right": h / 2, "top": 0.0, "bottom": h}[self.kind]
        self.setPos(x, y)

    def paint(self, painter, option, widget=None) -> None:
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setBrush(QColor(ORANGE))
        painter.setPen(QPen(QColor("white"), 2))
        painter.drawEllipse(self.rect())
        c = self.rect().center()
        d = self.rect().width() * 0.20
        painter.setPen(QPen(QColor("white"), 2, Qt.SolidLine, Qt.RoundCap))
        if self.kind in ("tl", "tr", "bl", "br"):
            painter.drawLine(QPointF(c.x() - d, c.y()), QPointF(c.x() + d, c.y()))
            painter.drawLine(QPointF(c.x(), c.y() - d), QPointF(c.x(), c.y() + d))
        else:
            painter.drawLine(QPointF(c.x() - d, c.y()), QPointF(c.x() + d, c.y()))

    def mousePressEvent(self, event) -> None:
        if event.button() == Qt.LeftButton:
            self._start = event.scenePos()
            self._start_w = self.canvas.art_w
            self._start_h = self.canvas.art_h
            event.accept()

    def mouseMoveEvent(self, event) -> None:
        if self._start is not None and event.buttons() & Qt.LeftButton:
            dx = event.scenePos().x() - self._start.x()
            dy = event.scenePos().y() - self._start.y()
            w, h = self._start_w, self._start_h
            k = self.kind
            if k in ("right", "tr", "br"):
                w = self._start_w + dx
            if k in ("left", "tl", "bl"):
                w = self._start_w - dx
            if k in ("bottom", "bl", "br"):
                h = self._start_h + dy
            if k in ("top", "tl", "tr"):
                h = self._start_h - dy
            self.canvas._apply_art_size(w, h)
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event) -> None:
        self._start = None
        super().mouseReleaseEvent(event)


class CollageCanvas(QGraphicsView):
    group_modified = Signal(object)

    GAP_UNITS = 12.0   # 有框线时的缝隙（场景单位）
    HANDLE = 16.0      # 格内缩放手柄边长（场景单位）
    MIN_ART = 200.0    # 画布外框最小边长
    MAX_ART = 4000.0   # 画布外框最大边长

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self._scene = QGraphicsScene(self)
        self.setScene(self._scene)
        self.setRenderHints(QPainter.Antialiasing | QPainter.SmoothPixmapTransform)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorViewCenter)
        self.setDragMode(QGraphicsView.NoDrag)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setAcceptDrops(True)
        self.viewport().setAcceptDrops(True)
        self._group: Group | None = None
        self._cells: list[GridCellItem] = []
        self._dividers: list[DividerItem] = []
        self._handles: list[BorderHandle] = []
        self.selected_index: int | None = None
        self.editing_index: int | None = None
        self.groups = None
        self.art_w = 1080.0
        self.art_h = 1080.0
        self.free_mode = False
        self._fitted = False
        self._artboard = self._scene.addRect(
            0, 0, self.art_w, self.art_h,
            QPen(QColor("#C9BCAC"), 1, Qt.DashLine), QBrush(QColor("#FFFFFF")),
        )
        self._artboard.setZValue(-1)
        self._build_handles()

    @property
    def GAP(self) -> float:
        return self.GAP_UNITS if settings.gap_enabled else 0.0

    def _build_handles(self) -> None:
        for kind in ("tl", "tr", "bl", "br", "left", "right", "top", "bottom"):
            h = BorderHandle(self, kind)
            h.setVisible(False)
            self._scene.addItem(h)
            self._handles.append(h)

    # ---- 构建 ----
    def set_group(self, group: Group | None) -> None:
        self._group = group
        self.selected_index = None
        self.editing_index = None
        for c in self._cells:
            self._scene.removeItem(c)
        for d in self._dividers:
            self._scene.removeItem(d)
        self._cells = []
        self._dividers = []
        if group is None:
            return
        group.ensure_cells()
        self._build_cells()
        self._build_dividers()
        self._assign()

    def _build_cells(self) -> None:
        for i, (x, y, w, h) in enumerate(self._group.layout):
            cell = GridCellItem(i, self._group, self)
            cell.setRect(x * self.art_w, y * self.art_h, w * self.art_w, h * self.art_h)
            self._scene.addItem(cell)
            self._cells.append(cell)

    def _build_dividers(self) -> None:
        verts, horiz = _compute_dividers(self._group.layout)
        for x, span in verts.items():
            d = DividerItem(self, "v", x, (span[0], span[1]))
            self._scene.addItem(d)
            self._dividers.append(d)
        for y, span in horiz.items():
            d = DividerItem(self, "h", y, (span[0], span[1]))
            self._scene.addItem(d)
            self._dividers.append(d)

    def _assign(self) -> None:
        if self._group is None:
            return
        self._group.ensure_cells()
        for cell_item in self._cells:
            cell = self._group.cells[cell_item.index]
            cell_item.set_image(cell.image)

    # ---- 画布尺寸 / 自由模式 ----
    def set_art_size(self, w: float, h: float) -> None:
        """按尺寸下拉/自定义宽高锁定画布大小"""
        self._apply_art_size(w, h)

    def _apply_art_size(self, w: float, h: float) -> None:
        w = _clamp(w, self.MIN_ART, self.MAX_ART)
        h = _clamp(h, self.MIN_ART, self.MAX_ART)
        if abs(w - self.art_w) < 0.5 and abs(h - self.art_h) < 0.5:
            return
        self.art_w = w
        self.art_h = h
        self._artboard.setRect(0, 0, w, h)
        for cell in self._cells:
            x, y, cw, ch = self._group.layout[cell.index]
            cell.setRect(x * w, y * h, cw * w, ch * h)
        for d in self._dividers:
            d.prepareGeometryChange()
            d.update()
        for hnd in self._handles:
            hnd._refresh_pos()

    def set_free_mode(self, on: bool) -> None:
        self.free_mode = on
        for h in self._handles:
            h.setVisible(on)
        if on:
            self._artboard.setPen(QPen(QColor(ORANGE), 2))
        else:
            self._artboard.setPen(QPen(QColor("#C9BCAC"), 1, Qt.DashLine))

    def _near_border(self, pos: QPointF) -> bool:
        m = 14.0
        w, h = self.art_w, self.art_h
        return (
            abs(pos.x()) < m or abs(pos.x() - w) < m
            or abs(pos.y()) < m or abs(pos.y() - h) < m
        )

    # ---- 选中 ----
    def select_cell(self, index: int | None) -> None:
        if self.selected_index == index:
            return
        self.selected_index = index
        for c in self._cells:
            c.update()
        if index is not None:
            self.setFocus()

    def set_edit_index(self, index: int | None) -> None:
        """进入/退出格内编辑。编辑时锁定框线，避免与缩放/平移冲突"""
        if index is not None and not (0 <= index < len(self._cells)):
            index = None
        self.editing_index = index
        if index is not None:
            self.selected_index = index
        # 编辑时锁定（禁用）框线，退出后恢复
        for d in self._dividers:
            d.setEnabled(self.editing_index is None)
        for c in self._cells:
            c.update()
        self.setFocus()

    def mousePressEvent(self, event) -> None:
        item = self.itemAt(event.position().toPoint())
        if not isinstance(item, (GridCellItem, DividerItem, BorderHandle)):
            self.select_cell(None)
            if self.editing_index is not None:
                self.set_edit_index(None)
            if not self.free_mode and self._group is not None:
                sp = self.mapToScene(event.position().toPoint())
                if self._near_border(sp):
                    QToolTip.showText(
                        event.globalPosition().toPoint(),
                        "请选择「自由模式」后再拖动边框",
                        self,
                    )
                    event.accept()
                    return
        super().mousePressEvent(event)

    def keyPressEvent(self, event) -> None:
        key = event.key()
        if key == Qt.Key_Escape:
            if self.editing_index is not None:
                self.set_edit_index(None)
            else:
                self.select_cell(None)
            event.accept()
            return
        if self.editing_index is not None and 0 <= self.editing_index < len(self._cells):
            item = self._cells[self.editing_index]
            if item.image is not None:
                if key in (Qt.Key_Plus, Qt.Key_Equal):
                    item._zoom_by(1.12)
                    event.accept()
                    return
                if key == Qt.Key_Minus:
                    item._zoom_by(1 / 1.12)
                    event.accept()
                    return
                step = 20.0 if event.modifiers() & Qt.ShiftModifier else 2.0
                if key == Qt.Key_Left:
                    item._pan_by(-step, 0)
                    event.accept()
                    return
                if key == Qt.Key_Right:
                    item._pan_by(step, 0)
                    event.accept()
                    return
                if key == Qt.Key_Up:
                    item._pan_by(0, -step)
                    event.accept()
                    return
                if key == Qt.Key_Down:
                    item._pan_by(0, step)
                    event.accept()
                    return
        super().keyPressEvent(event)

    # ---- 放置 / 换位 ----
    def drop_images_to(self, imgs: list[ImageData], target_index: int, source: str = "group") -> None:
        group = self._group
        if group is None or not imgs:
            return
        group.ensure_cells()
        n = len(group.cells)
        if target_index < 0 or target_index >= n:
            return
        if len(imgs) == 1 and group.has_image(imgs[0]):
            src = group.cell_of(imgs[0])
            group.cells[src], group.cells[target_index] = group.cells[target_index], group.cells[src]
            self._assign()
            self.group_modified.emit(group)
            return
        for img in imgs:
            if group.has_image(img):
                continue
            if self.groups is not None:
                if source == "library":
                    action = self.groups.resolve_library_duplicate(img, group)
                    if action == "cancel":
                        continue
                    if action == "move":
                        self.groups.remove_from_other_groups(img, group)
                else:
                    self.groups.remove_from_other_groups(img, group)
            placed = False
            for k in range(n):
                j = (target_index + k) % n
                if group.cells[j].image is None:
                    c = group.cells[j]
                    c.image = img
                    c.cx, c.cy, c.zoom = 0.5, 0.5, 1.0
                    placed = True
                    break
            if not placed:
                c = group.cells[target_index]
                c.image = img
                c.cx, c.cy, c.zoom = 0.5, 0.5, 1.0
        self._assign()
        self.group_modified.emit(group)

    # ---- 框线 ----
    def move_divider(self, orientation: str, pos: float, delta: float) -> float:
        """移动框线，返回实际位移；只更新几何，不重新裁切（拖动更顺滑）"""
        if self._group is None:
            return 0.0
        new_layout, dx = _move_layout(self._group.layout, orientation, pos, delta)
        if dx == 0.0:
            return 0.0
        self._group.layout = new_layout
        for cell in self._cells:
            x, y, w, h = self._group.layout[cell.index]
            cell.setRect(x * self.art_w, y * self.art_h, w * self.art_w, h * self.art_h)
        return dx

    def refresh_crops(self) -> None:
        """框线拖动结束后，按新比例重新裁切显示"""
        self._assign()

    # ---- Ctrl+滚轮缩放 ----
    def wheelEvent(self, event) -> None:
        if event.modifiers() & Qt.ControlModifier:
            factor = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
            self.scale(factor, factor)
            event.accept()
            return
        # 编辑状态下，滚动滚轮 = 缩放该格图片
        if self.editing_index is not None and 0 <= self.editing_index < len(self._cells):
            delta = event.angleDelta().y()
            if delta != 0:
                self._cells[self.editing_index]._zoom_by(1.12 if delta > 0 else 1 / 1.12)
                event.accept()
                return
        super().wheelEvent(event)

    def showEvent(self, event) -> None:
        super().showEvent(event)
        if not self._fitted:
            self._fitted = True
            self.fitInView(self._artboard, Qt.KeepAspectRatio)
