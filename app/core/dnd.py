"""拖拽数据传递：通过全局注册表传递 Python 对象引用"""
from __future__ import annotations

from PySide6.QtCore import QMimeData

MIME_IMAGE = "application/x-picsnap-image"
MIME_IMAGES = "application/x-picsnap-images"
MIME_SOURCE = "application/x-picsnap-source"

_registry: dict[int, object] = {}
_next_id = 1


def _set_source(mime: QMimeData, source: str) -> None:
    mime.setData(MIME_SOURCE, source.encode("ascii"))


def source_from_mime(mime: QMimeData) -> str:
    """返回拖拽来源：'library' | 'group'（默认 group）"""
    if mime.hasFormat(MIME_SOURCE):
        return bytes(mime.data(MIME_SOURCE)).decode("ascii")
    return "group"


def _register(obj) -> int:
    global _next_id
    oid = _next_id
    _next_id += 1
    _registry[oid] = obj
    return oid


def image_mime(obj, source: str = "group") -> QMimeData:
    """把单个 Python 对象（ImageData）封装成拖拽用的 mime 数据"""
    mime = QMimeData()
    mime.setData(MIME_IMAGE, str(_register(obj)).encode("ascii"))
    _set_source(mime, source)
    return mime


def image_from_mime(mime: QMimeData):
    """从 mime 数据取回拖拽的单个对象"""
    if not mime.hasFormat(MIME_IMAGE):
        return None
    oid = int(bytes(mime.data(MIME_IMAGE)).decode("ascii"))
    return _registry.get(oid)


def images_mime(objs: list, source: str = "group") -> QMimeData:
    """把多个对象封装成拖拽数据"""
    mime = QMimeData()
    ids = [str(_register(o)) for o in objs]
    mime.setData(MIME_IMAGES, ",".join(ids).encode("ascii"))
    _set_source(mime, source)
    return mime


def images_from_mime(mime: QMimeData) -> list:
    """从 mime 数据取回拖拽的一个或多个对象（兼容单选格式）"""
    if mime.hasFormat(MIME_IMAGES):
        ids = bytes(mime.data(MIME_IMAGES)).decode("ascii").split(",")
        return [o for o in (_registry.get(int(i)) for i in ids if i) if o is not None]
    single = image_from_mime(mime)
    return [single] if single is not None else []
