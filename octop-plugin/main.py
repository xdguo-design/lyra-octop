"""星球乐园入口插件：让 Octop 专家能一键打开本机的工作台服务。

- Octop 启动时（setup）后台自动确保 8130 服务运行（无 LLM 也能拉起）。
- 工具 open_planet()：健康检查 → 未运行则拉起 → 返回带 octop_ui 信封的
  JSON，由 Dashboard 插件卡片内嵌 iframe 展示（不弹新页面）。
仅用标准库，不给 Octop 运行环境引入额外依赖。
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

PLANET_DIR = os.environ.get("LYRA_PLANET_DIR") or r"D:\WorkSpace\lyra-planet"
PLANET_URL = os.environ.get("LYRA_PLANET_URL") or "http://127.0.0.1:8130/"
HEALTH_URL = PLANET_URL + "api/health"
LOG_PATH = os.path.join(PLANET_DIR, "data", "octop-launch.log")

_DETACHED = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP

# 后端依赖（fastapi/uvicorn/edge-tts）装在系统 Python（D:\Python\Python312），
# 不在 Octop 自身 venv、也不在 uv 托管 Python 里，因此不能依赖 PATH 里
# 第一个叫 python 的解释器；逐个探测「能 import uvicorn」再用。
_PY_CANDIDATES = [
    os.environ.get("LYRA_PLANET_PYTHON"),
    r"D:\Python\Python312\python.exe",   # 本机已知可用，放最前
    "python3",                           # Linux/容器
    "python",                            # PATH 兜底（可能是 uv 托管 Python，探测不过会跳过）
    "py",                                # Windows py 启动器
]


def _health(timeout: float = 2.0) -> bool:
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def _py_works(py: str) -> bool:
    """该解释器必须能 import uvicorn 才有资格拉起服务。"""
    try:
        r = subprocess.run(
            [py, "-c", "import uvicorn"],
            capture_output=True, timeout=30,
        )
        return r.returncode == 0
    except Exception:
        return False


def _start_service() -> None:
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    log = open(LOG_PATH, "ab")
    for py in _PY_CANDIDATES:
        if not py or not _py_works(py):
            continue
        cmd = [py, "-m", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8130"]
        if sys.platform == "win32":
            subprocess.Popen(cmd, cwd=PLANET_DIR, stdout=log, stderr=log,
                             creationflags=_DETACHED)
        else:
            subprocess.Popen(cmd, cwd=PLANET_DIR, stdout=log, stderr=log,
                             start_new_session=True)
        return
    raise RuntimeError("星球乐园服务拉起失败：找不到装有 uvicorn 的 Python")


async def open_planet() -> str:
    """确保星球乐园服务运行，返回供 Dashboard 内嵌卡片使用的数据。"""
    started = False
    if not _health():
        _start_service()
        started = True
        for _ in range(20):          # 最多等 10 秒
            if _health():
                break
            time.sleep(0.5)
    ok = _health()
    payload = {
        "octop_ui": {"renderer": "planet_embed", "version": 1},
        "data": {
            "ok": ok,
            "service_started": started,
            "url": PLANET_URL,
            "title": "星球乐园",
            "note": "" if ok else "服务启动失败，请查看日志 " + LOG_PATH,
        },
        "text": ("✅ 星球乐园已就绪，已在内嵌卡片打开：" + PLANET_URL) if ok
        else "❌ 星球乐园服务启动失败，请查看日志 " + LOG_PATH,
    }
    return json.dumps(payload, ensure_ascii=False)


def setup(ctx) -> None:
    # Octop 每次启动都自动确保星球乐园在运行（后台线程，不阻塞壳启动）
    threading.Thread(target=_boot_ensure, name="planet-boot", daemon=True).start()
    ctx.tool(
        "open_planet",
        open_planet,
        description="打开星球乐园儿童学习工作台（本地 8130 服务，按需自动拉起，在 Octop 页面内嵌打开，不弹新窗口）",
    )


def _boot_ensure() -> None:
    try:
        if _health():
            return
        _start_service()
        for _ in range(20):
            if _health():
                return
            time.sleep(0.5)
    except Exception as e:
        try:
            os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
            with open(LOG_PATH, "ab") as log:
                log.write(f"[boot] 星球乐园随壳拉起失败: {e}\n".encode("utf-8"))
        except Exception:
            pass
