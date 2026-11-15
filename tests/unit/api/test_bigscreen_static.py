"""Static mount for the big-screen SPA under ``/screen/*``."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from tests.support.app import ensure_control_plane_bound
from tests.support.auth import bootstrap_admin, login

from octop.api import app as app_module
from octop.api.app import build_app
from octop.infra.server import OctopServer


def _write_bigscreen(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "index.html").write_text(
        '<!doctype html><html><body><div id="root"></div></body></html>',
        encoding="utf-8",
    )
    assets = root / "assets"
    assets.mkdir()
    (assets / "index.abc123.js").write_text("console.log('screen')", encoding="utf-8")
    data = root / "data" / "fgw"
    data.mkdir(parents=True)
    (data / "topics.json").write_text('{"topics": []}', encoding="utf-8")


@asynccontextmanager
async def _client(tmp_path: Path) -> AsyncIterator[httpx.AsyncClient]:
    srv = OctopServer(home=tmp_path)
    await srv.start()
    await ensure_control_plane_bound(srv)
    app = build_app(srv)
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1"
        ) as client:
            yield client
    finally:
        await srv.stop()


async def test_screen_serves_shell_and_assets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "bigscreen"
    _write_bigscreen(root)
    monkeypatch.setattr(app_module, "_bigscreen_dir", lambda: root)

    async with _client(tmp_path) as client:
        await bootstrap_admin(client, tmp_path)
        token = await login(client)

        # SPA routes fall back to the big-screen shell (not the dashboard one).
        shell = await client.get("/screen/fgw/economic")
        assert shell.status_code == 200
        assert '<div id="root">' in shell.text

        asset = await client.get("/screen/assets/index.abc123.js")
        assert asset.status_code == 200
        assert asset.headers["cache-control"].startswith("public")

        # Hashed assets must 404 instead of answering with HTML.
        missing = await client.get("/screen/assets/missing.js")
        assert missing.status_code == 404

        # Missing data files must 404 too — the SPA shell would break JSON parsing.
        missing_data = await client.get(
            "/screen/data/fgw/topics/missing.json",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert missing_data.status_code == 404


async def test_screen_data_requires_login(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    root = tmp_path / "bigscreen"
    _write_bigscreen(root)
    monkeypatch.setattr(app_module, "_bigscreen_dir", lambda: root)

    async with _client(tmp_path) as client:
        await bootstrap_admin(client, tmp_path)
        token = await login(client)

        # Board data files are JWT-gated: no token -> 401.
        blocked = await client.get("/screen/data/fgw/topics.json")
        assert blocked.status_code == 401

        # A valid session can fetch the content.
        allowed = await client.get(
            "/screen/data/fgw/topics.json", headers={"Authorization": f"Bearer {token}"}
        )
        assert allowed.status_code == 200
        assert allowed.json() == {"topics": []}

        # The SPA shell and hashed assets stay public so the login gate loads.
        shell = await client.get("/screen/fgw/economic")
        assert shell.status_code == 200
        asset = await client.get("/screen/assets/index.abc123.js")
        assert asset.status_code == 200


async def test_screen_without_build_shows_hint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = tmp_path / "bigscreen"  # not built
    monkeypatch.setattr(app_module, "_bigscreen_dir", lambda: root)

    async with _client(tmp_path) as client:
        for path in ("/screen", "/screen/", "/screen/fgw/"):
            response = await client.get(path)
            assert response.status_code == 200, path
            assert "大屏尚未构建" in response.text, path

        # Missing hashed assets still 404.
        missing = await client.get("/screen/assets/missing.js")
        assert missing.status_code == 404
