"""Tests for execution engine."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from entra_bulk.config import Config
from entra_bulk.exceptions import (
    AlreadyMemberWarning,
    GraphApiError,
    NotMemberWarning,
)
from entra_bulk.execution import execute
from entra_bulk.models import (
    OperationRecord,
    OperationType,
    RecordStatus,
)


@pytest.fixture
def config():
    return Config(
        tenant_id="11111111-1111-1111-1111-111111111111",
        identity_id="22222222-2222-2222-2222-222222222222",
        allowed_operations=frozenset(
            ["add-user-to-group", "remove-user-from-group"]
        ),
    )


@pytest.fixture
def mock_client():
    with patch("entra_bulk.graph_client.ClientSecretCredential"):
        from entra_bulk.graph_client import EntraGraphClient

        client = EntraGraphClient("fake-tenant", "fake-client", "fake-secret")
    client.resolve_user = AsyncMock(side_effect=lambda ident: f"uid-{ident}")
    client.resolve_group = AsyncMock(side_effect=lambda ident: f"gid-{ident}")
    client.add_member = AsyncMock()
    client.remove_member = AsyncMock()
    return client


@pytest.mark.asyncio
class TestExecute:
    async def test_happy_path_add(self, config, mock_client):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert len(results) == 1
        assert results[0].status == RecordStatus.OK
        assert results[0].message == "added"
        mock_client.add_member.assert_called_once_with("gid-G", "uid-a@b.com")

    async def test_happy_path_remove(self, config, mock_client):
        records = [
            OperationRecord(
                operation="remove-user-from-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert results[0].status == RecordStatus.OK
        assert results[0].message == "removed"
        mock_client.remove_member.assert_called_once_with("gid-G", "uid-a@b.com")

    async def test_dry_run(self, config, mock_client):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client, dry_run=True)
        assert results[0].status == RecordStatus.OK
        assert results[0].message == "would execute (dry-run)"
        mock_client.add_member.assert_not_called()

    async def test_user_not_resolved(self, config, mock_client):
        mock_client.resolve_user = AsyncMock(side_effect=lambda ident: "" if ident == "ghost@x.com" else f"uid-{ident}")
        # Override: make resolve_user return empty for ghost
        from entra_bulk.exceptions import UserNotFoundError

        async def resolve_user_side(ident):
            if ident == "ghost@x.com":
                raise UserNotFoundError("not found")
            return f"uid-{ident}"

        mock_client.resolve_user = AsyncMock(side_effect=resolve_user_side)

        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="ghost@x.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert results[0].status == RecordStatus.ERR
        assert "user not found" in results[0].message

    async def test_group_not_resolved(self, config, mock_client):
        from entra_bulk.exceptions import GroupNotFoundError

        async def resolve_group_side(ident):
            if ident == "Missing":
                raise GroupNotFoundError("not found")
            return f"gid-{ident}"

        mock_client.resolve_group = AsyncMock(side_effect=resolve_group_side)

        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="Missing",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert results[0].status == RecordStatus.ERR
        assert "group not found" in results[0].message

    async def test_already_member_warning(self, config, mock_client):
        mock_client.add_member = AsyncMock(
            side_effect=AlreadyMemberWarning("already")
        )
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert results[0].status == RecordStatus.WRN
        assert results[0].message == "already a member"

    async def test_not_member_warning(self, config, mock_client):
        mock_client.remove_member = AsyncMock(
            side_effect=NotMemberWarning("not member")
        )
        records = [
            OperationRecord(
                operation="remove-user-from-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert results[0].status == RecordStatus.WRN
        assert results[0].message == "not a member"

    async def test_graph_api_error(self, config, mock_client):
        mock_client.add_member = AsyncMock(
            side_effect=GraphApiError("server error")
        )
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert results[0].status == RecordStatus.ERR
        assert "server error" in results[0].message

    async def test_mixed_results(self, config, mock_client):
        from entra_bulk.exceptions import UserNotFoundError

        async def resolve_user_side(ident):
            if ident == "bad@x.com":
                raise UserNotFoundError("not found")
            return f"uid-{ident}"

        mock_client.resolve_user = AsyncMock(side_effect=resolve_user_side)

        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="good@x.com",
                group="G",
                row=1,
            ),
            OperationRecord(
                operation="add-user-to-group",
                user="bad@x.com",
                group="G",
                row=2,
            ),
        ]
        results = await execute(records, config, mock_client)
        assert len(results) == 2
        assert results[0].status == RecordStatus.OK
        assert results[1].status == RecordStatus.ERR
