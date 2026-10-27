"""数据模型"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from PIL import Image, ImageOps
from PySide6.QtGui import QPixmap


@dataclass
class ImageData:
    """一张已导入的图片（文件或剪贴板）"""

    path: Optional[str] = None          # 文件路径（剪贴板图片为 None）
    thumb: Optional[QPixmap] = None     # 缩略图
    full: Optional[Image.Image] = None  # 剪贴板图片的整图驻内存

    def full_image(self) -> Image.Image:
        """返回完整 PIL 图：剪贴板用内存，文件按需重读"""
        if self.full is not None:
            return self.full
        if self.path:
            img = Image.open(self.path)
            return ImageOps.exif_transpose(img).convert("RGBA")
        raise ValueError("图片没有可用数据")


@dataclass
class Cell:
    """宫格中的一个格子：可放一张图（可空），带格内缩放/平移参数"""

    image: Optional[ImageData] = None
    cx: float = 0.5    # 可见区域中心 x（归一化 0~1）
    cy: float = 0.5    # 可见区域中心 y
    zoom: float = 1.0  # 缩放倍数（1 = 整图铺满，>1 放大）


@dataclass
class Group:
    """一个分组：一组图片，最终拼成 1 张成品图"""

    name: str = "分组"
    mode: str = "grid"
    template_name: str = ""
    layout: list = field(default_factory=list)   # N 个归一化矩形 (x, y, w, h)
    cells: list[Cell] = field(default_factory=list)  # 与 layout 一一对应

    def ensure_cells(self) -> None:
        """让 cells 数量与 layout 对齐（多退少补）"""
        n = len(self.layout)
        while len(self.cells) < n:
            self.cells.append(Cell())
        if len(self.cells) > n:
            del self.cells[n:]

    def images(self) -> list[ImageData]:
        """分组内出现的图片（去重、按格子顺序）"""
        out: list[ImageData] = []
        for c in self.cells:
            if c.image is not None and c.image not in out:
                out.append(c.image)
        return out

    def has_image(self, img: ImageData) -> bool:
        return any(c.image is img for c in self.cells)

    def cell_of(self, img: ImageData) -> int:
        """返回图片所在第一个格子的索引，没有则 -1"""
        for i, c in enumerate(self.cells):
            if c.image is img:
                return i
        return -1

    def remove_image(self, img: ImageData) -> None:
        """把某图从该分组所有格子中移除"""
        for c in self.cells:
            if c.image is img:
                c.image = None

    def place_image(self, img: ImageData, index: int | None = None) -> int:
        """把图放入指定格或第一个空格，返回格子索引（放不进则 -1）"""
        self.ensure_cells()
        if index is not None and 0 <= index < len(self.cells):
            c = self.cells[index]
            c.image = img
            c.cx, c.cy, c.zoom = 0.5, 0.5, 1.0
            return index
        for i, c in enumerate(self.cells):
            if c.image is None:
                c.image = img
                c.cx, c.cy, c.zoom = 0.5, 0.5, 1.0
                return i
        return -1
