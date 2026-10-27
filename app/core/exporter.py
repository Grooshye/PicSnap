"""导出：保存文件 + 复制到剪贴板"""
from __future__ import annotations

import io

from PIL import Image
from PySide6.QtCore import QByteArray
from PySide6.QtGui import QImage
from PySide6.QtWidgets import QApplication


def save_image(img: Image.Image, path: str, fmt: str = "PNG", quality: int = 95) -> None:
    """保存为 PNG 或 JPG"""
    if fmt.upper() in ("JPG", "JPEG"):
        img.convert("RGB").save(path, "JPEG", quality=quality)
    else:
        img.save(path, "PNG")


def copy_to_clipboard(img: Image.Image) -> None:
    """把成品图复制到系统剪贴板（可直接粘贴到微信/画图等）"""
    bio = io.BytesIO()
    img.convert("RGBA").save(bio, "PNG")
    qimg = QImage.fromData(QByteArray(bio.getvalue()), "PNG")
    QApplication.clipboard().setImage(qimg)
