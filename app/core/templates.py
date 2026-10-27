"""内置宫格模板：归一化矩形 (x, y, w, h)，0~1 坐标（相邻格共享边，缝隙由画布绘制）"""
from __future__ import annotations


def _row(n):
    return [(i / n, 0.0, 1 / n, 1.0) for i in range(n)]


def _col(n):
    return [(0.0, i / n, 1.0, 1 / n) for i in range(n)]


def _grid(r, c):
    return [(j / c, i / r, 1 / c, 1 / r) for i in range(r) for j in range(c)]


def _cells(*rects):
    return list(rects)


TEMPLATES = {
    "单图 1": _cells((0.0, 0.0, 1.0, 1.0)),
    "横排 2": _row(2),
    "竖排 2": _col(2),
    "横排 3": _row(3),
    "竖排 3": _col(3),
    "1大2小 3": _cells((0, 0, 0.5, 1), (0.5, 0, 0.5, 0.5), (0.5, 0.5, 0.5, 0.5)),
    "田字 4": _grid(2, 2),
    "横排 4": _row(4),
    "1大3小 4": _cells((0, 0, 0.5, 1), (0.5, 0, 0.5, 1 / 3), (0.5, 1 / 3, 0.5, 1 / 3), (0.5, 2 / 3, 0.5, 1 / 3)),
    "横排 5": _row(5),
    "2×3 6": _grid(2, 3),
    "3×2 6": _grid(3, 2),
    "横排 6": _row(6),
    "横排 7": _row(7),
    "2×4 8": _grid(2, 4),
    "横排 8": _row(8),
    "3×3 9": _grid(3, 3),
    "横排 9": _row(9),
}

DEFAULT_KEY = "3×3 9"


def templates_for_count(n: int) -> list[str]:
    """返回指定格数的模板名列表"""
    return [k for k, v in TEMPLATES.items() if len(v) == n]
