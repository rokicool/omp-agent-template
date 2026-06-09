"""Shared test fixtures."""

from __future__ import annotations

import pytest
from unittest.mock import patch

from entra_bulk.config import Config


@pytest.fixture(autouse=True)
def mock_auth(monkeypatch):
    """Prevent real Azure auth in all tests."""
    monkeypatch.setenv("AZURE_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("AZURE_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("AZURE_TENANT_ID", "test-tenant-id")


@pytest.fixture
def config():
    """A standard Config for tests."""
    return Config(
        tenant_id="11111111-1111-1111-1111-111111111111",
        identity_id="22222222-2222-2222-2222-222222222222",
        allowed_operations=frozenset(
            ["add-user-to-group", "remove-user-from-group"]
        ),
    )


@pytest.fixture
def graph_client():
    """Create a client with fake credentials (token won't be fetched)."""
    with patch("entra_bulk.graph_client.ClientSecretCredential"):
        from entra_bulk.graph_client import EntraGraphClient

        client = EntraGraphClient("fake-tenant", "fake-client", "fake-secret")
    return client
