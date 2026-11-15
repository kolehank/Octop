"""统一脚本契约：--spec <json> --out <path>，stdout 输出 JSON 结果。

成功时 stdout：

    {"ok": true, "path": "...", "bytes": 48213, "summary": "..."}

失败时 stdout（reason 说明失败类别，detail 给可操作的说明）：

    {"ok": false, "reason": "error|exists|source-missing|libreoffice-missing|soffice-failed",
     "detail": "..."}

约定：
- 已处理的业务失败（如缺 LibreOffice）exit code 0，靠 reason 区分，方便 Agent 直接读 JSON；
- 编程/参数错误 exit code 1；
- 生成类脚本默认不覆盖已有输出文件（保护用户原文件），除非 spec 里带 "overwrite": true
  或设置环境变量 OCTOP_OFFICE_OVERWRITE=1。

本模块不依赖任何第三方库，生成脚本 import 后即可用。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def build_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--spec", required=True, help="JSON spec 文件路径")
    parser.add_argument("--out", required=True, help="输出文件路径")
    return parser


def load_spec(spec_path: str) -> dict:
    """读取并校验 spec JSON 文件。"""
    path = Path(spec_path)
    if not path.is_file():
        raise ValueError(f"spec 文件不存在: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"spec 不是合法 JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError("spec 顶层必须是 JSON 对象")
    return data


def resolve_out(out_path: str) -> Path:
    """展开用户目录并创建输出目录。"""
    out = Path(os.path.expanduser(out_path))
    out.parent.mkdir(parents=True, exist_ok=True)
    return out


def resolve_source(path_value: str, spec_file: Path) -> Path:
    """解析输入文件路径：先按原样（相对 CWD），失败再按 spec 文件所在目录。"""
    raw = Path(os.path.expanduser(path_value))
    if raw.is_file():
        return raw
    relative = spec_file.parent / raw
    if relative.is_file():
        return relative
    return raw  # 存在性由调用方校验并给出明确报错


def verify_output(path: Path) -> str:
    """校验输出文件存在且非空，返回描述片段；失败抛异常。"""
    if not path.is_file():
        raise FileNotFoundError(f"输出文件未生成: {path}")
    size = path.stat().st_size
    if size <= 0:
        raise ValueError(f"输出文件为空: {path}")
    return f"{size} 字节"


def emit(result: dict, *, exit_code: int = 0) -> None:
    """打印 JSON 结果并退出（不保证返回）。"""
    # Windows 控制台默认 cp1252，经 TextIOWrapper 打印中文会 UnicodeEncodeError
    # （或被外层捕获进程读到空输出）——直接写 UTF-8 字节，绕开编码层。
    sys.stdout.buffer.write((json.dumps(result, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()
    sys.exit(exit_code)


def emit_fail(reason: str, detail: str, *, exit_code: int = 0) -> None:
    emit({"ok": False, "reason": reason, "detail": detail}, exit_code=exit_code)


def _guard_no_overwrite(out: Path, spec: dict) -> None:
    if not out.exists():
        return
    if spec.get("overwrite") is True:
        return
    if os.environ.get("OCTOP_OFFICE_OVERWRITE") == "1":
        return
    emit_fail(
        "exists",
        f"输出文件已存在，为避免覆盖原文件未写入：{out}。"
        '请在 spec 里设置 "overwrite": true，或设置环境变量 OCTOP_OFFICE_OVERWRITE=1，'
        "或改用带时间戳的新输出路径。",
        exit_code=1,
    )


def run_cli(generator, description: str, *, no_overwrite: bool = True) -> None:
    """生成类脚本的统一入口。

    generator(spec: dict, out: Path, spec_file: Path) -> str（摘要，含所有警告）。
    返回前应已把文件写入 out；run_cli 最后统一做存在性/非空校验并输出 JSON。
    no_overwrite=False 时（如 read_office 的 markdown 草稿）允许直接覆盖输出。
    """
    args = build_parser(description).parse_args()
    spec_file = Path(args.spec)
    try:
        spec = load_spec(args.spec)
        out = resolve_out(args.out)
        if no_overwrite:
            _guard_no_overwrite(out, spec)
        summary = generator(spec, out, spec_file)
        size_text = verify_output(out)
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 —— 统一转换为 JSON 错误契约
        emit_fail("error", str(exc), exit_code=1)
    emit(
        {
            "ok": True,
            "path": str(out),
            "bytes": out.stat().st_size,
            "summary": f"{summary}；{size_text}",
        }
    )
