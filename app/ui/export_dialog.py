"""导出对话框：尺寸、格式、质量、导出/复制"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QMessageBox,
    QPushButton,
    QSlider,
    QSpinBox,
    QVBoxLayout,
)

from app.core import exporter, renderer
from app.models import Group

PRESETS = [
    ("1080×1080（正方形）", 1080, 1080, 1.0),
    ("1080×1440（3:4 竖版）", 1080, 1440, 3 / 4),
    ("1440×1080（4:3 横版）", 1440, 1080, 4 / 3),
    ("自定义…", 0, 0, 1.0),
]


class ExportDialog(QDialog):
    def __init__(self, group: Group, parent=None, initial_size: tuple[int, int] | None = None) -> None:
        super().__init__(parent)
        self.group = group
        self.setWindowTitle("导出成品图")
        self.setMinimumWidth(380)
        self._build()
        if initial_size:
            self._apply_initial(initial_size)

    def _build(self) -> None:
        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.size_combo = QComboBox()
        for name, *_ in PRESETS:
            self.size_combo.addItem(name)
        self.size_combo.currentIndexChanged.connect(self._on_size_changed)
        form.addRow("尺寸", self.size_combo)

        self.w_spin = QSpinBox()
        self.w_spin.setRange(100, 8000)
        self.w_spin.setValue(1080)
        self.w_spin.setEnabled(False)
        self.h_spin = QSpinBox()
        self.h_spin.setRange(100, 8000)
        self.h_spin.setValue(1080)
        self.h_spin.setEnabled(False)
        wh = QHBoxLayout()
        wh.addWidget(QLabel("宽"))
        wh.addWidget(self.w_spin)
        wh.addWidget(QLabel("高"))
        wh.addWidget(self.h_spin)
        form.addRow("自定义尺寸", wh)

        self.native_check = QCheckBox("原图质量（不压缩画质）")
        form.addRow("", self.native_check)

        self.fmt_combo = QComboBox()
        self.fmt_combo.addItems(["PNG", "JPG"])
        self.fmt_combo.currentTextChanged.connect(self._on_fmt_changed)
        form.addRow("格式", self.fmt_combo)

        self.quality_slider = QSlider(Qt.Horizontal)
        self.quality_slider.setRange(1, 100)
        self.quality_slider.setValue(95)
        self.quality_slider.setEnabled(False)
        self.quality_label = QLabel("95")
        self.quality_slider.valueChanged.connect(lambda v: self.quality_label.setText(str(v)))
        qh = QHBoxLayout()
        qh.addWidget(self.quality_slider)
        qh.addWidget(self.quality_label)
        form.addRow("JPG 质量", qh)

        layout.addLayout(form)

        btns = QHBoxLayout()
        self.save_btn = QPushButton("导出图片…")
        self.save_btn.clicked.connect(self._save)
        self.copy_btn = QPushButton("复制到剪贴板")
        self.copy_btn.clicked.connect(self._copy)
        cancel = QPushButton("取消")
        cancel.clicked.connect(self.reject)
        btns.addWidget(self.save_btn)
        btns.addWidget(self.copy_btn)
        btns.addWidget(cancel)
        layout.addLayout(btns)

    def _apply_initial(self, size: tuple[int, int]) -> None:
        w, h = size
        for idx, (_, pw, ph, _) in enumerate(PRESETS):
            if pw == w and ph == h:
                self.size_combo.setCurrentIndex(idx)
                return
        self.size_combo.setCurrentIndex(3)
        self.w_spin.setValue(w)
        self.h_spin.setValue(h)

    def _on_size_changed(self, idx: int) -> None:
        custom = idx == 3
        self.w_spin.setEnabled(custom)
        self.h_spin.setEnabled(custom)

    def _on_fmt_changed(self, text: str) -> None:
        self.quality_slider.setEnabled(text == "JPG")

    def _size(self) -> tuple[int, int]:
        idx = self.size_combo.currentIndex()
        if idx == 3:
            return self.w_spin.value(), self.h_spin.value()
        return PRESETS[idx][1], PRESETS[idx][2]

    def _render(self):
        idx = self.size_combo.currentIndex()
        if self.native_check.isChecked():
            aspect = PRESETS[idx][3] if idx != 3 else self.w_spin.value() / self.h_spin.value()
            w, h = renderer.compute_native_size(self.group, aspect)
        else:
            w, h = self._size()
        return renderer.render_group(self.group, w, h)

    def _save(self) -> None:
        img = self._render()
        fmt = self.fmt_combo.currentText()
        ext = "jpg" if fmt == "JPG" else "png"
        path, _ = QFileDialog.getSaveFileName(self, "导出图片", f"拼图.{ext}", f"*.{ext}")
        if not path:
            return
        exporter.save_image(img, path, fmt, self.quality_slider.value())
        self.accept()

    def _copy(self) -> None:
        img = self._render()
        exporter.copy_to_clipboard(img)
        QMessageBox.information(self, "完成", "已复制到剪贴板，可直接粘贴到微信等。")
