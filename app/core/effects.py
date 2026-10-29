"""图片处理：高斯模糊 / 马赛克

参数与网页版 web/js/models.js 的 applyEffect() 完全一致，
保证同一张图在桌面版和网页版上出来的效果相同。
"""
from __future__ import annotations

from PIL import Image, ImageFilter

# 处理方式取值：none 不处理 / blur 高斯模糊 / mosaic 马赛克
MODES = ("none", "blur", "mosaic")


def apply_effect(img: Image.Image, mode: str, amount: int = 30) -> Image.Image:
    """对整张图施加模糊或马赛克，返回新图（不修改原图）。

    amount 强度 1~100；数值越大越模糊 / 马赛克格子越大。
    """
    mode = mode or "none"
    if mode not in MODES or mode == "none" or img is None:
        return img

    w, h = img.size
    if w < 1 or h < 1:
        return img
    t = max(0, min(100, int(amount))) / 100.0
    base = min(w, h) / 100.0

    if mode == "mosaic":
        # 先缩到很小，再用最近邻放大回去
        block = max(2, round(base * (1 + t * 24)))
        sw = max(1, round(w / block))
        sh = max(1, round(h / block))
        small = img.resize((sw, sh), Image.BOX)
        return small.resize((w, h), Image.NEAREST)

    # 高斯模糊：PIL 的边缘会自动向外延伸，不会出现暗边
    radius = max(0.5, base * (1 + t * 6))
    return img.filter(ImageFilter.GaussianBlur(radius))
