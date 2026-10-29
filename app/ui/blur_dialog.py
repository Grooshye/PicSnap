"""模糊处理对话框：高斯模糊 / 马赛克，改动实时预览"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QButtonGroup,
    QDialog,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QSlider,
    QVBoxLayout,
)

from app.theme import TEXT_LIGHT

MODES = [("none", "不处理"), ("blur", "高斯模糊"), ("mosaic", "马赛克")]


class BlurDialog(QDialog):
    """改变参数时通过 on_change 回调让画布即时重绘"""

    def __init__(self, cell, on_change, parent=None) -> None:
        super().__init__(parent)
        self.cell = cell
        self.on_change = on_change
        self._before = (cell.blur_mode, cell.blur_amount)
        self.setWindowTitle("模糊处理")
        self.setMinimumWidth(360)
        self._build()
        self._sync()

    def _build(self) -> None:
        layout = QVBoxLayout(self)
        layout.setSpacing(10)

        # 方式：三个互斥按钮
        row = QHBoxLayout()
        row.addWidget(QLabel("方式"))
        self.group = QButtonGroup(self)
        self.group.setExclusive(True)
        for i, (key, label) in enumerate(MODES):
            btn = QPushButton(label)
            btn.setObjectName("GhostBtn")
            btn.setCheckable(True)
            btn.setProperty("mode", key)
            self.group.addButton(btn, i)
            row.addWidget(btn)
        self.group.idClicked.connect(self._on_mode)
        layout.addLayout(row)

        # 强度
        srow = QHBoxLayout()
        srow.addWidget(QLabel("强度"))
        self.slider = QSlider(Qt.Horizontal)
        self.slider.setRange(1, 100)
        self.slider.valueChanged.connect(self._on_amount)
        self.value_label = QLabel()
        self.value_label.setMinimumWidth(28)
        self.value_label.setAlignment(Qt.AlignRight | Qt.AlignVCenter)
        srow.addWidget(self.slider)
        srow.addWidget(self.value_label)
        layout.addLayout(srow)

        tip = QLabel(
            "提示：模糊只作用于当前这一格，导出成品时同样生效。\n"
            "想只遮住一小块，可以先把图放大到那一块再加大模糊。"
        )
        tip.setWordWrap(True)
        tip.setStyleSheet(f"color: {TEXT_LIGHT}; font-size: 12px;")
        layout.addWidget(tip)

        # 底部按钮
        btns = QHBoxLayout()
        btns.addStretch(1)
        cancel = QPushButton("取消")
        cancel.setObjectName("GhostBtn")
        cancel.clicked.connect(self._cancel)
        ok = QPushButton("完成")
        ok.clicked.connect(self.accept)
        btns.addWidget(cancel)
        btns.addWidget(ok)
        layout.addLayout(btns)

    def _on_mode(self, idx: int) -> None:
        self.cell.blur_mode = MODES[idx][0]
        self._sync()
        self.on_change()

    def _on_amount(self, v: int) -> None:
        self.cell.blur_amount = v
        self.value_label.setText(str(v))
        # 拖动强度时自动切到高斯模糊（和网页版一致）
        if self.cell.blur_mode == "none":
            self.cell.blur_mode = "blur"
            self._sync()
        self.on_change()

    def _sync(self) -> None:
        mode = self.cell.blur_mode
        for btn in self.group.buttons():
            btn.setChecked(btn.property("mode") == mode)
        self.slider.setValue(self.cell.blur_amount or 30)
        self.value_label.setText(str(self.slider.value()))
        self.slider.setEnabled(mode != "none")

    def _cancel(self) -> None:
        self.cell.blur_mode, self.cell.blur_amount = self._before
        self.on_change()
        self.reject()

    def done(self, r: int) -> None:
        # 右上角 × 等同于取消
        if r != QDialog.Accepted:
            self.cell.blur_mode, self.cell.blur_amount = self._before
            self.on_change()
        super().done(r)
