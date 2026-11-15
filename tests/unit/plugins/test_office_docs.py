"""Golden tests for the bundled `plugins/octop-office` skill plugin scripts.

验证方式：固定 spec → 用真实 CLI（subprocess + sys.executable）调脚本生成 →
再用 python-docx / openpyxl / python-pptx 读回断言结构与内容。
所有生成物只进 pytest 的 tmp_path，绝不提交。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
PLUGIN_ROOT = REPO_ROOT / "plugins" / "octop-office"
SKILL_DIR = PLUGIN_ROOT / "skills" / "office-docs"
SCRIPTS = SKILL_DIR / "scripts"

# scripts/ 目录加入 sys.path 以便 in-process 测试直接 import 脚本模块
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def _has_soffice() -> bool:
    import convert_pdf

    return convert_pdf._find_soffice() is not None


HAS_SOFFICE = _has_soffice()


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------
def _run_script(script: str, spec: dict, out: Path, *, env: dict | None = None) -> dict:
    spec_file = out.parent / f"{script}.spec.json"
    spec_file.write_text(json.dumps(spec, ensure_ascii=False), encoding="utf-8")
    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / script), "--spec", str(spec_file), "--out", str(out)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        cwd=str(out.parent),
        env=env,
        timeout=180,
    )
    assert proc.stdout.strip(), f"{script} stdout 为空；stderr={proc.stderr!r}"
    return json.loads(proc.stdout.strip().splitlines()[-1])


def _make_png(path: Path, *, size: tuple[int, int] = (320, 160)) -> None:
    from PIL import Image

    Image.new("RGB", size, (47, 84, 150)).save(path)


# ---------------------------------------------------------------------------
# 插件布局
# ---------------------------------------------------------------------------
def test_plugin_layout_and_manifest() -> None:
    manifest = (PLUGIN_ROOT / "plugin.yaml").read_text(encoding="utf-8")
    assert "id: office" in manifest
    assert "kind: skill" in manifest
    assert "entry: main.py" in manifest
    assert 'icon: "📄"' in manifest
    assert (PLUGIN_ROOT / "main.py").is_file()
    assert (SKILL_DIR / "SKILL.md").is_file()
    expected_scripts = {
        "_theme.py",
        "_office_io.py",
        "make_xlsx.py",
        "make_docx.py",
        "make_pptx.py",
        "read_office.py",
        "convert_pdf.py",
    }
    assert expected_scripts <= {p.name for p in SCRIPTS.iterdir() if p.is_file()}
    expected_refs = {"spec-xlsx.md", "spec-docx.md", "spec-pptx.md", "pitfalls.md"}
    assert expected_refs <= {p.name for p in (SKILL_DIR / "references").iterdir() if p.is_file()}


# ---------------------------------------------------------------------------
# make_xlsx golden
# ---------------------------------------------------------------------------
XLSX_SPEC: dict = {
    "sheets": [
        {
            "name": "销售",
            "columns": [
                {"key": "month", "title": "月份", "width": 12},
                {"key": "amount", "title": "销售额", "numfmt": "#,##0"},
                {"key": "rate", "title": "完成率", "numfmt": "0.0%"},
            ],
            "rows": [
                {"month": "1月", "amount": 12000, "rate": 0.6},
                {"month": "2月", "amount": 15000, "rate": 0.75},
                {"month": "3月", "amount": 16000, "rate": 0.8},
                {"month": "合计", "amount": "=SUM(B2:B4)", "rate": 0.0},
            ],
            "freeze": "A2",
            "cond": [
                {"range": "B2:B4", "type": "dataBar", "color": "2F5496"},
                {
                    "range": "C2:C4",
                    "type": "cellIs",
                    "operator": "greaterThan",
                    "formula": ["0.7"],
                    "fill": "FFC7CE",
                    "font_color": "9C0006",
                },
            ],
            "charts": [{"type": "line", "x": "month", "y": ["amount"], "title": "销售趋势"}],
        },
        {
            "name": "市场",
            "columns": [
                {"key": "city", "title": "城市"},
                {"key": "score", "title": "得分", "numfmt": "0.0"},
            ],
            "rows": [{"city": "北京", "score": 88}, {"city": "上海", "score": 92}],
            "charts": [{"type": "bar", "x": "city", "y": ["score"], "title": "城市得分"}],
        },
    ]
}


def test_make_xlsx_golden(tmp_path: Path) -> None:
    out = tmp_path / "report.xlsx"
    result = _run_script("make_xlsx.py", XLSX_SPEC, out)
    assert result["ok"] is True and result["path"] == str(out)
    assert result["bytes"] > 0
    assert "2 个工作表" in result["summary"]

    from openpyxl import load_workbook

    wb = load_workbook(out)
    try:
        assert wb.sheetnames == ["销售", "市场"]
        ws = wb["销售"]
        # 数据与公式
        assert ws["A2"].value == "1月"
        assert ws["B2"].value == 12000
        assert ws["B5"].value == "=SUM(B2:B4)"
        # 冻结窗格
        assert ws.freeze_panes == "A2"
        # 表头样式：加粗 + 主色填充
        assert ws["A1"].font.bold is True
        assert str(ws["A1"].fill.fgColor.rgb).endswith("2F5496")
        # 数字格式
        assert ws["B2"].number_format == "#,##0"
        assert ws["C2"].number_format == "0.0%"
        # 显式列宽
        assert ws.column_dimensions["A"].width == 12
        # 图表
        assert len(ws._charts) == 1
        assert len(wb["市场"]._charts) == 1
        # 条件格式
        rules = [rule for cf in ws.conditional_formatting for rule in cf.rules]
        assert len(rules) >= 2
    finally:
        wb.close()


def test_make_xlsx_refuses_overwrite_then_honors_it(tmp_path: Path) -> None:
    out = tmp_path / "report.xlsx"
    first = _run_script("make_xlsx.py", XLSX_SPEC, out)
    assert first["ok"] is True
    second = _run_script("make_xlsx.py", XLSX_SPEC, out)
    assert second["ok"] is False and second["reason"] == "exists"
    overwrite_spec = {**XLSX_SPEC, "overwrite": True}
    third = _run_script("make_xlsx.py", overwrite_spec, out)
    assert third["ok"] is True


# ---------------------------------------------------------------------------
# make_docx golden
# ---------------------------------------------------------------------------
def _docx_spec(tmp_path: Path) -> dict:
    image = tmp_path / "chart.png"
    _make_png(image)
    return {
        "title": "项目周报",
        "author": "Octop",
        "toc": True,
        "header": "内部资料",
        "footer": True,
        "blocks": [
            {"type": "heading", "level": 1, "text": "一、本周进展"},
            {"type": "para", "text": "本周完成核心模块联调，性能达标。"},
            {"type": "ul", "items": ["修复登录超时", "补充 3 个报表页面"]},
            {"type": "ol", "items": ["灰度发布", "撰写使用文档"]},
            {"type": "heading", "level": 2, "text": "1.1 数据指标"},
            {
                "type": "table",
                "headers": ["季度", "1月", "2月", "3月"],
                "rows": [["Q1", 100, 200, 300], ["Q2", 150, 250, 350]],
                "col_widths": [4, 2.5, 2.5, 2.5],
                "merges": [{"from": "A1", "to": "B1", "text": "2026 春夏"}],
            },
            {"type": "image", "path": str(image), "width_cm": 10, "caption": "本周趋势"},
            {"type": "pagebreak"},
            {"type": "heading", "level": 1, "text": "二、下周计划"},
            {"type": "para", "text": "推进灰度发布，同步文档。", "bold": True},
        ],
    }


def test_make_docx_golden(tmp_path: Path) -> None:
    out = tmp_path / "report.docx"
    result = _run_script("make_docx.py", _docx_spec(tmp_path), out)
    assert result["ok"] is True and result["bytes"] > 0
    assert "3 个标题" in result["summary"] and "1 张表格" in result["summary"]
    assert "1 张图片" in result["summary"] and "目录占位" in result["summary"]

    from docx import Document

    doc = Document(out)
    # 目录占位
    assert any("目录" in p.text for p in doc.paragraphs[:3])
    # 标题层级
    h1 = [p.text for p in doc.paragraphs if p.style.name == "Heading 1"]
    assert h1 == ["一、本周进展", "二、下周计划"]
    h2 = [p.text for p in doc.paragraphs if p.style.name == "Heading 2"]
    assert "1.1 数据指标" in h2
    # 正文/列表
    texts = [p.text for p in doc.paragraphs]
    assert "本周完成核心模块联调，性能达标。" in texts
    assert "修复登录超时" in texts and "灰度发布" in texts
    # 表格与合并单元格
    assert len(doc.tables) == 1
    table = doc.tables[0]
    assert table.cell(0, 0).text == "2026 春夏"
    assert table.cell(0, 1).text == "2026 春夏"  # 横向合并后同文本
    assert table.cell(1, 0).text == "Q1"
    assert table.cell(2, 3).text == "350"
    # 表头列宽（用未被合并影响的单元格校验 col_widths 生效）
    assert approx_cm(table.cell(0, 2).width, 2.5)  # “2月”列 2.5cm
    assert approx_cm(table.cell(1, 0).width, 4.0)  # 数据行首列 4cm
    # 图片
    assert len(doc.inline_shapes) == 1
    # 页眉 + 页码域
    section = doc.sections[0]
    assert "内部资料" in section.header.paragraphs[0].text
    footer_xml = "".join(p._p.xml for p in section.footer.paragraphs)
    assert "PAGE" in footer_xml and "NUMPAGES" in footer_xml


def approx_cm(emu: int, target_cm: float) -> bool:
    """python-docx EMU 长度 ≈ 目标厘米（±1mm）。"""
    from docx.shared import Cm

    return abs(emu - Cm(target_cm)) < 36000


# ---------------------------------------------------------------------------
# make_pptx golden
# ---------------------------------------------------------------------------
def _pptx_spec(tmp_path: Path) -> dict:
    image = tmp_path / "channel.png"
    _make_png(image)
    return {
        "title": "2026 Q1 经营汇报",
        "aspect": "16:9",
        "slides": [
            {"layout": "title", "title": "2026 Q1 经营汇报", "subtitle": "Octop · 4月12日"},
            {"layout": "section", "title": "01 经营概览", "subtitle": "收入 / 成本 / 利润"},
            {
                "layout": "bullets",
                "title": "收入达成",
                "bullets": ["Q1 收入 320 万，达成率 107%", "环比增长 18%", "新签客户 23 家"],
                "notes": "数据口径：财务月结，税后口径。",
            },
            {
                "layout": "content_image",
                "title": "渠道分布",
                "body": ["线上直销占比 61%", "渠道伙伴 27%", "其余 12%"],
                "image": str(image),
            },
            {
                "layout": "table",
                "title": "分区域收入",
                "headers": ["区域", "收入", "达成率"],
                "rows": [["华北", 120, "105%"], ["华东", 140, "110%"], ["华南", 60, "90%"]],
            },
            {
                "layout": "chart",
                "title": "月度趋势",
                "chart_type": "line",
                "data": {
                    "categories": ["1月", "2月", "3月"],
                    "series": [{"name": "收入", "values": [90, 105, 125]}],
                },
            },
            {
                "layout": "bullets",
                "title": "下季度展望",
                "bullets": ["发布 2.0", "进入 3 个新行业"],
            },
        ],
    }


def test_make_pptx_golden(tmp_path: Path) -> None:
    out = tmp_path / "report.pptx"
    result = _run_script("make_pptx.py", _pptx_spec(tmp_path), out)
    assert result["ok"] is True and result["bytes"] > 0
    assert "7 张幻灯片" in result["summary"] and "（16:9）" in result["summary"]

    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from pptx.util import Inches

    prs = Presentation(out)
    assert prs.slide_width == Inches(13.333)  # 16:9 默认
    slides = list(prs.slides)
    assert len(slides) == 7

    def shape_texts(slide) -> list[str]:
        return [
            s.text
            for s in slide.shapes
            if getattr(s, "has_text_frame", False) and s.text_frame.text.strip()
        ]

    # 标题页
    assert any("2026 Q1 经营汇报" in t for t in shape_texts(slides[0]))
    assert any("Octop · 4月12日" in t for t in shape_texts(slides[0]))
    # 要点页 + 备注
    assert slides[2].has_notes_slide
    assert "数据口径" in slides[2].notes_slide.notes_text_frame.text
    # 表格页
    tables = [s for s in slides[4].shapes if getattr(s, "has_table", False)]
    assert len(tables) == 1
    assert tables[0].table.cell(0, 0).text == "区域"
    assert tables[0].table.cell(1, 1).text == "120"
    # 图表页
    assert any(getattr(s, "has_chart", False) for s in slides[5].shapes)
    # 图文页图片
    assert any(s.shape_type == MSO_SHAPE_TYPE.PICTURE for s in slides[3].shapes)


# ---------------------------------------------------------------------------
# read_office 读回校验（生成 → 读回闭环）
# ---------------------------------------------------------------------------
def test_read_office_xlsx_roundtrip(tmp_path: Path) -> None:
    out = tmp_path / "report.xlsx"
    _run_script("make_xlsx.py", XLSX_SPEC, out)
    md = tmp_path / "report.md"
    result = _run_script("read_office.py", {"source": str(out)}, md)
    assert result["ok"] is True
    content = md.read_text(encoding="utf-8")
    assert "## Sheet: 销售" in content
    assert "## Sheet: 市场" in content
    assert "| 月份 | 销售额 | 完成率 |" in content
    assert "| 1月 | 12000 | 0.6 |" in content
    assert "=SUM(B2:B4)" in content  # 公式按文本读回


def test_read_office_docx_roundtrip(tmp_path: Path) -> None:
    out = tmp_path / "report.docx"
    _run_script("make_docx.py", _docx_spec(tmp_path), out)
    md = tmp_path / "report.md"
    result = _run_script("read_office.py", {"source": str(out)}, md)
    assert result["ok"] is True
    content = md.read_text(encoding="utf-8")
    assert "# 一、本周进展" in content
    assert "## 1.1 数据指标" in content
    assert "本周完成核心模块联调，性能达标。" in content
    assert "2026 春夏" in content  # 合并表头读回
    assert "> ⚠️ 表格含合并单元格" in content


def test_read_office_pptx_roundtrip(tmp_path: Path) -> None:
    out = tmp_path / "report.pptx"
    _run_script("make_pptx.py", _pptx_spec(tmp_path), out)
    md = tmp_path / "report.md"
    result = _run_script("read_office.py", {"source": str(out)}, md)
    assert result["ok"] is True
    content = md.read_text(encoding="utf-8")
    assert "## Slide 1" in content and "## Slide 7" in content
    assert "> 备注：数据口径：财务月结，税后口径。" in content
    assert "环比增长 18%" in content


def test_read_office_xlsx_truncation(tmp_path: Path) -> None:
    spec = {
        "sheets": [
            {
                "name": "big",
                "columns": [{"key": "i", "title": "序号"}, {"key": "v", "title": "值"}],
                "rows": [{"i": idx, "v": idx * 2} for idx in range(1, 251)],
            }
        ]
    }
    out = tmp_path / "big.xlsx"
    _run_script("make_xlsx.py", spec, out)
    md = tmp_path / "big.md"
    result = _run_script("read_office.py", {"source": str(out), "max_rows": 50}, md)
    assert result["ok"] is True
    content = md.read_text(encoding="utf-8")
    assert "仅显示前 50 行" in content
    assert "共 250 行数据" in content
    table_lines = [ln for ln in content.splitlines() if ln.startswith("|")]
    assert len(table_lines) == 1 + 1 + 50  # 表头 + 分隔线 + 50 数据行


# ---------------------------------------------------------------------------
# convert_pdf
# ---------------------------------------------------------------------------
def test_convert_pdf_missing_libreoffice(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    """无 soffice 环境必须返回 libreoffice-missing，不允许伪造成功。"""
    import convert_pdf

    monkeypatch.setattr(convert_pdf.shutil, "which", lambda _name: None)
    monkeypatch.setattr(convert_pdf, "_SOFFICE_PATHS", ())
    monkeypatch.setattr(convert_pdf, "_SOFFICE_GLOB_PATTERNS", ())
    source = tmp_path / "src.docx"
    source.write_text("not a real docx", encoding="utf-8")
    out = tmp_path / "out.pdf"
    spec_file = tmp_path / "convert.json"
    spec_file.write_text(json.dumps({"source": str(source)}), encoding="utf-8")
    monkeypatch.setattr(
        sys, "argv", ["convert_pdf.py", "--spec", str(spec_file), "--out", str(out)]
    )
    with pytest.raises(SystemExit) as raised:
        convert_pdf.main()
    assert raised.value.code == 0
    payload = json.loads(capsys.readouterr().out.strip())
    assert payload["ok"] is False
    assert payload["reason"] == "libreoffice-missing"
    assert not out.exists()


@pytest.mark.skipif(not HAS_SOFFICE, reason="当前环境没有可用的 soffice / libreoffice")
def test_convert_pdf_actual_conversion(tmp_path: Path) -> None:
    """安装有 LibreOffice 时：docx → 真实 PDF。"""
    src = tmp_path / "src.docx"
    result = _run_script("make_docx.py", _docx_spec(tmp_path), src)
    assert result["ok"] is True
    out = tmp_path / "converted.pdf"
    payload = _run_script(
        "convert_pdf.py",
        {"source": str(src), "timeout": 120},
        out,
    )
    assert payload["ok"] is True
    assert payload["bytes"] > 0
    assert out.read_bytes()[:5] == b"%PDF-"
