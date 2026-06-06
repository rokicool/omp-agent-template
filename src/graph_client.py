"""Microsoft Graph API client with MSAL authentication and retry policy."""

from __future__ import annotations

import json
import random
import time
from typing import Any

import msal
import requests
from requests.adapters import HTTPAdapter


# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------


class GraphError(Exception):
    """Base error for Graph API failures."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        self.message = message
        self.status_code = status_code
        super().__init__(message)


class TokenError(GraphError):
    """Token acquisition failed."""


class PermissionError(GraphError):
    """Insufficient permissions (403)."""


class NotFoundError(GraphError):
    """Entity not found (404)."""


# ---------------------------------------------------------------------------
# MSAL error classification (per SPEC §5.5)
# ---------------------------------------------------------------------------

_MSAL_RETRYABLE_ERRORS: frozenset[str] = frozenset(
    {
        "temporarily_unavailable",
        "AADSTS50033",
        "AADSTS90006",
        "AADSTS90012",
        "AADSTS90024",
        "AADSTS90033",
        "AADSTS90055",
        "AADSTS90090",
        "AADSTS90091",
        "AADSTS40010",
        "AADSTS50087",
        "AADSTS50162",
        "AADSTS501621",
    }
)

_MSAL_TERMINAL_ERRORS: frozenset[str] = frozenset(
    {
        "invalid_client",
        "invalid_grant",
        "unauthorized_client",
        "invalid_scope",
        "invalid_resource",
        "AADSTS70002",
        "AADSTS700011",
        "AADSTS700016",
        "AADSTS70001",
        "AADSTS7000112",
        "AADSTS7000215",
        "AADSTS7000222",
        "AADSTS700027",
        "AADSTS50001",
        "AADSTS500011",
        "AADSTS50012",
        "AADSTS90002",
        "AADSTS90036",
        "AADSTS90092",
        "AADSTS90094",
        "AADSTS65001",
        "AADSTS53003",
        "AADSTS530035",
    }
)


def _is_retryable_msal_error(error: str) -> bool:
    """Classify MSAL error dict 'error' field.

    Unknown codes are treated as terminal (non-retryable).
    """
    if error in _MSAL_RETRYABLE_ERRORS:
        return True
    if error in _MSAL_TERMINAL_ERRORS:
        return False
    # Unknown: non-retryable
    return False


# ---------------------------------------------------------------------------
# Retry helpers
# ---------------------------------------------------------------------------

_RETRY_BASE_DELAYS = [1.0, 2.0, 4.0]


def _compute_delay(attempt: int, retry_after: int | None = None) -> float:
    """Compute retry delay for attempt N (0-indexed, 0..2).

    Jitter: base * (0.5 + random() * 0.5).
    If retry_after is set (from 429 header), use min(retry_after, MAX_RETRY_AFTER).
    """
    if retry_after is not None:
        return float(min(retry_after, GraphClient.MAX_RETRY_AFTER))
    base = _RETRY_BASE_DELAYS[attempt]
    return base * (0.5 + random.random() * 0.5)


# ---------------------------------------------------------------------------
# GraphClient
# ---------------------------------------------------------------------------


class GraphClient:
    """Authenticated Microsoft Graph API client with retry policy."""

    GRAPH_BASE = "https://graph.microsoft.com/v1.0"
    SCOPE = ["https://graph.microsoft.com/.default"]
    TIMEOUT = 30  # seconds per request (FR8.4)
    MAX_RETRIES = 3  # 4 total attempts (FR8.2)
    MAX_RETRY_AFTER = 60  # seconds cap for Retry-After (FR8.5)

    def __init__(self, app_config: object) -> None:
        """Initialize the Graph client.

        Preconditions:
        - app_config is a fully validated AppConfig with identity_id,
          tenant_id, client_secret, and authority property.
        """
        self._config = app_config
        self._app = msal.ConfidentialClientApplication(
            client_id=app_config.identity_id,
            client_credential=app_config.client_secret,
            authority=app_config.authority,
        )
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Accept": "application/json",
                "Content-Type": "application/json",
            }
        )

    # -- token management ----------------------------------------------------

    def acquire_token(self) -> str:
        """Acquire an access token for Microsoft Graph with retry.

        Returns the bearer token string. Raises TokenError on failure.

        Two-layer MSAL error classification per SPEC §5.5:
        1. Exception-based: network/timeout exceptions → retryable.
        2. Error dict: inspect 'error' field against retryable/terminal codes.
        """
        for attempt in range(self.MAX_RETRIES + 1):
            try:
                result = self._app.acquire_token_for_client(scopes=self.SCOPE)
            except (requests.ConnectionError, requests.Timeout) as e:
                if attempt < self.MAX_RETRIES:
                    time.sleep(_compute_delay(attempt))
                    continue
                raise TokenError(f"Token acquisition failed: {e}") from e

            if "access_token" in result:
                return result["access_token"]

            error = result.get("error", "")
            if attempt < self.MAX_RETRIES and _is_retryable_msal_error(error):
                time.sleep(_compute_delay(attempt))
                continue

            raise TokenError(
                f"Token acquisition failed: "
                f"{result.get('error_description', error or 'unknown')}"
            )

        # Should be unreachable due to raise in last iteration
        raise TokenError("Token acquisition failed after all retries")

    def _ensure_auth(self) -> str:
        """Get a fresh or cached token and return it."""
        return self.acquire_token()

    # -- existence checks ----------------------------------------------------

    def check_user_exists(self, user_id: str) -> bool:
        """Check if a user exists in Entra ID.

        GET /users/{user_id}
        Returns True if user exists (HTTP 2xx).
        Raises GraphError on failure after retries.
        """
        url = f"{self.GRAPH_BASE}/users/{user_id}"
        try:
            self._request("GET", url)
        except NotFoundError:
            return False
        return True

    def check_group_exists(self, group_id: str) -> bool:
        """Check if a group exists in Entra ID.

        GET /groups/{group_id}
        Returns True if group exists (HTTP 2xx).
        Raises GraphError on failure after retries.
        """
        url = f"{self.GRAPH_BASE}/groups/{group_id}"
        try:
            self._request("GET", url)
        except NotFoundError:
            return False
        return True

    # -- operations ----------------------------------------------------------

    def add_user_to_group(self, user_id: str, group_id: str) -> str:
        """Add a user to a group.

        POST /groups/{group_id}/members/$ref

        Returns:
            "ok" — user was added successfully.
            "already_member" — detected via dual-key match on 400 response.
        Raises GraphError on other failures.
        """
        url = f"{self.GRAPH_BASE}/groups/{group_id}/members/$ref"
        body = {
            "@odata.id": f"{self.GRAPH_BASE}/directoryObjects/{user_id}",
        }
        try:
            self._request("POST", url, json=body)
        except GraphError as e:
            if self._is_already_member(e):
                return "already_member"
            raise
        return "ok"

    def remove_user_from_group(self, user_id: str, group_id: str) -> str:
        """Remove a user from a group.

        Strategy: Pre-check membership via GET before DELETE
        to avoid ambiguous 404. If pre-check shows not a member,
        return "not_member" without issuing DELETE.

        Returns:
            "ok" — user was removed successfully.
            "not_member" — user was not a member.
        Raises GraphError on other failures.
        """
        # Pre-check: is user currently a member?
        if not self._is_group_member(user_id, group_id):
            return "not_member"

        # User is a member — issue DELETE
        url = f"{self.GRAPH_BASE}/groups/{group_id}/members/{user_id}/$ref"
        try:
            self._request("DELETE", url)
        except NotFoundError:
            # Fallback: DELETE returned 404 despite pre-check (race condition)
            return "not_member"
        return "ok"

    # -- idempotency detection helpers ---------------------------------------

    @staticmethod
    def _is_already_member(error: GraphError) -> bool:
        """Dual-key match for already-member response.

        HTTP 400 + error.code == "Request_BadRequest"
        AND "already exist" in error.message.
        """
        if error.status_code != 400:
            return False
        if "already exist" not in error.message:
            return False
        # We need the raw error code from the stored response body.
        # The error message stores it; checking both is the contract.
        return "Request_BadRequest" in error.message

    def _is_group_member(self, user_id: str, group_id: str) -> bool:
        """Check if a user is a direct member of a group.

        GET /groups/{group_id}/members/{user_id}/$ref
        Returns True if 200 (is member), False if 404 (not member).
        Raises GraphError on other failures.
        """
        url = f"{self.GRAPH_BASE}/groups/{group_id}/members/{user_id}/$ref"
        try:
            self._request("GET", url)
        except NotFoundError:
            return False
        return True

    # -- HTTP core -----------------------------------------------------------

    def _request(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> requests.Response:
        """Execute an HTTP request with retry policy.

        Retry policy per SPEC FR8:
        - Max 3 retries (4 total attempts).
        - Exponential backoff with jitter: base 1s, 2s, 4s.
        - Respect Retry-After on 429, capped at 60s.
        - Retry on: 5xx, 429, connection errors.
        - Do NOT retry on: 4xx except 429.
        - 30s timeout per attempt.
        """
        kwargs.setdefault("timeout", self.TIMEOUT)
        last_exception: Exception | None = None

        for attempt in range(self.MAX_RETRIES + 1):
            token = self._ensure_auth()
            self._session.headers["Authorization"] = f"Bearer {token}"

            try:
                resp = self._session.request(method, url, **kwargs)
            except (requests.ConnectionError, requests.Timeout) as e:
                last_exception = e
                if attempt < self.MAX_RETRIES:
                    time.sleep(_compute_delay(attempt))
                    continue
                raise GraphError(f"Network timeout: {e}") from e

            # 5xx or 429: retryable
            if 500 <= resp.status_code < 600 or resp.status_code == 429:
                if attempt < self.MAX_RETRIES:
                    retry_after = None
                    if resp.status_code == 429:
                        retry_after = self._parse_retry_after(resp)
                    time.sleep(_compute_delay(attempt, retry_after))
                    continue
                # Exhausted retries
                if resp.status_code == 429:
                    raise GraphError(
                        f"Rate limited after {self.MAX_RETRIES + 1} attempts",
                        status_code=429,
                    )
                raise GraphError(
                    f"Server error (HTTP {resp.status_code}): {resp.text[:200]}",
                    status_code=resp.status_code,
                )

            # 2xx: success
            if 200 <= resp.status_code < 300:
                return resp

            # 4xx (non-429): classify and raise
            self._handle_4xx(resp)

        # Should be unreachable
        if last_exception:
            raise GraphError(f"Network error: {last_exception}") from last_exception
        raise GraphError("Request failed after all retries")

    # -- response parsing ----------------------------------------------------

    def _handle_4xx(self, resp: requests.Response) -> None:
        """Classify and raise appropriate GraphError for 4xx responses."""
        error_body = self._parse_error_body(resp)
        code = error_body.get("code", "")
        message = error_body.get("message", "")

        if resp.status_code == 403:
            raise PermissionError(
                f"Insufficient permissions: {message or '403 Forbidden'}",
                status_code=403,
            )

        if resp.status_code == 404:
            raise NotFoundError(
                f"{message or '404 Not Found'} [code={code}]",
                status_code=404,
            )

        if resp.status_code == 400 and code == "Request_BadRequest":
            raise GraphError(
                f"{code}: {message}",
                status_code=400,
            )

        raise GraphError(
            f"HTTP {resp.status_code}: {message or resp.reason or 'unknown'}",
            status_code=resp.status_code,
        )

    @staticmethod
    def _parse_error_body(resp: requests.Response) -> dict[str, Any]:
        """Extract error dict from Graph API response body."""
        try:
            body = resp.json()
            return body.get("error", {})
        except (json.JSONDecodeError, ValueError):
            return {}

    @staticmethod
    def _parse_retry_after(resp: requests.Response) -> int | None:
        """Parse Retry-After header from a 429 response."""
        value = resp.headers.get("Retry-After", "")
        if not value:
            return None
        try:
            return int(value)
        except ValueError:
            return None
