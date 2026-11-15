"""make_docx.py —— 按 JSON spec 生成 Word 文档（.docx）。

支持：标题层级（Heading 1-4）、正文段落、有序/无序列表、表格（含合并单元格、
显式列宽、表头底色）、图片、页眉、页脚、页码域、目录占位（TOC 域）、分页、
引用块、对齐方式。

用法：
    uv run python make_docx.py --spec spec.json --out output/report.docx

spec 契约与示例见 skills/office-docs/references/spec-docx.md。
"""

from __future__ import annotations

from pathlib import Path

from _office_io import resolve_source, run_cli
from _theme import (
    merged_palette,
    parse_length,
    resolve_font,
    set_docx_run_font,
    set_docx_style_font,
)
from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from openpyxl.utils.cell import column_index_from_string, coordinate_from_string

_ALIGN_MAP = {
    "left": WD_ALIGN_PARAGRAPH.LEFT,
    "center": WD_ALIGN_PARAGRAPH.CENTER,
    "right": WD_ALIGN_PARAGRAPH.RIGHT,
    "justify": WD_ALIGN_PARAGRAPH.JUSTIFY,
}

_HEADING_SIZES = {1: 22, 2: 18, 3: 14, 4: 12}

_PAGE_SIZES = {
    "a4": (21.0, 29.7),
    "letter": (21.59, 27.94),
}


def _shade_paragraph(p, color: str) -> None:
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), color)
    pPr.append(shd)


def _shade_cell(cell, color: str) -> None:
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:fill"), color)
    tcPr.append(shd)


def _add_field(paragraph, instr: str) -> None:
    """在段落里插入一个 fldSimple 域（页码/目录等由 Word 渲染）。"""
    fld = OxmlElement("w:fldSimple")
    fld.set(qn("w:instr"), instr)
    fld.set(qn("w:dirty"), "true")
    run = OxmlElement("w:r")
    t = OxmlElement("w:t")
    t.text = "1"
    run.append(t)
    fld.append(run)
    paragraph._p.append(fld)


def _configure_section(doc: Document, spec: dict, font: str, palette: dict) -> None:
    section = doc.sections[0]
    size = str(spec.get("page_size", "a4")).lower()
    page_w, page_h = _PAGE_SIZES.get(size, _PAGE_SIZES["a4"])
    section.page_width = Cm(page_w)
    section.page_height = Cm(page_h)

    margins = spec.get("margins") or {}
    section.top_margin = Cm(parse_length(margins.get("top", 2.54)))
    section.bottom_margin = Cm(parse_length(margins.get("bottom", 2.54)))
    section.left_margin = Cm(parse_length(margins.get("left", 3.18)))
    section.right_margin = Cm(parse_length(margins.get("right", 3.18)))

    header_text = spec.get("header")
    if header_text:
        header_p = section.header.paragraphs[0]
        run = header_p.add_run(str(header_text))
        set_docx_run_font(run, font)
        run.font.size = Pt(9)
        run.font.color.rgb = RGBColor.from_string(palette["border"])
        header_p.alignment = _ALIGN_MAP.get(spec.get("header_align", "right"))

    footer = spec.get("footer")
    if footer is True:
        footer_p = section.footer.paragraphs[0]
        footer_p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        for text in ("第 ", "PAGE", " 页 / 共 ", "NUMPAGES", " 页"):
            if text in ("PAGE", "NUMPAGES"):
                _add_field(footer_p, text)
            else:
                run = footer_p.add_run(text)
                set_docx_run_font(run, font)
                run.font.size = Pt(9)
                run.font.color.rgb = RGBColor.from_string(palette["border"])
    elif isinstance(footer, str) and footer:
        footer_p = section.footer.paragraphs[0]
        run = footer_p.add_run(str(footer))
        set_docx_run_font(run, font)
        run.font.size = Pt(9)


def _set_default_style(doc: Document, font: str, palette: dict) -> None:
    style = doc.styles["Normal"]
    set_docx_style_font(style, font)
    style.font.size = Pt(11)
    style.font.color.rgb = RGBColor.from_string(palette["body"])
    style.paragraph_format.space_after = Pt(6)
    style.paragraph_format.line_spacing = 1.4


def _add_heading(doc: Document, block: dict, font: str, palette: dict, counts: dict) -> None:
    level = max(1, min(int(block.get("level", 1)), 4))
    paragraph = doc.add_heading(str(block["text"]), level=level)
    for run in paragraph.runs:
        set_docx_run_font(run, font)
        run.font.size = Pt(_HEADING_SIZES[level])
        run.font.bold = True
        run.font.color.rgb = RGBColor.from_string(palette["heading"])
    paragraph.paragraph_format.space_before = Pt(10)
    paragraph.paragraph_format.space_after = Pt(6)
    counts["heading"] += 1


def _add_paragraph(doc: Document, block: dict, font: str, palette: dict, counts: dict) -> None:
    paragraph = doc.add_paragraph()
    paragraph.alignment = _ALIGN_MAP.get(str(block.get("align", "left")), WD_ALIGN_PARAGRAPH.LEFT)
    run = paragraph.add_run(str(block.get("text", "")))
    set_docx_run_font(run, font)
    if block.get("size"):
        run.font.size = Pt(float(block["size"]))
    if block.get("bold"):
        run.font.bold = True
    if block.get("italic"):
        run.font.italic = True
    if block.get("color"):
        run.font.color.rgb = RGBColor.from_string(str(block["color"]).lstrip("#"))
    counts["para"] += 1


def _add_quote(doc: Document, block: dict, font: str, palette: dict, counts: dict) -> None:
    paragraph = doc.add_paragraph()
    paragraph.paragraph_format.left_indent = Cm(0.8)
    paragraph.paragraph_format.right_indent = Cm(0.8)
    run = paragraph.add_run(str(block.get("text", "")))
    set_docx_run_font(run, font)
    run.font.italic = True
    run.font.color.rgb = RGBColor.from_string(palette["body"])
    _shade_paragraph(paragraph, palette["light"])
    counts["quote"] += 1


def _add_list(
    doc: Document, block: dict, font: str, palette: dict, counts: dict, ordered: bool
) -> None:
    style_name = "List Number" if ordered else "List Bullet"
    fallback_marker = "1. " if ordered else "• "
    for index, item in enumerate(block.get("items") or [], start=1):
        paragraph = doc.add_paragraph()
        try:
            paragraph.style = doc.styles[style_name]
            prefix = ""
        except KeyError:
            prefix = fallback_marker
        run = paragraph.add_run(f"{prefix}{str(item)}")
        set_docx_run_font(run, font)
        paragraph.paragraph_format.space_after = Pt(3)
        _ = index
    counts["list"] += len(block.get("items") or [])


def _parse_cell_ref(ref: str) -> tuple[int, int]:
    col_letter, row = coordinate_from_string(str(ref).upper())
    return int(row) - 1, column_index_from_string(col_letter) - 1


def _style_cell(
    cell, text: str, font: str, palette: dict, *, header: bool, width_cm: float | None = None
) -> None:
    cell.text = str(text)
    if width_cm is not None:
        cell.width = Cm(width_cm)
    color = palette["white"] if header else palette["body"]
    for paragraph in cell.paragraphs:
        paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER if header else WD_ALIGN_PARAGRAPH.LEFT
        for run in paragraph.runs:
            set_docx_run_font(run, font)
            run.font.size = Pt(10)
            run.font.bold = header
            run.font.color.rgb = RGBColor.from_string(color)
    if header:
        _shade_cell(cell, palette["primary"])


def _add_table(doc: Document, block: dict, font: str, palette: dict, counts: dict) -> None:
    headers = [str(h) for h in (block.get("headers") or [])]
    rows = [[str(v) for v in r] for r in (block.get("rows") or [])]
    if not headers and not rows:
        raise ValueError("表格 block 需要 headers 或 rows")
    n_cols = max(len(headers), *(len(r) for r in rows)) if rows else len(headers)
    n_rows = len(rows) + (1 if headers else 0)
    table = doc.add_table(rows=n_rows, cols=n_cols)
    table.style = "Table Grid"
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.CENTER

    col_widths = [float(w) for w in (block.get("col_widths") or [])]
    if len(col_widths) < n_cols:
        col_widths = col_widths + [4.0] * (n_cols - len(col_widths))

    base_row = 1 if headers else 0
    if headers:
        for col_idx, header in enumerate(headers):
            _style_cell(
                table.cell(0, col_idx),
                header,
                font,
                palette,
                header=True,
                width_cm=col_widths[col_idx],
            )
    for row_idx, row in enumerate(rows, start=base_row):
        for col_idx in range(n_cols):
            value = row[col_idx] if col_idx < len(row) else ""
            width_cm = col_widths[col_idx] if col_idx < len(col_widths) else None
            _style_cell(
                table.cell(row_idx, col_idx), value, font, palette, header=False, width_cm=width_cm
            )

    # 合并单元格：{"from": "A1", "to": "B1", "text": "..."}
    for merge in block.get("merges") or []:
        r1, c1 = _parse_cell_ref(merge["from"])
        r2, c2 = _parse_cell_ref(merge["to"])
        if r1 > r2 or c1 > c2:
            raise ValueError(f"合并范围非法: {merge['from']}->{merge['to']}")
        cell = table.cell(r1, c1)
        cell.text = str(merge.get("text", ""))
        merged = cell.merge(table.cell(r2, c2))
        _style_cell(
            merged, str(merge.get("text", "")), font, palette, header=(r1 == 0 and bool(headers))
        )

    counts["table"] += 1
    counts["table_cells"] += n_rows * n_cols


def _add_image(
    doc: Document, block: dict, spec_file: Path, font: str, palette: dict, counts: dict
) -> None:
    path = str(resolve_source(str(block["path"]), spec_file))
    paragraph = doc.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    width_cm = float(block.get("width_cm") or block.get("width") or 14)
    paragraph.add_run().add_picture(path, width=Cm(width_cm))
    if block.get("caption"):
        caption = doc.add_paragraph()
        caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = caption.add_run(str(block["caption"]))
        set_docx_run_font(run, font)
        run.font.size = Pt(9)
        run.font.italic = True
        run.font.color.rgb = RGBColor.from_string(palette["border"])
    counts["image"] += 1


def _add_toc_placeholder(doc: Document, font: str, palette: dict) -> None:
    title = doc.add_paragraph()
    run = title.add_run("目录")
    set_docx_run_font(run, font)
    run.font.size = Pt(16)
    run.font.bold = True
    run.font.color.rgb = RGBColor.from_string(palette["heading"])
    title.paragraph_format.space_after = Pt(8)
    _add_field(title, r'TOC \o "1-2" \h \z \u')
    hint = doc.add_paragraph()
    hint_run = hint.add_run("（在 Word / WPS 中打开，全选后按 F9 或右键“更新域”生成目录与页码）")
    set_docx_run_font(hint_run, font)
    hint_run.font.size = Pt(9)
    hint_run.font.italic = True
    hint_run.font.color.rgb = RGBColor.from_string(palette["border"])
    doc.add_page_break()


def make_docx(spec: dict, out: Path, spec_file: Path) -> str:
    font, font_warnings = resolve_font(spec.get("font"))
    palette = merged_palette(spec.get("colors"))
    warnings: list = list(font_warnings)

    doc = Document()
    doc.core_properties.title = str(spec.get("title", ""))
    doc.core_properties.author = str(spec.get("author", "Octop"))
    _set_default_style(doc, font, palette)
    _configure_section(doc, spec, font, palette)

    counts = {
        "heading": 0,
        "para": 0,
        "quote": 0,
        "list": 0,
        "table": 0,
        "table_cells": 0,
        "image": 0,
    }
    blocks = list(spec.get("blocks") or [])
    if spec.get("toc"):
        _add_toc_placeholder(doc, font, palette)

    for block in blocks:
        block_type = str(block.get("type", "para"))
        if block_type == "heading":
            _add_heading(doc, block, font, palette, counts)
        elif block_type == "para":
            _add_paragraph(doc, block, font, palette, counts)
        elif block_type == "quote":
            _add_quote(doc, block, font, palette, counts)
        elif block_type in ("ul", "ol"):
            _add_list(doc, block, font, palette, counts, ordered=(block_type == "ol"))
        elif block_type == "table":
            _add_table(doc, block, font, palette, counts)
        elif block_type == "image":
            _add_image(doc, block, spec_file, font, palette, counts)
        elif block_type == "pagebreak":
            doc.add_page_break()
        else:
            raise ValueError(f"不支持的 block 类型: {block_type}")

    doc.save(str(out))

    parts = [
        f"docx，{counts['heading']} 个标题，{counts['para']} 段正文，"
        f"{counts['list']} 个列表项，{counts['table']} 张表格（{counts['table_cells']} 单元格），"
        f"{counts['image']} 张图片",
        f"字体 {font}",
    ]
    if spec.get("toc"):
        parts.append("含目录占位")
    if warnings:
        parts.append("；".join(warnings))
    return "，".join(parts)


if __name__ == "__main__":
    run_cli(make_docx, "生成 Word 文档（.docx）")
