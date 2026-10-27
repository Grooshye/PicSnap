"""橙白配色主题 —— 全局样式唯一来源，其他文件禁止硬编码颜色"""

ORANGE = "#FF8C1A"
ORANGE_HOVER = "#FF9E40"
ORANGE_DARK = "#E67600"
DANGER = "#E5484D"
DANGER_HOVER = "#F0565B"
BG = "#FFFFFF"
BG_SOFT = "#FFF6EE"
PANEL_BG = "#FFFDF9"
BORDER = "#F0E0D0"
TEXT = "#333333"
TEXT_LIGHT = "#8A7A6B"

QSS = f"""
* {{
    font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif;
    font-size: 13px;
    color: {TEXT};
}}
QMainWindow {{
    background-color: {PANEL_BG};
}}
QToolBar {{
    background-color: {BG};
    border: none;
    border-bottom: 1px solid {BORDER};
    spacing: 8px;
    padding: 6px 10px;
}}
QPushButton {{
    background-color: {ORANGE};
    color: #FFFFFF;
    border: none;
    border-radius: 6px;
    padding: 8px 18px;
    font-weight: 600;
}}
QPushButton:hover {{
    background-color: {ORANGE_HOVER};
}}
QPushButton:pressed {{
    background-color: {ORANGE_DARK};
}}
QPushButton#DangerBtn {{
    background-color: {DANGER};
    color: #FFFFFF;
    border: none;
    border-radius: 6px;
    padding: 6px 14px;
    font-weight: 600;
}}
QPushButton#DangerBtn:hover {{
    background-color: {DANGER_HOVER};
}}
QPushButton#CloseBtn {{
    background-color: {DANGER};
    color: #FFFFFF;
    border: none;
    border-radius: 14px;
    font-size: 16px;
    font-weight: 700;
    padding: 0px;
}}
QPushButton#CloseBtn:hover {{
    background-color: {DANGER_HOVER};
}}
QPushButton#GhostBtn {{
    background-color: transparent;
    color: {ORANGE};
    border: 1px solid {ORANGE};
    border-radius: 6px;
    padding: 5px 12px;
    font-weight: 600;
}}
QPushButton#GhostBtn:hover {{
    background-color: {BG_SOFT};
}}
QPushButton#GhostBtn:checked {{
    background-color: {ORANGE};
    color: #FFFFFF;
}}
QLabel#CountLabel {{
    color: {TEXT_LIGHT};
}}
QLabel#Placeholder {{
    color: {TEXT_LIGHT};
    font-size: 16px;
}}
QDockWidget::title {{
    background: {BG_SOFT};
    padding: 6px 10px;
    border-bottom: 1px solid {BORDER};
    font-weight: 600;
}}
QListWidget {{
    background: transparent;
    border: none;
}}
QListWidget::item {{
    border-radius: 6px;
}}
QListWidget::item:selected {{
    background: {BG_SOFT};
    border: 2px solid {ORANGE};
}}
QLineEdit {{
    border: 1px solid {BORDER};
    border-radius: 4px;
    padding: 4px 8px;
    background-color: {BG};
}}
QLineEdit:focus {{
    border-color: {ORANGE};
}}
QWidget#GroupBox {{
    background-color: {BG};
    border: 1px solid {BORDER};
    border-radius: 8px;
}}
QWidget#GroupBox[active="true"] {{
    border: 2px solid {ORANGE};
}}
QSplitter::handle {{
    background: {BORDER};
    width: 4px;
}}
QScrollBar:vertical {{
    background: #F3EBE2;
    width: 12px;
    border-radius: 6px;
}}
QScrollBar::handle:vertical {{
    background: {ORANGE};
    border-radius: 6px;
    min-height: 30px;
}}
QScrollBar::handle:vertical:hover {{
    background: {ORANGE_HOVER};
}}
QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
    height: 0px;
    background: none;
}}
QScrollBar::add-page:vertical, QScrollBar::sub-page:vertical {{
    background: transparent;
}}
QScrollBar:horizontal {{
    background: #F3EBE2;
    height: 12px;
    border-radius: 6px;
}}
QScrollBar::handle:horizontal {{
    background: {ORANGE};
    border-radius: 6px;
    min-width: 30px;
}}
QScrollBar::handle:horizontal:hover {{
    background: {ORANGE_HOVER};
}}
QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {{
    width: 0px;
    background: none;
}}
QScrollBar::add-page:horizontal, QScrollBar::sub-page:horizontal {{
    background: transparent;
}}
"""
