"""渲染引擎：把分组（宫格布局 + 图片）合成为成品图"""
from __future__ import annotations

from PIL import Image

from app.core import settings
from app.models import Group

GAP = 12.0      # 有框线时的缝隙（与画布一致，基于 1080 场景单位）
ART_SIZE = 1080.0


def _clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def crop_box(src_size: tuple[int, int], ratio: float, cx: float, cy: float, zoom: float) -> tuple[int, int, int, int]:
    """按格内缩放/平移参数计算源图裁切框（像素）。

    ratio = 目标格宽高比；cx/cy = 可见区域中心（归一化）；zoom = 缩放倍数（>=1）。
    """
    sw, sh = src_size
    if sw / sh > ratio:
        base_w, base_h = sh * ratio, sh
    else:
        base_w, base_h = sw, sw / ratio
    z = max(1.0, zoom)
    w = min(base_w / z, sw)
    h = min(base_h / z, sh)
    left = _clamp(cx * sw - w / 2, 0.0, sw - w)
    top = _clamp(cy * sh - h / 2, 0.0, sh - h)
    return (round(left), round(top), round(left + w), round(top + h))


def _cell_image(cell, src: Image.Image, cw: int, ch: int) -> Image.Image:
    """把 cell 的图按格内参数裁切并缩放到 cw×ch"""
    box = crop_box(src.size, cw / ch, cell.cx, cell.cy, cell.zoom)
    return src.crop(box).resize((cw, ch), Image.LANCZOS)


def render_group(group: Group, width: int, height: int, background: str = "#FFFFFF") -> Image.Image:
    """按固定尺寸合成成品图"""
    group.ensure_cells()
    img = Image.new("RGB", (width, height), background)
    gap_units = GAP if settings.gap_enabled else 0.0
    gap = max(0, round(min(width, height) * gap_units / ART_SIZE))
    for i, (x, y, w, h) in enumerate(group.layout):
        if i >= len(group.cells):
            continue
        cell = group.cells[i]
        if cell.image is None:
            continue
        try:
            src = cell.image.full_image()
        except Exception:
            continue
        left = round(x * width) + gap // 2
        top = round(y * height) + gap // 2
        right = round((x + w) * width) - gap // 2
        bottom = round((y + h) * height) - gap // 2
        cw, ch = right - left, bottom - top
        if cw <= 0 or ch <= 0:
            continue
        img.paste(_cell_image(cell, src, cw, ch).convert("RGB"), (left, top))
    return img


def compute_native_size(group: Group, aspect: float = 1.0, max_side: int = 6000) -> tuple[int, int]:
    """计算「原图质量」输出尺寸：尽量不让图片被放大（不超过 max_side）"""
    group.ensure_cells()
    scale = 1.0
    for i, (x, y, w, h) in enumerate(group.layout):
        if i >= len(group.cells):
            continue
        cell = group.cells[i]
        if cell.image is None:
            continue
        try:
            src = cell.image.full_image()
        except Exception:
            continue
        sw, sh = src.size
        ratio = (w * aspect) / h
        box = crop_box((sw, sh), ratio, cell.cx, cell.cy, cell.zoom)
        cw, ch = box[2] - box[0], box[3] - box[1]
        need = max(cw / (w * aspect), ch / h)
        scale = max(scale, need)
    base = min(max_side, int(scale))
    return max(1, round(base * aspect)), max(1, base)
