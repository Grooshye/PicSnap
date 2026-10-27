"""导入：从文件路径或剪贴板加载图片"""
from __future__ import annotations

import io
import os
from typing import Iterable

from PIL import Image, ImageOps
from PySide6.QtCore import QBuffer, QByteArray
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import QApplication

from app.models import ImageData

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".gif", ".tif", ".tiff"}


def _to_thumb(img: Image.Image, max_size: int = 256) -> QPixmap:
    """PIL 图转缩略图 QPixmap"""
    img = ImageOps.exif_transpose(img).convert("RGBA")
    img.thumbnail((max_size, max_size), Image.LANCZOS)
    bio = io.BytesIO()
    img.save(bio, "PNG")
    pixmap = QPixmap()
    pixmap.loadFromData(bio.getvalue(), "PNG")
    return pixmap


def _qimage_to_pil(qimg: QImage) -> Image.Image:
    """QImage 转 PIL 图（走 PNG 中转，跨版本稳定）"""
    ba = QByteArray()
    buf = QBuffer(ba)
    buf.open(QBuffer.WriteOnly)
    qimg.save(buf, "PNG")
    buf.close()
    return Image.open(io.BytesIO(bytes(ba))).convert("RGBA")


def load_from_paths(paths: Iterable[str]) -> list[ImageData]:
    """从文件路径列表加载图片，跳过无法识别的文件"""
    items: list[ImageData] = []
    for p in paths:
        if not os.path.isfile(p):
            continue
        if os.path.splitext(p)[1].lower() not in SUPPORTED_EXTS:
            continue
        try:
            img = Image.open(p)
            thumb = _to_thumb(img)
        except Exception:
            continue
        items.append(ImageData(path=p, thumb=thumb))
    return items


def load_image_from_clipboard() -> ImageData | None:
    """从剪贴板读取图片数据（如截图），没有则返回 None"""
    clipboard = QApplication.clipboard()
    if clipboard.mimeData().hasImage():
        qimg = clipboard.image()
        img = _qimage_to_pil(qimg)
        return ImageData(path=None, thumb=_to_thumb(img), full=img)
    return None


def clipboard_paths() -> list[str]:
    """从剪贴板读取文件路径（如资源管理器里复制的图片文件）"""
    mime = QApplication.clipboard().mimeData()
    if mime.hasUrls():
        return [u.toLocalFile() for u in mime.urls() if u.isLocalFile()]
    return []
