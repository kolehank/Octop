"""convert_pdf.py —— 用 LibreOffice 把 Office 文档转成 PDF。

用法：
    uv run python convert_pdf.py --spec convert.json --out output/report.pdf

--spec 内容：
    {
      "source": "path/to/report.docx",   # 必需
      "timeout": 180                     # 可选；转换超时秒数
    }

行为约定（不许伪造成功）：
- 探测到 soffice / libreoffice 时执行转换，成功输出 ok:true；
- 未安装 LibreOffice 时输出 {"ok": false, "reason": "libreoffice-missing", ...}，
  要求如实告知用户，绝不伪造成功。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from _office_io import (
    build_parser,
    emit,
    emit_fail,
    load_spec,
    resolve_out,
    resolve_source,
)

_SOFFICE_NAMES = ("soffice", "libreoffice", "soffice.bin")
_SOFFICE_PATHS = (
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
)
_SOFFICE_GLOB_PATTERNS = (
    "/opt/libreoffice*/program/soffice",
    "/usr/lib/libreoffice/program/soffice",
)


def _find_soffice() -> str | None:
    for name in _SOFFICE_NAMES:
        found = shutil.which(name)
        if found:
            return found
    import glob

    for pattern in _SOFFICE_GLOB_PATTERNS:
        matches = glob.glob(pattern)
        if matches:
            return matches[0]
    for candidate in _SOFFICE_PATHS:
        if os.path.isfile(candidate):
            return candidate
    return None


def _convert(soffice: str, src: Path, out: Path, timeout: int) -> None:
    # 独立 profile，避免与正在运行的 LibreOffice 实例争用锁
    profile = Path(tempfile.mkdtemp(prefix="octop_lo_profile_"))
    env = {**os.environ, "HOME": str(profile)}
    cmd = [
        soffice,
        "--headless",
        "--norestore",
        "--convert-to",
        "pdf",
        "--outdir",
        str(out.parent),
        str(src),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
    pdf = out.parent / (src.stem + ".pdf")
    if pdf.is_file() and pdf.resolve() != out.resolve():
        shutil.move(str(pdf), str(out))
    if not out.is_file():
        detail = proc.stdout.strip()[-500:] or proc.stderr.strip()[-500:] or "无输出"
        raise RuntimeError(f"LibreOffice 未生成 PDF：{detail}")


def main() -> None:
    args = build_parser("把 Office 文档转为 PDF（依赖 LibreOffice）").parse_args()
    try:
        spec = load_spec(args.spec)
        out = resolve_out(args.out)
        src = resolve_source(str(spec.get("source") or ""), Path(args.spec))
        if not src.is_file():
            emit_fail("source-missing", f"输入文件不存在: {src}", exit_code=1)
        timeout = int(spec.get("timeout") or 180)
        soffice = _find_soffice()
        if soffice is None:
            emit_fail(
                "libreoffice-missing",
                "未检测到 soffice / libreoffice，无法导出 PDF。"
                "请先安装 LibreOffice（https://www.libreoffice.org/），"
                "或改用 read_office.py 输出 markdown 交付。",
                exit_code=0,
            )
        _convert(soffice, src, out, timeout)
        size = out.stat().st_size
        if size <= 0:
            raise RuntimeError("生成的 PDF 为空文件")
        emit(
            {
                "ok": True,
                "path": str(out),
                "bytes": size,
                "summary": f"pdf，{size} 字节，由 LibreOffice 转换（{os.path.basename(soffice)}）",
            }
        )
    except SystemExit:
        raise
    except subprocess.TimeoutExpired:
        emit_fail("soffice-timeout", f"LibreOffice 转换超时（>{timeout} 秒）", exit_code=1)
    except Exception as exc:  # noqa: BLE001 —— 统一转换为 JSON 错误契约
        emit_fail("soffice-failed", str(exc), exit_code=1)


if __name__ == "__main__":
    main()
