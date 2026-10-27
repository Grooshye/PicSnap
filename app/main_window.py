"""主窗口：橙白主题 + 工具条 + 左侧图库 + 分组 + 中央拼图画布"""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QComboBox,
    QDockWidget,
    QFileDialog,
    QLabel,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QSpinBox,
    QToolBar,
)

from app.core import importer, settings
from app.core.templates import TEMPLATES, templates_for_count
from app.theme import QSS
from app.ui.canvas import CollageCanvas
from app.ui.export_dialog import ExportDialog, PRESETS
from app.ui.groups_panel import GroupsPanel
from app.ui.library_panel import LibraryPanel


class MainWindow(QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("PicSnap 快捷拼图")
        self.resize(1200, 800)
        self.setAcceptDrops(True)
        self._build_toolbar()
        self._build_library()
        self._build_central()
        self._build_groups()
        self._build_shortcuts()
        self.setStyleSheet(QSS)

    def _build_toolbar(self) -> None:
        bar = QToolBar("主工具条")
        bar.setMovable(False)
        self.addToolBar(bar)
        self.btn_import = QPushButton("导入图片")
        self.btn_export = QPushButton("导出 / 复制")
        self.btn_import.clicked.connect(self._import_files_dialog)
        self.btn_export.clicked.connect(self._export)

        self.count_combo = QComboBox()
        for n in range(1, 10):
            self.count_combo.addItem(str(n))
        self.count_combo.addItem("随意")
        self.count_combo.currentIndexChanged.connect(self._on_count_changed)
        self.template_combo = QComboBox()
        self.template_combo.currentTextChanged.connect(self._apply_template)

        self.size_combo = QComboBox()
        for name, *_ in PRESETS:
            self.size_combo.addItem(name)
        self.size_combo.addItem("自由模式")
        self.size_combo.currentIndexChanged.connect(self._on_size_changed)
        self.w_spin = QSpinBox()
        self.w_spin.setRange(100, 8000)
        self.w_spin.setValue(1080)
        self.w_spin.setVisible(False)
        self.h_spin = QSpinBox()
        self.h_spin.setRange(100, 8000)
        self.h_spin.setValue(1440)
        self.h_spin.setVisible(False)
        self.w_spin.valueChanged.connect(self._on_custom_size_changed)
        self.h_spin.valueChanged.connect(self._on_custom_size_changed)

        self.dup_btn = QPushButton("允许重复")
        self.dup_btn.setObjectName("GhostBtn")
        self.dup_btn.setCheckable(True)
        self.dup_btn.setToolTip("开启后同一张图片可重复放到多个格/分组，不再询问")
        self.dup_btn.toggled.connect(self._on_dup_toggled)

        self.gap_btn = QPushButton("无框线")
        self.gap_btn.setObjectName("GhostBtn")
        self.gap_btn.setCheckable(True)
        self.gap_btn.setToolTip("勾选后图片无缝拼贴，不保留白色缝隙")
        self.gap_btn.toggled.connect(self._on_gap_toggled)

        bar.addWidget(self.btn_import)
        bar.addWidget(QLabel(" 张数: "))
        bar.addWidget(self.count_combo)
        bar.addWidget(QLabel(" 模板: "))
        bar.addWidget(self.template_combo)
        bar.addWidget(QLabel(" 尺寸: "))
        bar.addWidget(self.size_combo)
        bar.addWidget(QLabel(" 宽"))
        bar.addWidget(self.w_spin)
        bar.addWidget(QLabel(" 高"))
        bar.addWidget(self.h_spin)
        bar.addWidget(self.dup_btn)
        bar.addWidget(self.gap_btn)
        bar.addWidget(self.btn_export)

    def _build_library(self) -> None:
        self.library = LibraryPanel()
        self.library.files_dropped.connect(self._import_paths)
        dock = QDockWidget("图片库", self)
        dock.setObjectName("LibraryDock")
        dock.setWidget(self.library)
        dock.setFeatures(QDockWidget.DockWidgetMovable | QDockWidget.DockWidgetFloatable)
        self.addDockWidget(Qt.LeftDockWidgetArea, dock)
        self.library_dock = dock

    def _build_central(self) -> None:
        self.canvas = CollageCanvas()
        self.canvas.group_modified.connect(self._on_group_modified)
        self.setCentralWidget(self.canvas)

    def _build_groups(self) -> None:
        self.groups = GroupsPanel()
        self.groups.active_changed.connect(self._refresh_canvas)
        self.groups.groups_changed.connect(self._refresh_canvas)
        dock = QDockWidget("分组", self)
        dock.setObjectName("GroupsDock")
        dock.setWidget(self.groups)
        dock.setFeatures(QDockWidget.DockWidgetMovable | QDockWidget.DockWidgetFloatable)
        self.addDockWidget(Qt.BottomDockWidgetArea, dock)
        self.groups_dock = dock
        self.groups.return_images.connect(self.library.add_images)
        self.groups.delete_images.connect(self.library.remove_images)
        self.library.images_deleted.connect(self.groups.remove_images_from_all)
        self.library.groups = self.groups
        self.groups.groups_changed.connect(self.library.refresh_badges)
        self.canvas.groups = self.groups
        self.groups.add_group()

    def _build_shortcuts(self) -> None:
        QShortcut(QKeySequence("Ctrl+V"), self, activated=self._import_clipboard)

    # ---- 画布 / 模板 ----
    def _refresh_canvas(self, _group=None) -> None:
        g = self.groups.active_group
        self.canvas.set_group(g)
        self._refresh_template_combos()

    def _refresh_template_combos(self) -> None:
        g = self.groups.active_group
        n = len(g.layout) if (g is not None and g.layout) else 9
        self.count_combo.blockSignals(True)
        if 1 <= n <= 9:
            self.count_combo.setCurrentIndex(self.count_combo.findText(str(n)))
        else:
            self.count_combo.setCurrentIndex(self.count_combo.findText("随意"))
        self.count_combo.blockSignals(False)
        self._fill_template_combo(apply=False)

    def _on_count_changed(self, _idx=None) -> None:
        self._fill_template_combo(apply=True)

    def _fill_template_combo(self, apply: bool = False) -> None:
        mode = self.count_combo.currentText()
        g = self.groups.active_group
        keys = list(TEMPLATES.keys()) if mode == "随意" else templates_for_count(int(mode))
        self.template_combo.blockSignals(True)
        self.template_combo.clear()
        self.template_combo.addItems(keys)
        if not apply and g is not None and g.template_name in keys:
            self.template_combo.setCurrentText(g.template_name)
        else:
            self.template_combo.setCurrentIndex(0)
        self.template_combo.blockSignals(False)
        if apply:
            self._apply_template(self.template_combo.currentText())

    def _apply_template(self, name: str) -> None:
        g = self.groups.active_group
        if g is None or name not in TEMPLATES:
            return
        g.template_name = name
        g.layout = list(TEMPLATES[name])
        self.canvas.set_group(g)

    def _on_group_modified(self, group) -> None:
        self.groups.refresh_group(group)

    # ---- 导出 ----
    def _on_dup_toggled(self, on: bool) -> None:
        if hasattr(self, "groups"):
            self.groups.allow_duplicate = on

    def _on_gap_toggled(self, on: bool) -> None:
        settings.gap_enabled = not on
        if hasattr(self, "canvas"):
            self.canvas.scene().update()

    def _on_custom_size_changed(self, _value=None) -> None:
        if not hasattr(self, "canvas"):
            return
        if self.size_combo.currentIndex() == 3:
            self.canvas.set_art_size(self.w_spin.value(), self.h_spin.value())

    def _on_size_changed(self, idx: int) -> None:
        if not hasattr(self, "canvas"):
            return
        if idx == 4:  # 自由模式
            self.w_spin.setVisible(False)
            self.h_spin.setVisible(False)
            self.canvas.set_free_mode(True)
            return
        self.canvas.set_free_mode(False)
        custom = idx == 3
        self.w_spin.setVisible(custom)
        self.h_spin.setVisible(custom)
        if custom:
            self.canvas.set_art_size(self.w_spin.value(), self.h_spin.value())
        else:
            self.canvas.set_art_size(PRESETS[idx][1], PRESETS[idx][2])

    def _current_export_size(self) -> tuple[int, int]:
        idx = self.size_combo.currentIndex()
        if idx == 4:
            return int(self.canvas.art_w), int(self.canvas.art_h)
        if idx == 3:
            return self.w_spin.value(), self.h_spin.value()
        return PRESETS[idx][1], PRESETS[idx][2]

    def _export(self) -> None:
        g = self.groups.active_group
        if g is None or not g.images():
            QMessageBox.warning(self, "提示", "当前分组还没有图片，请先把图片拖入分组。")
            return
        ExportDialog(g, self, initial_size=self._current_export_size()).exec()

    # ---- 导入 ----
    def _import_files_dialog(self) -> None:
        paths, _ = QFileDialog.getOpenFileNames(
            self,
            "选择图片",
            "",
            "图片文件 (*.jpg *.jpeg *.png *.bmp *.webp *.gif *.tif *.tiff);;所有文件 (*)",
        )
        if paths:
            self._import_paths(paths)

    def _import_paths(self, paths: list[str]) -> None:
        images = importer.load_from_paths(paths)
        if images:
            self.library.add_images(images)

    def _import_clipboard(self) -> None:
        img = importer.load_image_from_clipboard()
        if img is not None:
            self.library.add_images([img])
            return
        paths = importer.clipboard_paths()
        if paths:
            self._import_paths(paths)

    # ---- 拖拽文件进窗口 ----
    def dragEnterEvent(self, event) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()

    def dropEvent(self, event) -> None:
        paths = [u.toLocalFile() for u in event.mimeData().urls() if u.isLocalFile()]
        if paths:
            self._import_paths(paths)
        event.acceptProposedAction()
