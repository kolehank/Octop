"""Build GitHub Release download-section markdown from a version tag.

Same pattern as clash-verge-rev: interpolate TAG / VERSION into a fixed
filename table. Do not scrape the assets list.

    python3 scripts/release_download_links.py 0.9.31
    python3 scripts/release_download_links.py v0.9.31
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Iterable
from pathlib import Path

GITHUB_REPO = "kolehank/Octop"
DOWNLOAD_BASE = f"https://github.com/{GITHUB_REPO}/releases/download"


def split_tag(raw: str) -> tuple[str, str]:
    """Return ``(tag, version)`` — tag always has a leading ``v``."""
    text = raw.strip()
    if not text:
        raise ValueError("version is empty")
    version = text[1:] if text.startswith("v") else text
    return f"v{version}", version


def asset_url(tag: str, filename: str) -> str:
    return f"{DOWNLOAD_BASE}/{tag}/{filename}"


def md_link(label: str, tag: str, filename: str) -> str:
    return f"[{label}]({asset_url(tag, filename)})"


def desktop_name(os_name: str, arch: str, version: str, ext: str) -> str:
    return f"agentbuddy-desktop-{os_name}-{arch}-{version}.{ext}"


def portable_name(os_name: str, arch: str, version: str) -> str:
    return f"agentbuddy-portable-{os_name}-{arch}-{version}.zip"


def docker_image_section(version: str, *, lite: bool, full: bool) -> str:
    lines = ["### Docker image", ""]
    if lite:
        lines.append(f"- Lite: `ghcr.io/kolehank/octop:{version}` (`:latest`)")
    if full:
        lines.append(f"- Full: `ghcr.io/kolehank/octop:{version}-full` (`:full`)")
    if len(lines) == 2:
        return ""
    return "\n".join(lines)


def render_download_section(raw_version: str) -> str:
    tag, version = split_tag(raw_version)
    win64 = md_link("64-bit (Recommended)", tag, desktop_name("windows", "amd64", version, "exe"))
    win_arm = md_link("ARM64", tag, desktop_name("windows", "arm64", version, "exe"))
    win64_zip = md_link("64-bit", tag, portable_name("windows", "amd64", version))
    win_arm_zip = md_link("ARM64", tag, portable_name("windows", "arm64", version))
    mac_arm = md_link("Apple Silicon", tag, desktop_name("darwin", "arm64", version, "dmg"))
    mac_intel = md_link("Intel", tag, desktop_name("darwin", "amd64", version, "dmg"))
    mac_arm_zip = md_link("Apple Silicon", tag, portable_name("darwin", "arm64", version))
    mac_intel_zip = md_link("Intel", tag, portable_name("darwin", "amd64", version))
    linux64 = md_link("64-bit", tag, desktop_name("linux", "amd64", version, "tar.gz"))
    linux_arm = md_link("ARM64", tag, desktop_name("linux", "arm64", version, "tar.gz"))
    linux64_zip = md_link("64-bit", tag, portable_name("linux", "amd64", version))
    linux_arm_zip = md_link("ARM64", tag, portable_name("linux", "arm64", version))
    return "\n".join(
        [
            "",
            "## Downloads",
            "",
            "### Windows",
            "",
            "#### Desktop installer (Recommended)",
            f"- {win64} | {win_arm}",
            "",
            "#### Portable",
            f"- {win64_zip} | {win_arm_zip}",
            "",
            "### macOS",
            "",
            "#### Desktop installer (Recommended)",
            f"- {mac_arm} | {mac_intel}",
            "",
            "#### Portable",
            f"- {mac_arm_zip} | {mac_intel_zip}",
            "",
            "### Linux",
            "",
            "#### Desktop installer (Recommended)",
            f"- {linux64} | {linux_arm}",
            "",
            "#### Portable",
            f"- {linux64_zip} | {linux_arm_zip}",
            "",
            docker_image_section(version, lite=True, full=True),
            "",
        ]
    )


def _replace_section(body: str, heading: str, replacement: str) -> str:
    """Replace one ``###`` block. An empty replacement removes that block."""
    marker = f"### {heading}\n"
    start = body.find(marker)
    if start < 0:
        if not replacement.strip():
            return body
        return body.rstrip() + "\n\n" + replacement.strip() + "\n"
    rest_at = start + len(marker)
    consumed = 0
    for line in body[rest_at:].splitlines(keepends=True):
        if line.startswith("## ") or line.startswith("### "):
            break
        consumed += len(line)
    end = rest_at + consumed
    prefix = body[:start].rstrip()
    suffix = body[end:].lstrip("\n")
    parts = [part for part in (prefix, replacement.strip(), suffix) if part]
    return "\n\n".join(parts) + "\n"


def patch_release_body(body: str, raw_version: str, present: Iterable[str]) -> str:
    """Keep desktop links, and refresh the Docker section.

    Unlike upstream, the Octop images carry no release asset that announces
    which variants exist: ``:latest`` (lite) is always published and ``:full``
    is published when both CPU architectures exist. Both lines stay rendered.
    """
    _tag, version = split_tag(raw_version)
    return _replace_section(body, "Docker image", docker_image_section(version, lite=True, full=True))


def _asset_names(payload: dict[str, object]) -> list[str]:
    assets = payload.get("assets")
    if not isinstance(assets, list):
        raise ValueError("release JSON has no assets list")
    names: list[str] = []
    for asset in assets:
        if isinstance(asset, str):
            names.append(asset)
            continue
        if isinstance(asset, dict) and isinstance(asset.get("name"), str):
            names.append(asset["name"])
            continue
        raise ValueError("release asset is missing a name")
    return names


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print Octop GitHub Release download markdown.")
    parser.add_argument("version", help="Package version, with or without a leading v")
    parser.add_argument(
        "--sync-notes",
        type=Path,
        help="Rewrite Docker section from a `gh release view --json body,assets` file.",
    )
    args = parser.parse_args(argv)
    if args.sync_notes is None:
        sys.stdout.write(render_download_section(args.version))
        return 0
    payload = json.loads(args.sync_notes.read_text(encoding="utf-8"))
    body = payload.get("body")
    if not isinstance(body, str):
        raise ValueError("release JSON has no body")
    sys.stdout.write(patch_release_body(body, args.version, _asset_names(payload)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())