"""Tests for graph_client.py — retry, error classification, idempotency."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
import requests

from src.graph_client import (
    GraphClient,
    GraphError,
    NotFoundError,
    PermissionError,
    TokenError,
    _compute_delay,
    _is_retryable_msal_error,
)


# ---------------------------------------------------------------------------
# Fake AppConfig for testing
# ---------------------------------------------------------------------------


@dataclass
class FakeAppConfig:
    identity_id: str = "fake-app-id"
    tenant_id: str = "fake-tenant-id"
    client_secret: str = "fake-secret"

    @property
    def authority(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}"


# ---------------------------------------------------------------------------
# Helper: create GraphClient with mocked MSAL internals
# ---------------------------------------------------------------------------


def _make_client(cfg: FakeAppConfig | None = None) -> GraphClient:
    """Create GraphClient with MSAL internals mocked to avoid network calls."""
    if cfg is None:
        cfg = FakeAppConfig()
    with patch("msal.ConfidentialClientApplication") as MockApp:
        mock_app = MockApp.return_value
        mock_app.acquire_token_for_client = MagicMock()
        client = GraphClient(cfg)
        # Replace the internal _app with our mock for direct token tests
        client._app = mock_app
        return client


def _make_client_with_token(token: str = "fake-token") -> GraphClient:
    """Create a GraphClient pre-configured with a working token mock."""
    client = _make_client()
    client._app.acquire_token_for_client.return_value = {"access_token": token}
    return client


# ---------------------------------------------------------------------------
# _compute_delay
# ---------------------------------------------------------------------------


class TestComputeDelay:
    def test_base_delays(self) -> None:
        """Base delays: 1s, 2s, 4s with jitter 0.5-1.0x."""
        for attempt, base in enumerate([1.0, 2.0, 4.0]):
            delay = _compute_delay(attempt)
            assert base * 0.5 <= delay <= base * 1.0

    def test_retry_after_overrides(self) -> None:
        delay = _compute_delay(0, retry_after=5)
        assert delay == 5.0

    def test_retry_after_capped(self) -> None:
        delay = _compute_delay(0, retry_after=120)
        assert delay == 60.0  # MAX_RETRY_AFTER

    def test_retry_after_none(self) -> None:
        delay = _compute_delay(0, retry_after=None)
        assert 0.5 <= delay <= 1.0


# ---------------------------------------------------------------------------
# _is_retryable_msal_error
# ---------------------------------------------------------------------------


class TestMSALErrorClassification:
    def test_retryable_errors(self) -> None:
        for code in ["temporarily_unavailable", "AADSTS50033", "AADSTS90006"]:
            assert _is_retryable_msal_error(code), f"{code} should be retryable"

    def test_terminal_errors(self) -> None:
        for code in ["invalid_client", "invalid_grant", "AADSTS70002"]:
            assert not _is_retryable_msal_error(code), f"{code} should be terminal"

    def test_unknown_error(self) -> None:
        assert not _is_retryable_msal_error("completely_unknown_code")


# ---------------------------------------------------------------------------
# GraphClient — retry policy (_request)
# ---------------------------------------------------------------------------


class TestRequestRetry:
    def test_success_first_try(self) -> None:
        client = _make_client_with_token()

        mock_resp = MagicMock(spec=requests.Response)
        mock_resp.status_code = 200

        with patch.object(client._session, "request", return_value=mock_resp):
            resp = client._request("GET", "https://example.com")
            assert resp.status_code == 200

    def test_retry_on_5xx(self) -> None:
        client = _make_client_with_token()

        fail_500 = MagicMock(spec=requests.Response)
        fail_500.status_code = 500
        fail_500.text = "Internal Server Error"
        success = MagicMock(spec=requests.Response)
        success.status_code = 200

        with patch.object(client._session, "request",
                          side_effect=[fail_500, fail_500, success]) as mock_req, \
             patch("src.graph_client.time.sleep", return_value=None) as mock_sleep:
            resp = client._request("GET", "https://example.com")
            assert resp.status_code == 200
            assert mock_req.call_count == 3
            assert mock_sleep.call_count == 2

    def test_retry_exhaustion_on_5xx(self) -> None:
        client = _make_client_with_token()

        fail_500 = MagicMock(spec=requests.Response)
        fail_500.status_code = 500
        fail_500.text = "Internal Server Error"

        with patch.object(client._session, "request", return_value=fail_500), \
             patch("src.graph_client.time.sleep", return_value=None):
            with pytest.raises(GraphError) as exc_info:
                client._request("GET", "https://example.com")
            assert "Server error" in str(exc_info.value)

    def test_retry_on_429(self) -> None:
        client = _make_client_with_token()

        fail_429 = MagicMock(spec=requests.Response)
        fail_429.status_code = 429
        fail_429.text = "Too many requests"
        fail_429.headers = {"Retry-After": "1"}
        success = MagicMock(spec=requests.Response)
        success.status_code = 200

        with patch.object(client._session, "request",
                          side_effect=[fail_429, success]) as mock_req, \
             patch("src.graph_client.time.sleep", return_value=None) as mock_sleep:
            resp = client._request("GET", "https://example.com")
            assert resp.status_code == 200
            assert mock_req.call_count == 2
            args, _ = mock_sleep.call_args
            assert args[0] == 1.0

    def test_no_retry_on_4xx_except_429(self) -> None:
        client = _make_client_with_token()

        fail_400 = MagicMock(spec=requests.Response)
        fail_400.status_code = 400
        fail_400.reason = "Bad Request"
        fail_400.json = MagicMock(return_value={"error": {"code": "BadRequest", "message": "nope"}})

        with patch.object(client._session, "request", return_value=fail_400) as mock_req:
            with pytest.raises(GraphError):
                client._request("GET", "https://example.com")
            assert mock_req.call_count == 1  # No retry

    def test_retry_on_connection_error(self) -> None:
        client = _make_client_with_token()

        with patch.object(client._session, "request",
                          side_effect=[
                              requests.ConnectionError("connection refused"),
                              requests.ConnectionError("connection refused"),
                              MagicMock(spec=requests.Response, status_code=200),
                          ]) as mock_req, \
             patch("src.graph_client.time.sleep", return_value=None) as mock_sleep:
            resp = client._request("GET", "https://example.com")
            assert resp.status_code == 200
            assert mock_req.call_count == 3
            assert mock_sleep.call_count == 2

    def test_retry_on_timeout(self) -> None:
        client = _make_client_with_token()

        with patch.object(client._session, "request",
                          side_effect=[
                              requests.Timeout("timed out"),
                              MagicMock(spec=requests.Response, status_code=200),
                          ]) as mock_req, \
             patch("src.graph_client.time.sleep", return_value=None):
            resp = client._request("GET", "https://example.com")
            assert resp.status_code == 200
            assert mock_req.call_count == 2


# ---------------------------------------------------------------------------
# GraphClient — error classification
# ---------------------------------------------------------------------------


class TestErrorClassification:
    def test_403_raises_permission_error(self) -> None:
        client = _make_client_with_token()

        fail_403 = MagicMock(spec=requests.Response)
        fail_403.status_code = 403
        fail_403.json = MagicMock(return_value={
            "error": {"code": "Authorization_RequestDenied", "message": "Insufficient privileges"}
        })

        with patch.object(client._session, "request", return_value=fail_403):
            with pytest.raises(PermissionError) as exc_info:
                client._request("GET", "https://example.com")
            assert "Insufficient permissions" in str(exc_info.value)

    def test_404_raises_not_found_error(self) -> None:
        client = _make_client_with_token()

        fail_404 = MagicMock(spec=requests.Response)
        fail_404.status_code = 404
        fail_404.json = MagicMock(return_value={
            "error": {"code": "Request_ResourceNotFound", "message": "Resource not found"}
        })

        with patch.object(client._session, "request", return_value=fail_404):
            with pytest.raises(NotFoundError) as exc_info:
                client._request("GET", "https://example.com")
            assert "Request_ResourceNotFound" in str(exc_info.value)


# ---------------------------------------------------------------------------
# GraphClient — existence checks
# ---------------------------------------------------------------------------


class TestExistenceChecks:
    def test_check_user_exists_true(self) -> None:
        client = _make_client_with_token()
        with patch.object(client, "_request", return_value=MagicMock(status_code=200)):
            assert client.check_user_exists("user-1")

    def test_check_user_exists_false(self) -> None:
        client = _make_client_with_token()
        with patch.object(client, "_request",
                          side_effect=NotFoundError("not found", 404)):
            assert not client.check_user_exists("user-1")

    def test_check_group_exists_true(self) -> None:
        client = _make_client_with_token()
        with patch.object(client, "_request", return_value=MagicMock(status_code=200)):
            assert client.check_group_exists("group-1")

    def test_check_group_exists_false(self) -> None:
        client = _make_client_with_token()
        with patch.object(client, "_request",
                          side_effect=NotFoundError("not found", 404)):
            assert not client.check_group_exists("group-1")


# ---------------------------------------------------------------------------
# GraphClient — already_member detection
# ---------------------------------------------------------------------------


class TestAlreadyMemberDetection:
    def test_is_already_member_match(self) -> None:
        """Dual-key: 400 + Request_BadRequest + 'already exist'."""
        error = GraphError(
            "Request_BadRequest: One or more added object references already exist "
            "for the following modified properties: 'members'.",
            status_code=400,
        )
        assert GraphClient._is_already_member(error)

    def test_is_already_member_no_match_different_error(self) -> None:
        error = GraphError("BadRequest: Something else", status_code=400)
        assert not GraphClient._is_already_member(error)

    def test_is_already_member_wrong_status(self) -> None:
        error = GraphError("Request_BadRequest already exist", status_code=500)
        assert not GraphClient._is_already_member(error)


# ---------------------------------------------------------------------------
# GraphClient — not_member detection (pre-check + fallback)
# ---------------------------------------------------------------------------


class TestNotMemberDetection:
    def test_pre_check_not_member(self) -> None:
        """Pre-check membership returns 404 → not_member without DELETE."""
        client = _make_client_with_token()

        with patch.object(client, "_is_group_member", return_value=False), \
             patch.object(client, "_request") as mock_request:
            result = client.remove_user_from_group("u1", "g1")
            assert result == "not_member"
            delete_calls = [
                c for c in mock_request.call_args_list
                if c[0][0] == "DELETE"
            ]
            assert len(delete_calls) == 0

    def test_pre_check_is_member_then_delete_success(self) -> None:
        """Pre-check returns True → issue DELETE → success."""
        client = _make_client_with_token()

        with patch.object(client, "_is_group_member", return_value=True), \
             patch.object(client, "_request", return_value=MagicMock(status_code=204)) as mock_request:
            result = client.remove_user_from_group("u1", "g1")
            assert result == "ok"
            assert any(c[0][0] == "DELETE" for c in mock_request.call_args_list)

    def test_pre_check_is_member_delete_raises_404(self) -> None:
        """Pre-check said member but DELETE returns 404 (race)."""
        client = _make_client_with_token()

        with patch.object(client, "_is_group_member", return_value=True), \
             patch.object(client, "_request",
                          side_effect=NotFoundError("gone", 404)):
            result = client.remove_user_from_group("u1", "g1")
            assert result == "not_member"


# ---------------------------------------------------------------------------
# Token acquisition mock
# ---------------------------------------------------------------------------


class TestTokenAcquisition:
    def test_acquire_token_success(self) -> None:
        """Token returned on first attempt."""
        client = _make_client()
        client._app.acquire_token_for_client.return_value = {"access_token": "token-123"}
        token = client.acquire_token()
        assert token == "token-123"

    def test_acquire_token_cached(self) -> None:
        """Second call should return cached token (msal handles it)."""
        client = _make_client()
        client._app.acquire_token_for_client.side_effect = [
            {"access_token": "token-123"},
            {"access_token": "token-123"},
        ]
        token1 = client.acquire_token()
        token2 = client.acquire_token()
        assert token1 == "token-123"
        assert token2 == "token-123"
        assert client._app.acquire_token_for_client.call_count == 2

    def test_acquire_token_retry_on_error(self) -> None:
        """Retry on MSAL error dict with retryable code."""
        client = _make_client()
        client._app.acquire_token_for_client.side_effect = [
            {"error": "temporarily_unavailable", "error_description": "try again"},
            {"access_token": "token-456"},
        ]
        with patch("src.graph_client.time.sleep", return_value=None):
            token = client.acquire_token()
            assert token == "token-456"
            assert client._app.acquire_token_for_client.call_count == 2

    def test_acquire_token_terminal_error(self) -> None:
        """Terminal MSAL error → TokenError immediately."""
        client = _make_client()
        client._app.acquire_token_for_client.return_value = {
            "error": "invalid_client",
            "error_description": "bad client credentials",
        }
        with pytest.raises(TokenError) as exc_info:
            client.acquire_token()
        assert "invalid_client" in str(exc_info.value) or \
               "bad client credentials" in str(exc_info.value)

    def test_acquire_token_network_error_retry(self) -> None:
        """Network error → retry, then success."""
        client = _make_client()
        client._app.acquire_token_for_client.side_effect = [
            requests.ConnectionError("dns failure"),
            {"access_token": "token-789"},
        ]
        with patch("src.graph_client.time.sleep", return_value=None):
            token = client.acquire_token()
            assert token == "token-789"

    def test_acquire_token_network_error_exhausted(self) -> None:
        """All retries exhausted on network errors → TokenError."""
        client = _make_client()
        client._app.acquire_token_for_client.side_effect = requests.ConnectionError("always down")
        with patch("src.graph_client.time.sleep", return_value=None):
            with pytest.raises(TokenError):
                client.acquire_token()


# ---------------------------------------------------------------------------
# GraphClient — add_user_to_group
# ---------------------------------------------------------------------------


class TestAddUserToGroup:
    def test_success(self) -> None:
        client = _make_client_with_token()
        with patch.object(client, "_request", return_value=MagicMock(status_code=201)):
            result = client.add_user_to_group("u1", "g1")
            assert result == "ok"

    def test_already_member(self) -> None:
        client = _make_client_with_token()
        error = GraphError(
            "Request_BadRequest: One or more added object references already exist "
            "for the following modified properties: 'members'.",
            status_code=400,
        )
        with patch.object(client, "_request", side_effect=error):
            result = client.add_user_to_group("u1", "g1")
            assert result == "already_member"

    def test_other_error_propagates(self) -> None:
        client = _make_client_with_token()
        error = GraphError("Something went wrong", status_code=500)
        with patch.object(client, "_request", side_effect=error):
            with pytest.raises(GraphError):
                client.add_user_to_group("u1", "g1")
