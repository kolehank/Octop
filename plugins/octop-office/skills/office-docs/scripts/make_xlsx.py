"""make_xlsx.py —— 按 JSON spec 生成 Excel 工作簿（.xlsx）。

支持：多 sheet、表头样式、列宽自适应、冻结窗格、数字格式、条件格式、
折线/柱状图、公式（单元格值以 "=" 开头即公式）、合并表头单元格。

用法：
    uv run python make_xlsx.py --spec spec.json --out output/report.xlsx

spec 契约与示例见 skills/office-docs/references/spec-xlsx.md。
"""

from __future__ import annotations

from pathlib import Path

from _office_io import run_cli
from _theme import merged_palette, resolve_font
from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.formatting.rule import CellIsRule, ColorScaleRule, DataBarRule
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# 大表提示阈值：超过即写进 summary 提示（仍正常生成）。
_ROW_WARN_THRESHOLD = 50000

_CELL_OP_MAP = {
    "greaterThan": "greaterThan",
    "greaterThanOrEqual": "greaterThanOrEqual",
    "lessThan": "lessThan",
    "lessThanOrEqual": "lessThanOrEqual",
    "equal": "equal",
    "between": "between",
    "notBetween": "notBetween",
}


def _display_len(value: object) -> int:
    """视觉宽度：中文/全角按 2 计，其余按 1 计。"""
    if value is None:
        return 0
    text = str(value)
    return sum(2 if ord(ch) > 127 else 1 for ch in text)


def _auto_width(spec_column: dict, title: str, values: list) -> int:
    explicit = spec_column.get("width")
    if isinstance(explicit, (int, float)) and explicit > 0:
        return int(max(4, round(float(explicit))))
    longest = max([_display_len(title)] + [_display_len(v) for v in values])
    return max(6, min(50, int(longest * 1.2 + 3)))


def _style_header_cell(cell, font: str, palette: dict) -> None:
    cell.font = Font(name=font, bold=True, size=11, color=palette["white"])
    cell.fill = PatternFill("solid", fgColor=palette["primary"])
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin = Side(style="thin", color=palette["border"])
    cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)


def _style_data_cell(cell, font: str, palette: dict, value: object, align: str | None) -> None:
    cell.font = Font(name=font, size=11, color=palette["body"])
    is_number = isinstance(value, (int, float)) and not isinstance(value, bool)
    cell.alignment = Alignment(
        horizontal=align or ("right" if is_number else "left"),
        vertical="center",
    )
    thin = Side(style="thin", color=palette["border"])
    cell.border = Border(left=thin, right=thin, top=thin, bottom=thin)


def _write_sheet(
    wb: Workbook, sheet_spec: dict, index: int, font: str, palette: dict, warnings: list
) -> dict:
    name = sheet_spec.get("name") or f"Sheet{index + 1}"
    ws = wb.create_sheet(title=name)

    rows = list(sheet_spec.get("rows") or [])
    columns = list(sheet_spec.get("columns") or [])
    if not columns and rows and isinstance(rows[0], dict):
        columns = [{"key": key, "title": key} for key in rows[0]]

    keys = [col.get("key", col.get("title")) for col in columns]
    n_cols = len(columns)
    n_rows = len(rows)
    if n_cols == 0:
        raise ValueError(f"sheet “{name}” 没有列定义且首行不是对象")
    if n_rows > _ROW_WARN_THRESHOLD:
        warnings.append(f"sheet “{name}” 共 {n_rows} 行，占用较大，建议先压缩或拆分")

    # --- 表头 ---
    for col_idx, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=col_idx, value=str(col.get("title", "")))
        _style_header_cell(cell, font, palette)
    ws.row_dimensions[1].height = 24

    # --- 数据行 ---
    values_by_col: list[list] = [[] for _ in columns]
    for row_idx, row in enumerate(rows, start=2):
        for col_idx, col in enumerate(columns, start=1):
            key = col.get("key", col.get("title"))
            if isinstance(row, dict):
                value = row.get(key)
            elif isinstance(row, (list, tuple)) and col_idx - 1 < len(row):
                value = row[col_idx - 1]
            else:
                value = None
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            _style_data_cell(cell, font, palette, value, col.get("align"))
            values_by_col[col_idx - 1].append(value)

    # --- 数字格式（数据列范围） ---
    for col_idx, col in enumerate(columns, start=1):
        numfmt = col.get("numfmt")
        if not numfmt:
            continue
        for row_idx in range(2, n_rows + 2):
            ws.cell(row=row_idx, column=col_idx).number_format = str(numfmt)

    # --- 列宽（自适应或显式） ---
    for col_idx, col in enumerate(columns, start=1):
        width = _auto_width(col, str(col.get("title", "")), values_by_col[col_idx - 1])
        ws.column_dimensions[get_column_letter(col_idx)].width = width

    # --- 冻结窗格 ---
    freeze = sheet_spec.get("freeze")
    if freeze:
        ws.freeze_panes = str(freeze)

    # --- 条件格式 ---
    cond_rules = sheet_spec.get("cond") or sheet_spec.get("conditional") or []
    for rule in cond_rules:
        _add_cond_rule(ws, rule, palette)

    # --- 图表 ---
    key_to_col = {key: i + 1 for i, key in enumerate(keys)} if keys else {}
    for chart_spec in sheet_spec.get("charts") or []:
        _add_chart(ws, chart_spec, key_to_col, n_rows + 1, font, palette)

    return {
        "name": name,
        "rows": n_rows,
        "cols": n_cols,
        "charts": len(sheet_spec.get("charts") or []),
    }


def _add_cond_rule(ws, rule: dict, palette: dict) -> None:
    condition_range = rule.get("range")
    if not condition_range:
        raise ValueError(f"条件格式缺少 range: {rule}")
    rule_type = str(rule.get("type", "cellIs"))
    if rule_type == "dataBar":
        ws.conditional_formatting.add(
            str(condition_range),
            DataBarRule(
                start_type="min",
                end_type="max",
                color=str(rule.get("color", palette["primary"])).lstrip("#"),
                showValue=True,
            ),
        )
    elif rule_type == "colorScale":
        ws.conditional_formatting.add(
            str(condition_range),
            ColorScaleRule(
                start_type="min",
                start_color=str(rule.get("min", "F8696B")).lstrip("#"),
                mid_type="percentile",
                mid_value=50,
                mid_color=str(rule.get("mid", "FFEB84")).lstrip("#"),
                end_type="max",
                end_color=str(rule.get("max", "63BE7B")).lstrip("#"),
            ),
        )
    else:
        operator = _CELL_OP_MAP.get(str(rule.get("operator", "greaterThan")))
        if operator is None:
            raise ValueError(f"未知条件格式 operator: {rule.get('operator')}")
        formulas = rule.get("formula") or ["0"]
        if not isinstance(formulas, list):
            formulas = [formulas]
        ws.conditional_formatting.add(
            str(condition_range),
            CellIsRule(
                operator=operator,
                formula=[str(f) for f in formulas],
                fill=PatternFill("solid", fgColor=str(rule.get("fill", "FFC7CE")).lstrip("#")),
                font=Font(color=str(rule.get("font_color", "9C0006")).lstrip("#")),
            ),
        )


def _add_chart(
    ws, chart_spec: dict, key_to_col: dict, last_row: int, font: str, palette: dict
) -> None:
    chart_type = str(chart_spec.get("type", "line")).lower()
    if chart_type == "bar":
        chart = BarChart()
        chart.type = "col"  # 竖直柱状图
    elif chart_type == "line":
        chart = LineChart()
    else:
        raise ValueError(f"不支持的图表类型: {chart_type}（支持 line / bar）")

    chart.title = str(chart_spec.get("title", ""))
    chart.style = 10
    chart.height = float(chart_spec.get("height_cm") or 8)  # 单位 cm
    chart.width = float(chart_spec.get("width_cm") or 12)
    x_key = chart_spec.get("x")
    if not x_key or x_key not in key_to_col:
        raise ValueError(f"图表缺少有效的 x 列（当前列: {sorted(key_to_col)}）")
    x_col = key_to_col[x_key]
    categories = Reference(ws, min_col=x_col, min_row=2, max_row=last_row)
    chart.set_categories(categories)
    for y_key in chart_spec.get("y") or []:
        if y_key not in key_to_col:
            raise ValueError(f"图表 y 列不存在: {y_key}")
        y_col = key_to_col[y_key]
        data_ref = Reference(ws, min_col=y_col, min_row=1, max_row=last_row)
        chart.add_data(data_ref, titles_from_data=True)

    chart.legend.position = "b"
    anchor = chart_spec.get("anchor") or f"{get_column_letter(max(key_to_col.values()) + 2)}2"
    ws.add_chart(chart, str(anchor))


def make_xlsx(spec: dict, out: Path, spec_file: Path) -> str:
    del spec_file  # 生成类不需要解析输入文件路径
    font, font_warnings = resolve_font(spec.get("font"))
    palette = merged_palette(spec.get("colors"))
    warnings: list = list(font_warnings)

    sheets_spec = spec.get("sheets") or []
    if not sheets_spec:
        raise ValueError("spec.sheets 不能为空")

    wb = Workbook()
    wb.remove(wb.active)  # 去掉默认 sheet
    sheet_meta = []
    for index, sheet_spec in enumerate(sheets_spec):
        sheet_meta.append(_write_sheet(wb, sheet_spec, index, font, palette, warnings))

    wb.save(str(out))

    parts = [
        f"xlsx，{len(sheet_meta)} 个工作表（"
        + "、".join(f"{m['name']}({m['rows']}行/{m['cols']}列/{m['charts']}图)" for m in sheet_meta)
        + "）",
        f"字体 {font}",
    ]
    if warnings:
        parts.append("；".join(warnings))
    return "，".join(parts)


if __name__ == "__main__":
    run_cli(make_xlsx, "生成 Excel 工作簿（.xlsx）")
