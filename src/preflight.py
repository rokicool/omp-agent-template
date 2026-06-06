"""Three-phase pre-flight validation.

Orchestrates schema cross-reference, connectivity, and existence checks
before any mutations are attempted.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .config import AppConfig, InputSpec
from .graph_client import GraphClient, TokenError, PermissionError, NotFoundError, GraphError
from .output import inf, ok, err


@dataclass
class PreflightResult:
    """Aggregated result of pre-flight validation."""

    errors: list[str] = field(default_factory=list)
    ok_count: int = 0
    err_count: int = 0

    @property
    def passed(self) -> bool:
        return self.err_count == 0


def run(
    input_spec: InputSpec,
    app_config: AppConfig,
    *,
    no_preflight: bool = False,
    dry_run: bool = False,
) -> PreflightResult:
    """Execute pre-flight validation.

    Phases (per FR3.1):
    1. Schema cross-reference: verify operation actions are in config.actions.
       Always runs, regardless of --no-preflight or --dry-run.
    2. Connectivity: acquire a token to verify Entra ID is reachable.
       Skipped when --no-preflight.
    3. Existence: verify all referenced users and groups exist.
       Skipped when --no-preflight.

    Preconditions:
    - input_spec and app_config must already be schema-valid.
    - --no-preflight and --dry-run mutual exclusion already validated by caller.

    Returns PreflightResult with aggregated errors and counts.
    No mutations performed.
    """
    result = PreflightResult()

    # Phase 1: cross-reference (always)
    inf("Pre-flight validation: checking operation actions...")
    xref_errors = _validate_cross_reference(input_spec, app_config)
    if xref_errors:
        for msg in xref_errors:
            err(msg)
        result.errors.extend(xref_errors)
        result.err_count += len(xref_errors)
    else:
        ok("All operation actions are valid")
        result.ok_count += 1

    if no_preflight:
        inf("Skipping connectivity and existence checks (--no-preflight)")
        return result

    # Create client for connectivity + existence
    client = GraphClient(app_config)

    # Phase 2: connectivity
    inf("Pre-flight validation: checking connectivity to Microsoft Entra ID...")
    conn_errors = _validate_connectivity(client)
    if conn_errors:
        for msg in conn_errors:
            err(msg)
        result.errors.extend(conn_errors)
        result.err_count += len(conn_errors)
        # Cannot proceed to existence checks without connectivity
        return result
    ok("Successfully connected to Microsoft Entra ID")
    result.ok_count += 1

    # Phase 3: existence
    inf("Pre-flight validation: checking users and groups exist...")
    exist_errors = _validate_existence(input_spec, client)
    if exist_errors:
        for msg in exist_errors:
            err(msg)
        result.errors.extend(exist_errors)
        result.err_count += len(exist_errors)
    else:
        ok("All users and groups exist")
        result.ok_count += 1

    return result


# ---------------------------------------------------------------------------
# Phase implementations
# ---------------------------------------------------------------------------


def _validate_cross_reference(
    input_spec: InputSpec,
    app_config: AppConfig,
) -> list[str]:
    """Validate that every operation's action is in config.actions."""
    errors: list[str] = []
    for i, op in enumerate(input_spec.operations):
        if op.action not in app_config.actions:
            errors.append(
                f"input: operations[{i}].action '{op.action}' "
                f"not in config allowed actions"
            )
    return errors


def _validate_connectivity(client: GraphClient) -> list[str]:
    """Acquire token. Returns [] on success, [error_msg] on failure."""
    try:
        client.acquire_token()
    except TokenError as e:
        return [str(e)]
    return []


def _validate_existence(
    input_spec: InputSpec,
    client: GraphClient,
) -> list[str]:
    """Check all unique user_id and group_id entities exist.

    Deduplicates IDs so each entity is checked only once.
    Stops checking on permission errors (403).
    """
    errors: list[str] = []

    user_ids = sorted({op.user_id for op in input_spec.operations})
    group_ids = sorted({op.group_id for op in input_spec.operations})

    for uid in user_ids:
        try:
            client.check_user_exists(uid)
        except NotFoundError:
            errors.append(f"User '{uid}' not found in Entra ID")
        except PermissionError:
            errors.append(
                f"Insufficient permissions: Service Principal lacks "
                f"'GroupMember.ReadWrite.All'. Received 403 for user '{uid}'."
            )
            return errors
        except GraphError as e:
            errors.append(f"Failed to verify user '{uid}': {e}")

    for gid in group_ids:
        try:
            client.check_group_exists(gid)
        except NotFoundError:
            errors.append(f"Group '{gid}' not found in Entra ID")
        except PermissionError:
            if not any("Insufficient permissions" in e for e in errors):
                errors.append(
                    f"Insufficient permissions: Service Principal lacks "
                    f"'GroupMember.ReadWrite.All'. Received 403 for group '{gid}'."
                )
            return errors
        except GraphError as e:
            errors.append(f"Failed to verify group '{gid}': {e}")

    return errors
