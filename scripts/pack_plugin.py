#!/usr/bin/env python3
"""Package a plugin directory into an installable ZIP (dashboard upload / URL).

The archive contains exactly one top-level folder (the plugin id) with
``plugin.yaml`` at its root, which satisfies PluginManager.install_archive.
Build artifacts (``node_modules``) and byte-code caches are excluded; the
prebuilt ``ui/dist`` is kept so the receiver never runs npm.

Usage:
    uv run python scripts/pack_plugin.py plugins/octop-design [--out dist/plugins]

Install the result:
    - dashboard 插件页上传 ZIP（POST /api/plugins/install）, or
    - octop plugin install <dir>  (CLI 只接受目录或 URL；本地 ZIP 走 dashboard), or
    - serve the ZIP over HTTP and `octop plugin install https://…/x.zip`.
"""

from __future__ import annotations

import argparse
import re
import sys
import zipfile
from pathlib import Path

# Directories never shipped: local package caches, VCS, venvs, byte-code.
EXCLUDE_DIRS = {
    "node_modules",
    "__pycache__",
    ".git",
    ".venv",
    "venv",
    ".mypy_cache",
    ".ruff_cache",
}
EXCLUDE_SUFFIXES = {".pyc", ".pyo"}
EXCLUDE_NAMES = {".DS_Store"}


def _plugin_meta(plugin_dir: Path) -> tuple[str, str]:
    """Read id/version from plugin.yaml without a YAML dependency."""
    text = (plugin_dir / "plugin.yaml").read_text(encoding="utf-8")
    ident = re.search(r"^id:\s*([A-Za-z0-9_.-]+)\s*$", text, re.M)
    version = re.search(r"^version:\s*([A-Za-z0-9_.+-]+)\s*$", text, re.M)
    if not ident:
        raise SystemExit(f"plugin.yaml missing id: {plugin_dir / 'plugin.yaml'}")
    return ident.group(1), (version.group(1) if version else "0.0.0")


def _iter_files(root: Path) -> list[Path]:
    files: list[Path] = []
    for path in sorted(root.rglob("*")):
        rel_parts = path.relative_to(root).parts
        if any(part in EXCLUDE_DIRS for part in rel_parts):
            continue
        if path.is_dir():
            continue
        if path.suffix in EXCLUDE_SUFFIXES or path.name in EXCLUDE_NAMES:
            continue
        files.append(path)
    return files


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("plugin_dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path("dist/plugins"))
    args = ap.parse_args()

    plugin_dir = args.plugin_dir.resolve()
    if not (plugin_dir / "plugin.yaml").is_file():
        raise SystemExit(f"not a plugin directory (no plugin.yaml): {plugin_dir}")
    if not (plugin_dir / "ui" / "dist").is_dir():
        print(
            "warning: ui/dist missing — run `npm run build` in ui/ before packing "
            "(the receiver runs no npm)",
            file=sys.stderr,
        )

    ident, version = _plugin_meta(plugin_dir)
    args.out.mkdir(parents=True, exist_ok=True)
    archive = args.out / f"{ident}-{version}.zip"

    files = _iter_files(plugin_dir)
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in files:
            zf.write(path, f"{ident}/{path.relative_to(plugin_dir).as_posix()}")

    size = archive.stat().st_size
    print(f"packed {len(files)} files -> {archive} ({size / 1024:.1f} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
