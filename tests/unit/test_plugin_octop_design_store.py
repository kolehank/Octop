"""Unit tests for the OpenDesign plugin design store (plugins/octop-design).

The store is deliberately octop-free: it takes an injected base directory, so
these tests run against ``tmp_path`` with no server / harness.
"""

from __future__ import annotations

import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

_PLUGIN_DIR = Path(__file__).resolve().parents[2] / "plugins" / "octop-design"


def _load_module(name: str):
    spec = importlib.util.spec_from_file_location(
        f"octop_design_{name}",
        _PLUGIN_DIR / f"{name}.py",
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # Register before exec so dataclasses can resolve ``cls.__module__``.
    import sys

    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(spec.name, None)
    return module


store = _load_module("design_store")

FIXED_NOW = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)

HTML_V1 = "<!doctype html><html><body><h1>v1</h1></body></html>"
HTML_V2 = "<!doctype html><html><body><h1>v2</h1></body></html>"


def _read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_designs(base: Path, slug: str, html: str, *, revs: int = 3) -> None:
    """create + ``revs - 1`` updates, leaving the design at current rev ``revs``."""
    store.create_design(base, slug, html, title="Landing", now=FIXED_NOW)
    for index in range(2, revs + 1):
        store.update_design(
            base,
            slug,
            f"<!doctype html><html><body><h1>v{index}</h1></body></html>",
            expected_revision=index - 1,
            now=FIXED_NOW,
        )


def test_create_writes_expected_layout(tmp_path: Path) -> None:
    meta = store.create_design(tmp_path, "landing", HTML_V1, title="Landing", now=FIXED_NOW)

    root = store.design_dir(tmp_path, "landing")
    assert root.is_dir()
    assert (root / "index.html").read_text(encoding="utf-8") == HTML_V1
    assert (root / "history").is_dir()

    meta_dict = _read_json(root / "meta.json")
    assert meta_dict["slug"] == "landing"
    assert meta_dict["title"] == "Landing"
    assert meta_dict["rev"] == 1
    assert meta_dict["updated_at"] == FIXED_NOW.isoformat()
    assert meta_dict["created_at"] == FIXED_NOW.isoformat()
    assert meta_dict["sha256"] == store._sha256_hex(HTML_V1)

    assert _read_json(root / "annotations.json") == []
    assert meta.rev == 1
    assert store.design_exists(tmp_path, "landing")


def test_create_duplicate_is_rejected(tmp_path: Path) -> None:
    store.create_design(tmp_path, "landing", HTML_V1, now=FIXED_NOW)
    with pytest.raises(store.DesignExistsError):
        store.create_design(tmp_path, "landing", HTML_V2, now=FIXED_NOW)
    # First draft untouched.
    assert (store.design_dir(tmp_path, "landing") / "index.html").read_text() == HTML_V1


def test_update_bumps_revision_and_snapshots_previous(tmp_path: Path) -> None:
    store.create_design(tmp_path, "landing", HTML_V1, title="Landing", now=FIXED_NOW)
    meta = store.update_design(
        tmp_path,
        "landing",
        HTML_V2,
        expected_revision=1,
        now=FIXED_NOW,
    )

    assert meta.rev == 2
    assert (store.index_path(tmp_path, "landing")).read_text(encoding="utf-8") == HTML_V2

    snapshot = store.history_dir(tmp_path, "landing") / "v0001.html"
    assert snapshot.is_file()
    assert snapshot.read_text(encoding="utf-8") == HTML_V1

    meta_dict = _read_json(store.meta_path(tmp_path, "landing"))
    assert meta_dict["rev"] == 2
    assert meta_dict["sha256"] == store._sha256_hex(HTML_V2)
    assert meta_dict["updated_at"] == FIXED_NOW.isoformat()


def test_update_with_stale_expected_revision_is_conflict(tmp_path: Path) -> None:
    store.create_design(tmp_path, "landing", HTML_V1, now=FIXED_NOW)
    store.update_design(tmp_path, "landing", HTML_V2, expected_revision=1, now=FIXED_NOW)

    with pytest.raises(store.RevisionConflictError) as raised:
        store.update_design(
            tmp_path,
            "landing",
            "<h1>should not land</h1>",
            expected_revision=1,  # stale — current rev is 2
            now=FIXED_NOW,
        )
    assert raised.value.expected == 1
    assert raised.value.current == 2

    # Nothing was written: content, meta and history are unchanged.
    assert (store.index_path(tmp_path, "landing")).read_text(encoding="utf-8") == HTML_V2
    meta_dict = _read_json(store.meta_path(tmp_path, "landing"))
    assert meta_dict["rev"] == 2
    assert list(store.history_dir(tmp_path, "landing").iterdir()) == [
        store.history_dir(tmp_path, "landing") / "v0001.html"
    ]


def test_update_detects_external_tamper(tmp_path: Path) -> None:
    store.create_design(tmp_path, "landing", HTML_V1, now=FIXED_NOW)
    # Someone edits index.html behind the store's back.
    (store.index_path(tmp_path, "landing")).write_text("<h1>hacked</h1>", encoding="utf-8")

    with pytest.raises(store.RevisionConflictError) as raised:
        store.update_design(
            tmp_path,
            "landing",
            HTML_V2,
            expected_revision=1,  # rev matches, sha256 does not
            now=FIXED_NOW,
        )
    assert "changed outside" in raised.value.reason
    assert (store.index_path(tmp_path, "landing")).read_text(encoding="utf-8") == "<h1>hacked</h1>"


def test_update_unknown_design_raises(tmp_path: Path) -> None:
    with pytest.raises(store.DesignNotFoundError):
        store.update_design(tmp_path, "nope", HTML_V2, expected_revision=1, now=FIXED_NOW)


def test_history_rolled_to_latest_20(tmp_path: Path) -> None:
    _write_designs(tmp_path, "landing", HTML_V1, revs=26)  # snapshots v0001..v0025

    entries = store.list_history(tmp_path, "landing")
    assert len(entries) == 20
    # Newest snapshots first (the design itself is at rev 26).
    assert entries[0].rev == 25
    assert entries[-1].rev == 6  # v0001..v0005 were dropped

    history = store.history_dir(tmp_path, "landing")
    files = sorted(history.glob("*.html"))
    assert len(files) == 20
    assert files[0].name == "v0006.html"
    assert files[-1].name == "v0025.html"
    # Oldest snapshots no longer on disk.
    assert not (history / "v0001.html").exists()
    assert not (history / "v0005.html").exists()


def test_context_returns_full_document_view(tmp_path: Path) -> None:
    _write_designs(tmp_path, "landing", HTML_V1, revs=3)
    store.replace_annotations(
        tmp_path,
        "landing",
        [
            {
                "id": "a-1",
                "selector": "h1",
                "tag": "h1",
                "text": "v1",
                "note": "主标题要更大",
                "created_at": FIXED_NOW.isoformat(),
                "status": "open",
            }
        ],
    )

    context = store.read_context(tmp_path, "landing")
    assert context["slug"] == "landing"
    assert context["rev"] == 3
    assert context["html"] == "<!doctype html><html><body><h1>v3</h1></body></html>"
    assert context["annotations"][0]["note"] == "主标题要更大"
    assert [entry["rev"] for entry in context["history"]] == [2, 1]

    with pytest.raises(store.DesignNotFoundError):
        store.read_context(tmp_path, "missing")


def test_list_designs_indexes_existing_only(tmp_path: Path) -> None:
    store.create_design(tmp_path, "alpha", HTML_V1, title="Alpha", now=FIXED_NOW)
    store.create_design(tmp_path, "beta", HTML_V1, title="Beta", now=FIXED_NOW)
    # A directory without index.html must not show up.
    (tmp_path / "designs" / "ghost").mkdir(parents=True)

    designs = store.list_designs(tmp_path)
    assert [d["slug"] for d in designs] == ["alpha", "beta"]
    assert designs[0]["rev"] == 1


def test_annotations_replace_validate_and_consume(tmp_path: Path) -> None:
    store.create_design(tmp_path, "landing", HTML_V1, now=FIXED_NOW)

    items = [
        {"id": "a-1", "selector": "h1", "note": "改文案", "status": "open"},
        {"id": "a-2", "selector": "p", "note": "改颜色"},
    ]
    stored = store.replace_annotations(tmp_path, "landing", items)
    # Missing status defaults to open; ids required.
    assert stored[1]["status"] == "open"
    assert _read_json(store.annotations_path(tmp_path, "landing")) == stored

    with pytest.raises(ValueError):
        store.replace_annotations(tmp_path, "landing", [{"selector": "no-id"}])

    consumed = store.consume_annotations(tmp_path, "landing", ids=["a-2"])
    by_id = {item["id"]: item for item in consumed}
    assert by_id["a-1"]["status"] == "open"
    assert by_id["a-2"]["status"] == "done"

    all_done = store.consume_annotations(tmp_path, "landing")
    assert all(item["status"] == "done" for item in all_done)


def test_slugify_normalizes_titles(tmp_path: Path) -> None:
    assert store.slugify("落地页 Landing Page!") == "落地页-landing-page"
    assert store.slugify("---  My  Draft ---") == "my-draft"
    assert store.slugify("!!!") == "design"
