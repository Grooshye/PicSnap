"""打包脚本：生成单文件 exe（阶段 7 使用）"""
import subprocess
import sys

CMD = [
    sys.executable, "-m", "PyInstaller",
    "--onefile", "--windowed", "--name", "PicSnap",
    "--noconfirm",
    "main.py",
]


if __name__ == "__main__":
    raise SystemExit(subprocess.call(CMD))
