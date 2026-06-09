"""Phase 2 execution engine."""

from __future__ import annotations

from entra_bulk.config import Config
from entra_bulk.exceptions import (
    AlreadyMemberWarning,
    GraphApiError,
    GroupNotFoundError,
    NotMemberWarning,
    UserNotFoundError,
)
from entra_bulk.graph_client import EntraGraphClient
from entra_bulk.models import (
    ExecutionResult,
    OperationRecord,
    OperationType,
    RecordStatus,
)


async def _batch_resolve_users(
    client: EntraGraphClient,
    identifiers: set[str],
) -> dict[str, str]:
    """Map each unique user identifier → object ID."""
    result: dict[str, str] = {}
    for ident in identifiers:
        try:
            result[ident] = await client.resolve_user(ident)
        except UserNotFoundError:
            result[ident] = ""
    return result


async def _batch_resolve_groups(
    client: EntraGraphClient,
    identifiers: set[str],
) -> dict[str, str]:
    """Map each unique group identifier → object ID."""
    result: dict[str, str] = {}
    for ident in identifiers:
        try:
            result[ident] = await client.resolve_group(ident)
        except GroupNotFoundError:
            result[ident] = ""
    return result


async def execute(
    records: list[OperationRecord],
    config: Config,
    client: EntraGraphClient,
    *,
    dry_run: bool = False,
) -> list[ExecutionResult]:
    """Phase 2: execute all records best-effort."""
    results: list[ExecutionResult] = []

    # Phase 2a: batch-resolve identifiers
    user_ids: set[str] = {r.user for r in records}
    group_ids: set[str] = {r.group for r in records}

    user_map = await _batch_resolve_users(client, user_ids)
    group_map = await _batch_resolve_groups(client, group_ids)

    # Phase 2b: execute each record
    for rec in records:
        uid = user_map.get(rec.user, "")
        gid = group_map.get(rec.group, "")

        if not uid:
            results.append(
                ExecutionResult(
                    record=rec,
                    status=RecordStatus.ERR,
                    message=f"user not found: {rec.user}",
                )
            )
            continue
        if not gid:
            results.append(
                ExecutionResult(
                    record=rec,
                    status=RecordStatus.ERR,
                    message=f"group not found: {rec.group}",
                )
            )
            continue

        if dry_run:
            results.append(
                ExecutionResult(
                    record=rec,
                    status=RecordStatus.OK,
                    message="would execute (dry-run)",
                )
            )
            continue

        try:
            if rec.operation == OperationType.ADD:
                await client.add_member(gid, uid)
                results.append(
                    ExecutionResult(
                        record=rec,
                        status=RecordStatus.OK,
                        message="added",
                    )
                )
            elif rec.operation == OperationType.REMOVE:
                await client.remove_member(gid, uid)
                results.append(
                    ExecutionResult(
                        record=rec,
                        status=RecordStatus.OK,
                        message="removed",
                    )
                )
        except AlreadyMemberWarning:
            results.append(
                ExecutionResult(
                    record=rec,
                    status=RecordStatus.WRN,
                    message="already a member",
                )
            )
        except NotMemberWarning:
            results.append(
                ExecutionResult(
                    record=rec,
                    status=RecordStatus.WRN,
                    message="not a member",
                )
            )
        except GraphApiError as e:
            results.append(
                ExecutionResult(
                    record=rec,
                    status=RecordStatus.ERR,
                    message=str(e),
                )
            )

    return results
