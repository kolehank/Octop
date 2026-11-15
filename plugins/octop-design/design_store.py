"""OpenDesign data store — pure filesystem logic with an injected base dir.

Design documents live under ``<base>/designs/<slug>/``:

    index.html        current draft (single source of truth)
    meta.json         {rev, sha256, title, updated_at, tool_call_id, ...}
    annotations.json  [{id, selector, tag, text, note, rect, created_at, status}]
    history/          vNNNN.html snapshots (one per previous revision)

Contract (inherited from the Cindy OpenDesign plugin):

* ``rev`` is monotonically increasing. Every writes that changes the draft
  room ``rev`` by one.
* ``meta.sha256`` is the sha256 of the on-disk ``index.html``. If the current
  file no longer matches the recorded hash (edited outside the store), any
  update is rejected so we never silently overwrite foreign edits.
* ``design_update`` compares the caller's ``expected_revision`` against the
  current ``rev`` first; a mismatch raises :class:`RevisionConflictError`
  and nothing is written.
* The previous draft is snapshotted into ``history/`` before the new one is
  written. Only the most recent :data:`HISTORY_LIMIT` snapshots are kept.

The module intentionally imports nothing from octop / langgraph / the harness,
so it can be unit-tested against ``tmp_path`` and reused by any process that
supplies a base directory. The plugin entry point (``main.py``) resolves that
base from the current agent id.
"""

from __future__ import annotations

import contextlib
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

HISTORY_LIMIT = 20
DESIGNS_DIR_NAME = "designs"
HISTORY_DIR_NAME = "history"
INDEX_FILENAME = "index.html"
META_FILENAME = "meta.json"
ANNOTATIONS_FILENAME = "annotations.json"

ACTIVE_ANNOTATION_STATUSES = ("open",)
DONE_ANNOTATION_STATUS = "done"

_SLUG_SEP_RE = re.compile(r"[^\w-]+")
_SLUG_DASH_RE = re.compile(r"-+")
_HISTORY_FILE_RE = re.compile(r"^v(\d{4,})\.html$")


class DesignError(Exception):
    """Base class for OpenDesign store errors."""


class DesignNotFoundError(DesignError):
    def __init__(self, slug: str) -> None:
        super().__init__(f"design {slug!r} not found")
        self.slug = slug


class DesignExistsError(DesignError):
    def __init__(self, slug: str) -> None:
        super().__init__(f"design {slug!r} already exists; use design_update instead")
        self.slug = slug


class RevisionConflictError(DesignError):
    """Concurrent-write guard: the on-disk draft is no longer at the expected revision."""

    def __init__(
        self,
        slug: str,
        expected: int,
        current: int,
        *,
        reason: str = "revision mismatch",
    ) -> None:
        super().__init__(
            f"design {slug!r} conflict: expected rev {expected}, current rev {current} ({reason})"
        )
        self.slug = slug
        self.expected = expected
        self.current = current
        self.reason = reason


@dataclass(frozen=True)
class DesignMeta:
    slug: str
    title: str
    rev: int
    sha256: str
    updated_at: str
    tool_call_id: str
    created_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "title": self.title,
            "rev": self.rev,
            "sha256": self.sha256,
            "updated_at": self.updated_at,
            "tool_call_id": self.tool_call_id,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DesignMeta:
        slug = str(data.get("slug") or "")
        if not slug:
            raise ValueError("meta.json is missing 'slug'")
        return cls(
            slug=slug,
            title=str(data.get("title") or slug),
            rev=int(data.get("rev") or 0),
            sha256=str(data.get("sha256") or ""),
            updated_at=str(data.get("updated_at") or ""),
            tool_call_id=str(data.get("tool_call_id") or ""),
            created_at=str(data.get("created_at") or ""),
        )


@dataclass(frozen=True)
class HistoryEntry:
    rev: int
    file: str
    created_at: str
    size: int
    sha256: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "rev": self.rev,
            "file": self.file,
            "created_at": self.created_at,
            "size": self.size,
            "sha256": self.sha256,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> HistoryEntry:
        return cls(
            rev=int(data.get("rev") or 0),
            file=str(data.get("file") or ""),
            created_at=str(data.get("created_at") or ""),
            size=int(data.get("size") or 0),
            sha256=str(data.get("sha256") or ""),
        )


def slugify(raw: str) -> str:
    """Turn a title / slug hint into a filesystem-safe slug.

    Keeps unicode word characters (so Chinese titles stay readable in paths),
    collapses runs of separators and trims dashes. Empty results fall back to
    ``"design"``.
    """
    text = str(raw or "").strip().lower()
    text = _SLUG_SEP_RE.sub("-", text)
    text = _SLUG_DASH_RE.sub("-", text).strip("-")
    return text or "design"


def _sha256_hex(html: str) -> str:
    return hashlib.sha256(html.encode("utf-8")).hexdigest()


def _iso(now: datetime | None) -> str:
    return (now or datetime.now(UTC)).isoformat()


def design_dir(base: Path, slug: str) -> Path:
    return base / DESIGNS_DIR_NAME / slug


def history_dir(base: Path, slug: str) -> Path:
    return design_dir(base, slug) / HISTORY_DIR_NAME


def index_path(base: Path, slug: str) -> Path:
    return design_dir(base, slug) / INDEX_FILENAME


def meta_path(base: Path, slug: str) -> Path:
    return design_dir(base, slug) / META_FILENAME


def annotations_path(base: Path, slug: str) -> Path:
    return design_dir(base, slug) / ANNOTATIONS_FILENAME


def design_exists(base: Path, slug: str) -> bool:
    return index_path(base, slug).is_file()


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def read_meta(base: Path, slug: str) -> DesignMeta | None:
    path = meta_path(base, slug)
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DesignError(f"cannot read meta for {slug!r}: {exc}") from exc
    if not isinstance(data, dict):
        raise DesignError(f"malformed meta for {slug!r}: not a JSON object")
    try:
        return DesignMeta.from_dict(data)
    except (TypeError, ValueError) as exc:
        raise DesignError(f"malformed meta for {slug!r}: {exc}") from exc


def read_html(base: Path, slug: str) -> str:
    path = index_path(base, slug)
    if not path.is_file():
        raise DesignNotFoundError(slug)
    return path.read_text(encoding="utf-8")


def read_annotations(base: Path, slug: str) -> list[dict[str, Any]]:
    path = annotations_path(base, slug)
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DesignError(f"cannot read annotations for {slug!r}: {exc}") from exc
    if not isinstance(data, list):
        raise DesignError(f"malformed annotations for {slug!r}: not a JSON array")
    return [item for item in data if isinstance(item, dict)]


def list_history(base: Path, slug: str) -> list[HistoryEntry]:
    """Snapshots in ``history/``, newest first.

    The rev is parsed from the ``vNNNN.html`` filename; ``created_at`` is the
    file mtime (snapshots are immutable once written, so mtime is stable).
    """
    if not design_exists(base, slug):
        raise DesignNotFoundError(slug)
    directory = history_dir(base, slug)
    if not directory.is_dir():
        return []
    entries: list[HistoryEntry] = []
    for path in directory.iterdir():
        match = _HISTORY_FILE_RE.match(path.name)
        if not path.is_file() or match is None:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        entries.append(
            HistoryEntry(
                rev=int(match.group(1)),
                file=path.name,
                created_at=_iso_from_timestamp(stat.st_mtime),
                size=stat.st_size,
            ),
        )
    entries.sort(key=lambda entry: entry.rev, reverse=True)
    return entries


def _iso_from_timestamp(ts: float) -> str:
    return datetime.fromtimestamp(ts, tz=UTC).isoformat()


def read_snapshot(base: Path, slug: str, rev: int) -> str:
    """Read a history snapshot's html for the given revision."""
    directory = history_dir(base, slug)
    path = directory / f"v{int(rev):04d}.html"
    if not path.is_file():
        raise DesignNotFoundError(f"{slug} history rev {rev}")
    return path.read_text(encoding="utf-8")


def read_context(base: Path, slug: str) -> dict[str, Any]:
    """Full document view used by agent-facing tools (html + meta + notes + history)."""
    if not design_exists(base, slug):
        raise DesignNotFoundError(slug)
    meta = read_meta(base, slug)
    entries = list_history(base, slug)
    return {
        "slug": slug,
        "title": meta.title if meta is not None else slug,
        "rev": meta.rev if meta is not None else 0,
        "sha256": meta.sha256 if meta is not None else "",
        "updated_at": meta.updated_at if meta is not None else "",
        "created_at": meta.created_at if meta is not None else "",
        "html": read_html(base, slug),
        "annotations": read_annotations(base, slug),
        "history": [entry.to_dict() for entry in entries],
    }


def list_designs(base: Path) -> list[dict[str, Any]]:
    """Directory of every design under ``base/designs/`` (for ``slug``-less calls)."""
    root = base / DESIGNS_DIR_NAME
    if not root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for candidate in sorted(root.iterdir()):
        if not candidate.is_dir() or not design_exists(base, candidate.name):
            continue
        meta = read_meta(base, candidate.name)
        out.append(
            {
                "slug": candidate.name,
                "title": meta.title if meta is not None else candidate.name,
                "rev": meta.rev if meta is not None else 0,
                "updated_at": meta.updated_at if meta is not None else "",
            },
        )
    return out


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def create_design(
    base: Path,
    slug: str,
    html: str,
    *,
    title: str = "",
    tool_call_id: str = "",
    now: datetime | None = None,
) -> DesignMeta:
    """Create ``slug`` at rev 1. Raises :class:`DesignExistsError` if it exists."""
    if design_exists(base, slug):
        raise DesignExistsError(slug)
    stamped = _iso(now)
    directory = design_dir(base, slug)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / HISTORY_DIR_NAME).mkdir(parents=True, exist_ok=True)
    meta = DesignMeta(
        slug=slug,
        title=title.strip() or slug,
        rev=1,
        sha256=_sha256_hex(html),
        updated_at=stamped,
        tool_call_id=tool_call_id,
        created_at=stamped,
    )
    index_path(base, slug).write_text(html, encoding="utf-8")
    _write_json(meta_path(base, slug), meta.to_dict())
    _write_json(annotations_path(base, slug), [])
    return meta


def _assert_updatable(
    base: Path, slug: str, expected_revision: int | None
) -> tuple[DesignMeta, str]:
    """Shared pre-write guard for every draft-mutating store operation."""
    if not design_exists(base, slug):
        raise DesignNotFoundError(slug)
    meta = read_meta(base, slug)
    if meta is None:
        raise DesignError(f"design {slug!r} has no meta.json; recreate it")
    if expected_revision is not None and expected_revision != meta.rev:
        raise RevisionConflictError(
            slug,
            expected=expected_revision,
            current=meta.rev,
            reason="expectedRevision mismatch",
        )
    on_disk_sha = _sha256_hex(read_html(base, slug))
    if meta.sha256 and on_disk_sha != meta.sha256:
        raise RevisionConflictError(
            slug,
            expected=expected_revision if expected_revision is not None else meta.rev,
            current=meta.rev,
            reason="index.html changed outside the design tools",
        )
    return meta, on_disk_sha


def _snapshot_and_write(
    base: Path,
    slug: str,
    meta: DesignMeta,
    html: str,
    *,
    title: str,
    tool_call_id: str,
    now: datetime | None,
) -> DesignMeta:
    """Copy the current draft into ``history/``, then write the new draft + meta."""
    old_html = read_html(base, slug)
    history = history_dir(base, slug)
    history.mkdir(parents=True, exist_ok=True)
    snapshot = history / f"v{meta.rev:04d}.html"
    if not snapshot.is_file():
        snapshot.write_text(old_html, encoding="utf-8")

    stamped = _iso(now)
    directory = design_dir(base, slug)
    directory.mkdir(parents=True, exist_ok=True)
    index_path(base, slug).write_text(html, encoding="utf-8")
    next_meta = DesignMeta(
        slug=slug,
        title=title.strip() or meta.title,
        rev=meta.rev + 1,
        sha256=_sha256_hex(html),
        updated_at=stamped,
        tool_call_id=tool_call_id,
        created_at=meta.created_at,
    )
    _write_json(meta_path(base, slug), next_meta.to_dict())
    _trim_history(base, slug, limit=HISTORY_LIMIT)
    return next_meta


def _trim_history(base: Path, slug: str, *, limit: int) -> None:
    """Drop the oldest snapshots so at most ``limit`` remain."""
    directory = history_dir(base, slug)
    if not directory.is_dir():
        return
    snapshots: list[tuple[int, Path]] = []
    for path in directory.iterdir():
        match = _HISTORY_FILE_RE.match(path.name)
        if path.is_file() and match is not None:
            snapshots.append((int(match.group(1)), path))
    snapshots.sort(key=lambda item: item[0])
    for _, path in snapshots[: max(0, len(snapshots) - limit)]:
        with contextlib.suppress(OSError):
            path.unlink()


def update_design(
    base: Path,
    slug: str,
    html: str,
    *,
    expected_revision: int | None = None,
    title: str = "",
    tool_call_id: str = "",
    now: datetime | None = None,
) -> DesignMeta:
    """Write a new draft, guarded by the revision / sha256 conflict checks."""
    meta, _ = _assert_updatable(base, slug, expected_revision)
    return _snapshot_and_write(
        base,
        slug,
        meta,
        html,
        title=title,
        tool_call_id=tool_call_id,
        now=now,
    )


def replace_annotations(
    base: Path, slug: str, annotations: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Overwrite the annotations file (Dashboard UI is the primary writer)."""
    if not design_exists(base, slug):
        raise DesignNotFoundError(slug)
    normalized: list[dict[str, Any]] = []
    for item in annotations:
        if not isinstance(item, dict):
            raise ValueError("annotations must be a list of objects")
        record = dict(item)
        if not str(record.get("id") or "").strip():
            raise ValueError("every annotation needs a non-empty 'id'")
        record.setdefault("status", ACTIVE_ANNOTATION_STATUSES[0])
        normalized.append(record)
    _write_json(annotations_path(base, slug), normalized)
    return normalized


def consume_annotations(
    base: Path,
    slug: str,
    ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Mark annotations as processed (``status="done"``) for the agent's read-back.

    ``ids`` select which notes to close; ``None`` (or ``[]``) closes everything.
    The result is the updated list, also returned by ``design_annotations``.
    """
    current = read_annotations(base, slug)
    if not current:
        return current
    selected = set(ids or [])
    updated: list[dict[str, Any]] = []
    for item in current:
        next_item = dict(item)
        if not selected or str(next_item.get("id") or "") in selected:
            next_item["status"] = DONE_ANNOTATION_STATUS
        updated.append(next_item)
    return replace_annotations(base, slug, updated)
