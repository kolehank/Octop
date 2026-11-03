"""tests/unit/test_release_download_links.py"""

from __future__ import annotations

import importlib.util
from pathlib import Path

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "release_download_links.py"


def _load():
    spec = importlib.util.spec_from_file_location("release_download_links", _SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_split_tag_accepts_with_or_without_v() -> None:
    mod = _load()
    assert mod.split_tag("0.9.31") == ("v0.9.31", "0.9.31")
    assert mod.split_tag("v0.9.31") == ("v0.9.31", "0.9.31")


def test_render_download_section_matches_github_asset_names() -> None:
    mod = _load()
    body = mod.render_download_section("0.9.31")
    base = f"https://github.com/{mod.GITHUB_REPO}/releases/download/v0.9.31"
    assert f"{base}/agentbuddy-desktop-windows-amd64-0.9.31.exe" in body
    assert f"{base}/agentbuddy-desktop-windows-arm64-0.9.31.exe" in body
    assert f"{base}/agentbuddy-portable-windows-amd64-0.9.31.zip" in body
    assert f"{base}/agentbuddy-portable-windows-arm64-0.9.31.zip" in body
    assert f"{base}/agentbuddy-desktop-darwin-arm64-0.9.31.dmg" in body
    assert f"{base}/agentbuddy-desktop-darwin-amd64-0.9.31.dmg" in body
    assert f"{base}/agentbuddy-portable-darwin-arm64-0.9.31.zip" in body
    assert f"{base}/agentbuddy-portable-darwin-amd64-0.9.31.zip" in body
    assert f"{base}/agentbuddy-desktop-linux-amd64-0.9.31.tar.gz" in body
    assert f"{base}/agentbuddy-desktop-linux-arm64-0.9.31.tar.gz" in body
    assert f"{base}/agentbuddy-portable-linux-amd64-0.9.31.zip" in body
    assert f"{base}/agentbuddy-portable-linux-arm64-0.9.31.zip" in body
    assert "### fnOS NAS" not in body
    assert "ghcr.io/kolehank/octop:0.9.31" in body
    assert "pip install" not in body
    assert "## Downloads" in body


def test_patch_release_body_refreshes_docker_section() -> None:
    mod = _load()
    body = mod.render_download_section("0.9.31") + "\n## What's Changed\n\n- kept\n"
    present = ["agentbuddy-desktop-windows-amd64-0.9.31.exe"]
    patched = mod.patch_release_body(body, "0.9.31", present)
    assert "ghcr.io/kolehank/octop:0.9.31" in patched
    assert "agentbuddy-desktop-windows-amd64-0.9.31.exe" in patched
    assert "## What's Changed" in patched
    assert "- kept" in patched


def test_patch_release_body_keeps_lite() -> None:
    mod = _load()
    body = mod.render_download_section("0.9.31")
    patched = mod.patch_release_body(body, "v0.9.31", ["agentbuddy-desktop-darwin-arm64-0.9.31.dmg"])
    assert "ghcr.io/kolehank/octop:0.9.31-lite" in patched
