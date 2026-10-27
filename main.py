"""PicSnap 快捷拼图 — 程序入口"""
import sys

from PySide6.QtWidgets import QApplication

from app.main_window import MainWindow


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("PicSnap 快捷拼图")
    win = MainWindow()
    win.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
