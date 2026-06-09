"""Tests for Graph API client (mocked with respx)."""

from __future__ import annotations

from unittest.mock import patch, AsyncMock, MagicMock

import pytest

from entra_bulk.exceptions import (
    AlreadyMemberWarning,
    GroupNotFoundError,
    NotMemberWarning,
    UserNotFoundError,
    GraphApiError,
)
from entra_bulk.graph_client import EntraGraphClient


@pytest.fixture
def client():
    with patch("entra_bulk.graph_client.ClientSecretCredential"):
        c = EntraGraphClient("fake-tenant", "fake-client", "fake-secret")
    return c


class TestResolveUser:
    @pytest.mark.asyncio
    async def test_guid_passthrough(self, client):
        guid = "11111111-1111-1111-1111-111111111111"
        result = await client.resolve_user(guid)
        assert result == guid

    @pytest.mark.asyncio
    async def test_upn_resolution(self, client):
        mock_user = MagicMock()
        mock_user.id = "user-guid-123"

        mock_get = AsyncMock(return_value=mock_user)
        client._client = MagicMock()
        client._client.users.by_user_id.return_value.get = mock_get

        result = await client.resolve_user("alice@example.com")
        assert result == "user-guid-123"

    @pytest.mark.asyncio
    async def test_user_not_found(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 404
        mock_get = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.users.by_user_id.return_value.get = mock_get

        with pytest.raises(UserNotFoundError):
            await client.resolve_user("ghost@example.com")

    @pytest.mark.asyncio
    async def test_user_none_response(self, client):
        mock_get = AsyncMock(return_value=None)
        client._client = MagicMock()
        client._client.users.by_user_id.return_value.get = mock_get

        with pytest.raises(UserNotFoundError):
            await client.resolve_user("ghost@example.com")


class TestResolveGroup:
    @pytest.mark.asyncio
    async def test_guid_passthrough(self, client):
        guid = "22222222-2222-2222-2222-222222222222"
        result = await client.resolve_group(guid)
        assert result == guid

    @pytest.mark.asyncio
    async def test_display_name_resolution(self, client):
        mock_group = MagicMock()
        mock_group.id = "group-guid-456"
        mock_result = MagicMock()
        mock_result.value = [mock_group]

        mock_get = AsyncMock(return_value=mock_result)
        client._client = MagicMock()
        client._client.groups.get = mock_get

        result = await client.resolve_group("Engineering")
        assert result == "group-guid-456"

    @pytest.mark.asyncio
    async def test_group_not_found(self, client):
        mock_result = MagicMock()
        mock_result.value = []

        mock_get = AsyncMock(return_value=mock_result)
        client._client = MagicMock()
        client._client.groups.get = mock_get

        with pytest.raises(GroupNotFoundError):
            await client.resolve_group("Nonexistent")

    @pytest.mark.asyncio
    async def test_group_none_response(self, client):
        mock_get = AsyncMock(return_value=None)
        client._client = MagicMock()
        client._client.groups.get = mock_get

        with pytest.raises(GroupNotFoundError):
            await client.resolve_group("Nonexistent")


class TestAddMember:
    @pytest.mark.asyncio
    async def test_success(self, client):
        mock_post = AsyncMock(return_value=None)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.ref.post = mock_post

        await client.add_member("group-id", "user-id")
        mock_post.assert_called_once()

    @pytest.mark.asyncio
    async def test_already_member(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 400
        error.message = "One or more added object references already exist"

        mock_post = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.ref.post = mock_post

        with pytest.raises(AlreadyMemberWarning):
            await client.add_member("group-id", "user-id")

    @pytest.mark.asyncio
    async def test_forbidden(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 403
        error.message = "Forbidden"

        mock_post = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.ref.post = mock_post

        with pytest.raises(GraphApiError, match="insufficient permissions"):
            await client.add_member("group-id", "user-id")

    @pytest.mark.asyncio
    async def test_rate_limit(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 429
        error.message = "Too Many Requests"

        mock_post = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.ref.post = mock_post

        with pytest.raises(GraphApiError, match="rate limited"):
            await client.add_member("group-id", "user-id")

    @pytest.mark.asyncio
    async def test_server_error(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 500
        error.message = "Internal Server Error"

        mock_post = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.ref.post = mock_post

        with pytest.raises(GraphApiError, match="server error"):
            await client.add_member("group-id", "user-id")


class TestRemoveMember:
    @pytest.mark.asyncio
    async def test_success(self, client):
        mock_delete = AsyncMock(return_value=None)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.by_directory_object_id.return_value.ref.delete = mock_delete

        await client.remove_member("group-id", "user-id")
        mock_delete.assert_called_once()

    @pytest.mark.asyncio
    async def test_not_member(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 404
        error.message = "Not Found"

        mock_delete = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.by_directory_object_id.return_value.ref.delete = mock_delete

        with pytest.raises(NotMemberWarning):
            await client.remove_member("group-id", "user-id")

    @pytest.mark.asyncio
    async def test_forbidden(self, client):
        from kiota_abstractions.api_error import APIError

        error = APIError()
        error.response_status_code = 403
        error.message = "Forbidden"

        mock_delete = AsyncMock(side_effect=error)
        client._client = MagicMock()
        client._client.groups.by_group_id.return_value.members.by_directory_object_id.return_value.ref.delete = mock_delete

        with pytest.raises(GraphApiError, match="insufficient permissions"):
            await client.remove_member("group-id", "user-id")
