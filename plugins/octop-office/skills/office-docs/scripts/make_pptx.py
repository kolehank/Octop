"""make_pptx.py —— 按 JSON spec 生成 PowerPoint 演示文稿（.pptx）。

支持版式：title（标题页）、section（章节页）、bullets（要点页）、
content_image（图文页）、table（表格页）、chart（图表页）。
默认 16:9；主题色、字体、备注（notes）、演讲者备注均可配置。

用法：
    uv run python make_pptx.py --spec spec.json --out output/report.pptx

spec 契约与示例见 skills/office-docs/references/spec-pptx.md。
"""

from __future__ import annotations

from pathlib import Path

from _office_io import resolve_source, run_cli
from _theme import inch_to_emu, merged_palette, resolve_font, set_pptx_run_font
from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

# 版式几何（16:9 基准，单位 EMU）
MARGIN = inch_to_emu(0.55)
TITLE_TOP = inch_to_emu(0.3)
TITLE_HEIGHT = inch_to_emu(0.85)
ACCENT_HEIGHT = inch_to_emu(0.07)
CONTENT_TOP = inch_to_emu(1.5)
BOTTOM_GAP = inch_to_emu(0.5)

_CHART_TYPES = {
    "line": XL_CHART_TYPE.LINE_MARKERS,
    "bar": XL_CHART_TYPE.COLUMN_CLUSTERED,
    "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
}


def _rect(slide, left: int, top: int, width: int, height: int, color: str):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor.from_string(color)
    shape.line.fill.background()
    shape.shadow.inherit = False
    return shape


def _textbox(slide, left: int, top: int, width: int, height: int, anchor: str = "top"):
    box = slide.shapes.add_textbox(left, top, width, height)
    tf = box.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = MSO_ANCHOR.TOP if anchor == "top" else MSO_ANCHOR.MIDDLE
    return box, tf


def _add_para(
    tf,
    text: str,
    *,
    font: str,
    size: float,
    color: str,
    bold: bool = False,
    align=None,
    first: bool = False,
    space_after: float = 6.0,
) -> None:
    paragraph = tf.paragraphs[0] if first else tf.add_paragraph()
    run = paragraph.add_run()
    run.text = str(text)
    set_pptx_run_font(run, font)
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = RGBColor.from_string(color)
    if align is not None:
        paragraph.alignment = align
    paragraph.space_after = Pt(space_after)


def _add_title(slide, text: str, font: str, palette: dict, accent_color: str | None = None) -> None:
    box, tf = _textbox(slide, MARGIN, TITLE_TOP, _TITLE_WIDTH, TITLE_HEIGHT)
    _add_para(tf, str(text), font=font, size=24, color=palette["heading"], bold=True, first=True)
    accent = accent_color or palette["accent"]
    _rect(
        slide,
        MARGIN,
        TITLE_TOP + TITLE_HEIGHT + inch_to_emu(0.03),
        _TITLE_WIDTH,
        ACCENT_HEIGHT,
        accent,
    )


_TITLE_WIDTH = 0  # 在 make_pptx 里按正片尺寸计算


def _add_notes(slide, notes: object) -> None:
    if not notes:
        return
    slide.notes_slide.notes_text_frame.text = str(notes)


def _slide_title(slide, title: str, font: str, palette: dict) -> None:
    _add_title(slide, title, font, palette)


def _layout_title(slide, spec: dict, font: str, palette: dict, spec_file: Path = None) -> None:
    """标题页：居中大标题 + 强调线 + 副标题。"""
    del spec_file
    _rect(slide, 0, 0, prs_width, prs_height, palette["heading"])
    _rect(slide, 0, int(prs_height * 0.78), prs_width, inch_to_emu(0.12), palette["accent"])
    box, tf = _textbox(
        slide,
        MARGIN,
        int(prs_height * 0.38),
        prs_width - 2 * MARGIN,
        inch_to_emu(2.0),
        anchor="middle",
    )
    _add_para(
        tf,
        str(spec.get("title", "")),
        font=font,
        size=44,
        color=palette["white"],
        bold=True,
        first=True,
        align=PP_ALIGN.CENTER,
        space_after=12,
    )
    subtitle = spec.get("subtitle")
    if subtitle:
        _add_para(
            tf, str(subtitle), font=font, size=20, color=palette["light"], align=PP_ALIGN.CENTER
        )


def _layout_section(slide, spec: dict, font: str, palette: dict, spec_file: Path = None) -> None:
    """章节页：色条 + 章标题 + 小节说明。"""
    del spec_file
    _rect(slide, 0, 0, prs_width, ACCENT_HEIGHT, palette["primary"])
    box, tf = _textbox(
        slide, MARGIN, int(prs_height * 0.40), prs_width - 2 * MARGIN, inch_to_emu(2.6)
    )
    _add_para(
        tf,
        str(spec.get("title", "")),
        font=font,
        size=38,
        color=palette["heading"],
        bold=True,
        first=True,
        space_after=10,
    )
    subtitle = spec.get("subtitle")
    if subtitle:
        _add_para(tf, str(subtitle), font=font, size=18, color=palette["body"])


def _layout_bullets(slide, spec: dict, font: str, palette: dict, spec_file: Path = None) -> None:
    del spec_file
    _slide_title(slide, str(spec.get("title", "")), font, palette)
    box, tf = _textbox(
        slide, MARGIN, CONTENT_TOP, prs_width - 2 * MARGIN, prs_height - CONTENT_TOP - BOTTOM_GAP
    )
    bullets = spec.get("bullets") or []
    for index, item in enumerate(bullets):
        _add_para(
            tf,
            str(item),
            font=font,
            size=18,
            color=palette["body"],
            first=(index == 0),
            space_after=10,
        )
    _add_notes(slide, spec.get("notes"))


def _layout_content_image(slide, spec: dict, font: str, palette: dict, spec_file: Path) -> None:
    _slide_title(slide, str(spec.get("title", "")), font, palette)
    text_box, tf = _textbox(
        slide,
        MARGIN,
        CONTENT_TOP,
        int((prs_width - 2 * MARGIN) * 0.5),
        prs_height - CONTENT_TOP - BOTTOM_GAP,
    )
    body = spec.get("body")
    if isinstance(body, str):
        _add_para(tf, body, font=font, size=16, color=palette["body"], first=True, space_after=8)
    elif isinstance(body, list):
        for index, line in enumerate(body):
            _add_para(
                tf,
                str(line),
                font=font,
                size=16,
                color=palette["body"],
                first=(index == 0),
                space_after=8,
            )
    image_path = str(resolve_source(str(spec["image"]), spec_file))
    img_left = MARGIN + int((prs_width - 2 * MARGIN) * 0.5) + inch_to_emu(0.2)
    img_width = int((prs_width - 2 * MARGIN) * 0.42)
    slide.shapes.add_picture(image_path, img_left, CONTENT_TOP, width=img_width)
    _add_notes(slide, spec.get("notes"))


def _layout_table(slide, spec: dict, font: str, palette: dict, spec_file: Path = None) -> None:
    del spec_file
    _slide_title(slide, str(spec.get("title", "")), font, palette)
    headers = [str(h) for h in (spec.get("headers") or [])]
    rows = [[str(v) for v in r] for r in (spec.get("rows") or [])]
    if not headers:
        raise ValueError("table 版式需要 headers")
    n_cols = max(len(headers), *(len(r) for r in rows)) if rows else len(headers)
    n_rows = len(rows) + 1
    left = MARGIN
    top = CONTENT_TOP + inch_to_emu(0.05)
    width = prs_width - 2 * MARGIN
    height = min(int(inch_to_emu(0.5) * n_rows), prs_height - top - BOTTOM_GAP)
    shape = slide.shapes.add_table(n_rows, n_cols, left, top, width, height)
    table = shape.table
    col_width = width // n_cols
    for col_idx in range(n_cols):
        table.columns[col_idx].width = col_width
    for col_idx, header in enumerate(headers):
        cell = table.cell(0, col_idx)
        cell.fill.solid()
        cell.fill.fore_color.rgb = RGBColor.from_string(palette["primary"])
        p = cell.text_frame.paragraphs[0]
        run = p.add_run()
        run.text = header
        set_pptx_run_font(run, font)
        run.font.size = Pt(14)
        run.font.bold = True
        run.font.color.rgb = RGBColor.from_string(palette["white"])
        p.alignment = PP_ALIGN.CENTER
    for row_idx, row in enumerate(rows, start=1):
        for col_idx in range(n_cols):
            value = row[col_idx] if col_idx < len(row) else ""
            cell = table.cell(row_idx, col_idx)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor.from_string(
                palette["light"] if row_idx % 2 == 0 else palette["white"]
            )
            p = cell.text_frame.paragraphs[0]
            run = p.add_run()
            run.text = value
            set_pptx_run_font(run, font)
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor.from_string(palette["body"])
    _add_notes(slide, spec.get("notes"))


def _layout_chart(slide, spec: dict, font: str, palette: dict, spec_file: Path = None) -> None:
    del spec_file
    _slide_title(slide, str(spec.get("title", "")), font, palette)
    chart_spec = spec.get("chart") or spec
    data = chart_spec.get("data") or spec.get("data") or {}
    chart_data = CategoryChartData()
    chart_data.categories = [str(c) for c in (data.get("categories") or [])]
    for series in data.get("series") or []:
        chart_data.add_series(str(series.get("name", "")), list(series.get("values") or []))
    chart_type = _CHART_TYPES.get(str(chart_spec.get("chart_type", "bar")).lower())
    if chart_type is None:
        raise ValueError(
            f"不支持的 chart_type: {chart_spec.get('chart_type')}（支持 line / bar / column）"
        )
    frame = slide.shapes.add_chart(
        chart_type,
        MARGIN,
        CONTENT_TOP + inch_to_emu(0.05),
        prs_width - 2 * MARGIN,
        prs_height - CONTENT_TOP - BOTTOM_GAP - inch_to_emu(0.1),
        chart_data,
    )
    chart = frame.chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.has_title = False  # 标题已在画布上
    _ = palette
    _add_notes(slide, spec.get("notes"))


_LAYOUTS = {
    "title": _layout_title,
    "section": _layout_section,
    "bullets": _layout_bullets,
    "content_image": _layout_content_image,
    "table": _layout_table,
    "chart": _layout_chart,
}


def make_pptx(spec: dict, out: Path, spec_file: Path) -> str:
    font, font_warnings = resolve_font(spec.get("font"))
    palette = merged_palette(spec.get("colors"))
    warnings: list = list(font_warnings)

    global prs_width, prs_height, _TITLE_WIDTH
    prs = Presentation()
    aspect = str(spec.get("aspect", "16:9")).lower()
    if aspect == "4:3":
        prs.slide_width = Inches(10)
        prs.slide_height = Inches(7.5)
    else:
        prs.slide_width = Inches(13.333)
        prs.slide_height = Inches(7.5)
    prs_width = int(prs.slide_width)
    prs_height = int(prs.slide_height)
    _TITLE_WIDTH = prs_width - 2 * MARGIN

    prs.core_properties.title = str(spec.get("title", ""))
    prs.core_properties.author = str(spec.get("author", "Octop"))

    blank = prs.slide_layouts[6]  # Blank 版式
    slide_specs = list(spec.get("slides") or [])
    if not slide_specs:
        raise ValueError("spec.slides 不能为空")

    layout_counts: dict = {}
    for slide_spec in slide_specs:
        layout = str(slide_spec.get("layout", "bullets")).lower()
        builder = _LAYOUTS.get(layout)
        if builder is None:
            raise ValueError(
                f"不支持的版式: {layout}（支持 title/section/bullets/content_image/table/chart）"
            )
        slide = prs.slides.add_slide(blank)
        builder(slide, slide_spec, font, palette, spec_file)
        layout_counts[layout] = layout_counts.get(layout, 0) + 1

    prs.save(str(out))

    parts = [
        f"pptx，{len(slide_specs)} 张幻灯片（{aspect}），"
        + "，".join(f"{k}×{v}" for k, v in layout_counts.items()),
        f"字体 {font}",
    ]
    if warnings:
        parts.append("；".join(warnings))
    return "，".join(parts)


if __name__ == "__main__":
    run_cli(make_pptx, "生成 PowerPoint 演示文稿（.pptx）")
