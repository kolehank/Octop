"""Unit tests for search-provider HTTP probes."""

from __future__ import annotations

import json

import httpx
import pytest

from octop.infra.utils import search_probe


def _patch_client(monkeypatch: pytest.MonkeyPatch, handler: httpx.MockTransport) -> None:
    real = httpx.AsyncClient

    def factory(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs = dict(kwargs)
        kwargs["transport"] = handler
        return real(*args, **kwargs)

    monkeypatch.setattr(search_probe.httpx, "AsyncClient", factory)


@pytest.mark.asyncio
async def test_unknown_provider() -> None:
    result = await search_probe.probe_search_provider("nope", {})
    assert result["success"] is False
    assert result["error_type"] == "invalid_config"
    assert result["provider_id"] == "nope"


@pytest.mark.asyncio
async def test_unknown_provider_includes_removed_legacy_ids() -> None:
    # brave / google were removed; probing them must report invalid_config.
    for legacy in ("brave", "google"):
        result = await search_probe.probe_search_provider(legacy, {})
        assert result["success"] is False
        assert result["error_type"] == "invalid_config"


@pytest.mark.asyncio
async def test_tavily_missing_key() -> None:
    result = await search_probe.probe_search_provider("tavily", {})
    assert result["success"] is False
    assert result["error_type"] == "invalid_config"
    assert "TAVILY_API_KEY" in (result.get("error") or "")


@pytest.mark.asyncio
async def test_doubao_missing_key() -> None:
    result = await search_probe.probe_search_provider("doubao", {})
    assert result["success"] is False
    assert result["error_type"] == "invalid_config"
    assert "DOUBAO_SEARCH_API_KEY" in (result.get("error") or "")


@pytest.mark.asyncio
async def test_deepseek_missing_key() -> None:
    result = await search_probe.probe_search_provider("deepseek", {})
    assert result["success"] is False
    assert result["error_type"] == "invalid_config"
    assert "DEEPSEEK_API_KEY" in (result.get("error") or "")


@pytest.mark.asyncio
async def test_exa_missing_key() -> None:
    result = await search_probe.probe_search_provider("exa", {})
    assert result["success"] is False
    assert result["error_type"] == "invalid_config"
    assert "EXA_API_KEY" in (result.get("error") or "")


@pytest.mark.asyncio
async def test_tavily_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.tavily.com"
        assert request.headers.get("Authorization") == "Bearer tvly-test"
        return httpx.Response(200, json={"results": [{"url": "https://example.com"}]})

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "tavily",
        {"TAVILY_API_KEY": "tvly-test"},
    )
    assert result["success"] is True
    assert result["result_count"] == 1
    assert result["provider_id"] == "tavily"


@pytest.mark.asyncio
async def test_tavily_auth_error(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="invalid api key")

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "tavily",
        {"TAVILY_API_KEY": "bad"},
    )
    assert result["success"] is False
    assert result["error_type"] == "auth_error"


@pytest.mark.asyncio
async def test_doubao_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "open.feedcoopapi.com"
        assert request.url.path == "/search_api/global_search"
        assert request.headers.get("Authorization") == "Bearer doubao-key"
        body = request.read()
        assert b'"SearchType"' in body
        return httpx.Response(
            200,
            json={
                "ResponseMetadata": {"RequestId": "r1"},
                "Result": {
                    "TotalDocCount": 1,
                    "ErrorCode": 0,
                    "ErrorMsg": "",
                    "Documents": [
                        {"Title": "T", "Url": "https://example.com"},
                    ],
                },
            },
        )

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "doubao",
        {"DOUBAO_SEARCH_API_KEY": "doubao-key"},
    )
    assert result["success"] is True
    assert result["result_count"] == 1


@pytest.mark.asyncio
async def test_deepseek_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == "https://api.deepseek.com/v1/tools/search"
        assert request.headers.get("Authorization") == "Bearer deepseek-key"
        assert request.read()
        return httpx.Response(200, json={"results": [{"url": "https://example.com"}]})

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "deepseek",
        {"DEEPSEEK_API_KEY": "deepseek-key"},
    )
    assert result["success"] is True
    assert result["result_count"] == 1
    assert result["provider_id"] == "deepseek"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "error_type"),
    [(402, "insufficient_balance"), (429, "rate_limit")],
)
async def test_deepseek_actionable_errors(
    monkeypatch: pytest.MonkeyPatch,
    status: int,
    error_type: str,
) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="probe failed")

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "deepseek",
        {"DEEPSEEK_API_KEY": "deepseek-key"},
    )
    assert result["success"] is False
    assert result["error_type"] == error_type


@pytest.mark.asyncio
async def test_yuanbao_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "api.wsa.cloud.tencent.com"
        assert request.url.path == "/SearchPro"
        assert request.headers.get("Authorization") == "Bearer sk-test"
        body = json.loads(request.content)
        assert body["Query"] == "octop connectivity probe"
        assert body["Cnt"] == 10
        return httpx.Response(
            200,
            json={"Response": {"Pages": ['{"title":"a"}', '{"title":"b"}']}},
        )

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "yuanbao",
        {"TENCENTCLOUD_WSA_APIKEY": "sk-test"},
    )
    assert result["success"] is True
    assert result["result_count"] == 2


@pytest.mark.asyncio
async def test_yuanbao_auth_error_in_body(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={"Response": {"Error": {"Code": "UnauthorizedOperation", "Message": "bad key"}}},
        )

    _patch_client(monkeypatch, httpx.MockTransport(handler))
    result = await search_probe.probe_search_provider(
        "yuanbao",
        {"TENCENTCLOUD_WSA_APIKEY": "sk-bad"},
    )
    assert result["success"] is False
    assert result["error_type"] == "auth_error"
