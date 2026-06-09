"""Microsoft Graph API client wrapper."""

from __future__ import annotations

from azure.identity import ClientSecretCredential
from msgraph import GraphServiceClient
from msgraph.generated.models.reference_create import ReferenceCreate
from kiota_abstractions.api_error import APIError

from entra_bulk.exceptions import (
    AlreadyMemberWarning,
    FatalError,
    GraphApiError,
    GroupNotFoundError,
    NotMemberWarning,
    UserNotFoundError,
)
from entra_bulk.models import GUID_RE


class EntraGraphClient:
    """Wraps msgraph-sdk for user/group resolution and membership operations."""

    def __init__(self, tenant_id: str, client_id: str, client_secret: str) -> None:
        try:
            self._credential = ClientSecretCredential(
                tenant_id=tenant_id,
                client_id=client_id,
                client_secret=client_secret,
            )
            self._client = GraphServiceClient(
                credentials=self._credential,
                scopes=["https://graph.microsoft.com/.default"],
            )
        except Exception as e:
            raise FatalError(f"authentication setup failed: {e}")

    async def resolve_user(self, identifier: str) -> str:
        """Return object ID. If identifier is a GUID, return as-is."""
        if GUID_RE.match(identifier):
            return identifier

        try:
            user = await self._client.users.by_user_id(identifier).get(
                request_configuration=lambda config: (
                    setattr(config.query_parameters, "select", ["id"])
                )
            )
            if user is None or user.id is None:
                raise UserNotFoundError(f"user not found: {identifier}")
            return user.id
        except UserNotFoundError:
            raise
        except APIError as e:
            status = getattr(e, "response_status_code", None)
            if status == 404:
                raise UserNotFoundError(f"user not found: {identifier}")
            raise GraphApiError(f"Graph API error resolving user {identifier}: {e}")

    async def resolve_group(self, identifier: str) -> str:
        """Return object ID. If identifier is a GUID, return as-is."""
        if GUID_RE.match(identifier):
            return identifier

        try:
            result = await self._client.groups.get(
                request_configuration=lambda config: (
                    setattr(
                        config.query_parameters,
                        "filter",
                        f"displayName eq '{identifier}'",
                    ),
                    setattr(config.query_parameters, "top", 1),
                    setattr(config.query_parameters, "select", ["id"]),
                )
            )
            if not result or not result.value:
                raise GroupNotFoundError(f"group not found: {identifier}")
            return result.value[0].id
        except GroupNotFoundError:
            raise
        except APIError as e:
            raise GraphApiError(
                f"Graph API error resolving group {identifier}: {e}"
            )

    async def add_member(self, group_id: str, user_id: str) -> None:
        """POST /groups/{group_id}/members/$ref"""
        body = ReferenceCreate(
            odata_id=f"https://graph.microsoft.com/v1.0/directoryObjects/{user_id}",
        )
        try:
            await self._client.groups.by_group_id(group_id).members.ref.post(body)
        except APIError as e:
            status = getattr(e, "response_status_code", None)
            if status == 400 and "already" in str(e).lower():
                raise AlreadyMemberWarning(
                    f"user {user_id} already in group {group_id}"
                )
            if status == 403:
                raise GraphApiError(
                    f"insufficient permissions to modify group {group_id}"
                )
            if status == 429:
                raise GraphApiError("rate limited by Graph API")
            if status is not None and status >= 500:
                raise GraphApiError(f"Graph API server error ({status})")
            raise GraphApiError(f"Graph API error: {e}")

    async def remove_member(self, group_id: str, user_id: str) -> None:
        """DELETE /groups/{group_id}/members/{user_id}/$ref"""
        try:
            await (
                self._client.groups.by_group_id(group_id)
                .members.by_directory_object_id(user_id)
                .ref.delete()
            )
        except APIError as e:
            status = getattr(e, "response_status_code", None)
            if status == 404:
                raise NotMemberWarning(
                    f"user {user_id} not in group {group_id}"
                )
            if status == 403:
                raise GraphApiError(
                    f"insufficient permissions to modify group {group_id}"
                )
            if status == 429:
                raise GraphApiError("rate limited by Graph API")
            if status is not None and status >= 500:
                raise GraphApiError(f"Graph API server error ({status})")
            raise GraphApiError(f"Graph API error: {e}")
