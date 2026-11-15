"""read_office.py —— 读取 docx / xlsx / pptx 并输出 markdown。

用途：生成后“重新打开校验”，以及“改已有文档”闭环的第一步
（先读回 → 改 spec → 重新生成到新路径）。

用法：
    uv run python read_office.py --spec read.json --out output/report.md

--spec 内容：
    {
      "source": "path/to/file.docx",       # 必需；相对脚本 CWD 或 spec 同目录
      "format": "docx|xlsx|pptx",          # 可选；缺省按扩展名推断
      "max_rows": 200,                     # 可选；xlsx 每个 sheet 最多输出的行数
      "data_only": false                   # 可选；xlsx 取公式缓存值（true 用 data_only 读）
    }

输出：
    docx → 标题/段落/有序无序列表/表格的 markdown
    xlsx → 每个 sheet 一张 markdown 表格，大表截断并提示
    pptx → 每页文字 + 备注
"""

from __future__ import annotations

import re
from pathlib import Path

from _office_io import resolve_source, run_cli

_HEADING_RE = re.compile(r"^(?:Heading|标题)\s*(\d)", re.IGNORECASE)
_BULLET_STYLES = ("List Bullet", "项目符号")
_NUMBER_STYLES = ("List Number", "编号")


def _read_docx(path: Path, out: Path) -> tuple[int, list[str]]:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    stats = {"heading": 0, "para": 0, "list": 0, "table": 0}
    lines: list[str] = []
    doc = Document(str(path))
    for child in doc.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, doc)
            text = paragraph.text.strip()
            if not text:
                continue
            style = paragraph.style.name if paragraph.style is not None else ""
            match = _HEADING_RE.match(style)
            if match:
                level = int(match.group(1))
                lines.append(f"{'#' * level} {text}")
                stats["heading"] += 1
            elif any(style == s for s in _BULLET_STYLES):
                lines.append(f"- {text}")
                stats["list"] += 1
            elif any(style == s for s in _NUMBER_STYLES):
                # 有序列表在 markdown 里以 - 近似表达（保留可读性）
                lines.append(f"- {text}")
                stats["list"] += 1
            else:
                lines.append(text)
                stats["para"] += 1
        elif child.tag == qn("w:tbl"):
            table = Table(child, doc)
            _docx_table_md(table, lines)
            stats["table"] += 1
    out.write_text("\n\n".join(lines) + "\n", encoding="utf-8")
    summary = (
        f"docx → markdown：{stats['heading']} 个标题、{stats['para']} 段正文、"
        f"{stats['list']} 个列表项、{stats['table']} 张表格"
    )
    return out.stat().st_size, [summary]


def _docx_table_md(table, lines: list) -> None:
    rows = []
    for row in table.rows:
        rows.append([cell.text.replace("\r", " ").replace("\n", " ").strip() for cell in row.cells])
    if not rows:
        return
    n_cols = max(len(r) for r in rows)
    header = rows[0] + [""] * (n_cols - len(rows[0]))
    escaped = [_escape_cell(v) for v in header]
    lines.append("| " + " | ".join(escaped) + " |")
    lines.append("| " + " | ".join(["---"] * n_cols) + " |")
    for row in rows[1:]:
        padded = row + [""] * (n_cols - len(row))
        lines.append("| " + " | ".join(_escape_cell(v) for v in padded) + " |")
    # 合并单元格被平铺展开，给出提示
    if any(len({c.text for c in row.cells}) < len(row.cells) for row in table.rows):
        lines.append("> ⚠️ 表格含合并单元格，已在 markdown 中平铺展示")


def _escape_cell(value: str) -> str:
    return value.replace("|", "\\|")


def _read_xlsx(path: Path, out: Path, spec: dict) -> tuple[int, list[str]]:
    from openpyxl import load_workbook

    max_rows = int(spec.get("max_rows") or 200)
    data_only = bool(spec.get("data_only"))
    notes: list[str] = []
    lines: list[str] = []
    sheet_stats: list[str] = []
    wb = load_workbook(str(path), data_only=data_only, read_only=True)
    try:
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            lines.append(f"## Sheet: {sheet_name}")
            lines.append("")
            shown = 0
            total = 0
            body: list[list] = []
            truncated = False
            for row in ws.iter_rows(values_only=True):
                total += 1
                if shown > max_rows:
                    truncated = True
                    continue
                body.append([_fmt_cell(v) for v in row])
                shown += 1
            if body:
                n_cols = max(len(r) for r in body)
                header = body[0] + [""] * (n_cols - len(body[0]))
                lines.append("| " + " | ".join(_escape_cell(v) for v in header) + " |")
                lines.append("| " + " | ".join(["---"] * n_cols) + " |")
                for row in body[1:]:
                    padded = row + [""] * (n_cols - len(row))
                    lines.append("| " + " | ".join(_escape_cell(v) for v in padded) + " |")
            if truncated:
                note = (
                    f"> ⚠️ 该 sheet 共 {total - 1} 行数据，数据量大，仅显示前 {max_rows} 行。"
                    "如需完整内容请调大 max_rows 或用 openpyxl 直接读取。"
                )
                lines.append(note)
                notes.append(note)
            sheet_stats.append(f"{sheet_name}({total - 1}行)")
            lines.append("")
    finally:
        wb.close()
    out.write_text("\n".join(lines), encoding="utf-8")
    summary = "xlsx → markdown：" + "，".join(sheet_stats) + " 的数据"
    if notes:
        summary += "；⚠️ " + str(len(notes)) + " 个 sheet 被截断"
    return out.stat().st_size, [summary]


def _fmt_cell(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    return str(value)


def _read_pptx(path: Path, out: Path) -> tuple[int, list[str]]:
    from pptx import Presentation

    prs = Presentation(str(path))
    lines: list[str] = []
    slide_count = 0
    for index, slide in enumerate(prs.slides, start=1):
        slide_count += 1
        lines.append(f"## Slide {index}")
        lines.append("")
        texts = []
        for shape in slide.shapes:
            if shape.has_text_frame and shape.text_frame.text.strip():
                texts.append(shape.text_frame.text.strip().replace("\n", "\n  "))
        for text in texts:
            lines.append(text)
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                lines.append("")
                lines.append(f"> 备注：{notes}")
        lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")
    summary = f"pptx → markdown：{slide_count} 张幻灯片"
    return out.stat().st_size, [summary]


def read_office(spec: dict, out: Path, spec_file: Path) -> str:
    source = str(spec.get("source") or "")
    if not source:
        raise ValueError("spec.source 不能为空")
    path = resolve_source(source, spec_file)
    if not path.is_file():
        raise FileNotFoundError(f"输入文件不存在: {path}")

    fmt = str(spec.get("format") or path.suffix.lstrip(".")).lower()
    if fmt in ("docx",):
        reader = _read_docx
    elif fmt in ("xlsx", "xlsm"):
        reader = _read_xlsx
    elif fmt in ("pptx",):
        reader = _read_pptx
    else:
        raise ValueError(f"不支持的格式: {fmt}（支持 docx / xlsx / pptx）")

    size, summaries = reader(path, out, spec) if reader is _read_xlsx else reader(path, out)
    return "，".join(summaries) + f"，markdown 输出 {size} 字节"


if __name__ == "__main__":
    # markdown 是本脚本的可覆盖草稿输出，不套“不覆盖”保护
    run_cli(read_office, "读取 Office 文档并输出 markdown", no_overwrite=False)
