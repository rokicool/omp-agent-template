"""Entra ID Group Manager — CLI entry point.

Usage: python -m src.main [options]
"""

from __future__ import annotations

import argparse
import enum
import sys
from dataclasses import dataclass

from . import __version__
from .config import (
    load_config,
    load_input,
    ConfigError,
    Operation,
)
from .output import inf, ok, wrn, err, print_summary, ResultRow
from .graph_client import GraphClient, GraphError
from .preflight import run as run_preflight


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


class OperationStatus(enum.Enum):
    OK = "OK"
    WRN = "WRN"
    ERR = "ERR"


class ExitCode(enum.IntEnum):
    SUCCESS = 0  # All ops OK, zero WRN, zero ERR
    PREFLIGHT_FAIL = 1  # Pre-flight validation failed, no mutations tried
    WARNINGS = 2  # All ops done, >=1 WRN, zero ERR
    ERRORS = 3  # Execution completed, >=1 ERR


@dataclass
class OperationResult:
    operation: Operation
    status: OperationStatus
    message: str


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="entra-group-manager",
        description="Manage Microsoft Entra ID group memberships.",
    )
    parser.add_argument(
        "--config",
        default="./config.yaml",
        help="Path to configuration file (default: ./config.yaml)",
    )
    parser.add_argument(
        "--input",
        default="./input.yaml",
        help="Path to input file (default: ./input.yaml)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate only — no mutations performed.",
    )
    parser.add_argument(
        "--no-preflight",
        action="store_true",
        help="Skip connectivity and existence pre-flight checks.",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Suppress per-operation INF and status lines.",
    )
    parser.add_argument(
        "--version",
        action="version",
        version=f"entra-group-manager {__version__}",
    )
    return parser


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    """Entry point. Parses args, orchestrates flow, returns exit code.

    Flow:
    1. Parse args. --help/--version handled by argparse (exits 0).
    2. Validate --dry-run + --no-preflight mutual exclusion.
    3. Load config (batched errors).
    4. Load input (batched errors).
    5. Run preflight.
    6. If --dry-run: print summary, exit.
    7. Create GraphClient, execute operations sequentially.
    8. Print end summary.
    9. Return computed exit code.
    """
    parser = _build_parser()
    args = parser.parse_args(argv)

    # Mutual exclusion (FR5.2)
    if args.dry_run and args.no_preflight:
        err("--dry-run and --no-preflight are mutually exclusive")
        return ExitCode.PREFLIGHT_FAIL

    # Load config (FR1)
    try:
        app_config = load_config(args.config)
    except ConfigError as e:
        for ve in e.errors:
            err(f"{ve.source}: {ve.message}")
        return ExitCode.PREFLIGHT_FAIL

    # Load input (FR2)
    try:
        input_spec = load_input(args.input)
    except ConfigError as e:
        for ve in e.errors:
            err(f"{ve.source}: {ve.message}")
        return ExitCode.PREFLIGHT_FAIL

    # Pre-flight (FR3)
    preflight_result = run_preflight(
        input_spec,
        app_config,
        no_preflight=args.no_preflight,
        dry_run=args.dry_run,
    )
    if not preflight_result.passed and not args.no_preflight:
        return ExitCode.PREFLIGHT_FAIL

    # Dry run (FR4)
    if args.dry_run:
        print_summary([])
        return ExitCode.SUCCESS

    # Execution (FR6)
    client = GraphClient(app_config)
    results: list[OperationResult] = []

    for op in input_spec.operations:
        verb = _action_verb(op.action)
        prep = _action_preposition(op.action)
        inf(f"{verb} user {op.user_id} {prep} group {op.group_id}...", quiet=args.quiet)

        try:
            outcome = _execute_operation(client, op)
        except GraphError as exc:
            status_msg = str(exc)
            status_val = OperationStatus.ERR
        else:
            status_msg, status_val = _interpret_outcome(outcome)

        if status_val == OperationStatus.OK:
            ok(status_msg, quiet=args.quiet)
        elif status_val == OperationStatus.WRN:
            wrn(status_msg, quiet=args.quiet)
        else:
            err(status_msg, quiet=args.quiet)

        results.append(
            OperationResult(
                operation=op,
                status=status_val,
                message=status_msg,
            )
        )

    # Summary (FR9.4)
    rows = [
        ResultRow(
            r.operation.action,
            r.operation.user_id,
            r.operation.group_id,
            r.status.value,
        )
        for r in results
    ]
    print_summary(rows)

    # Exit code (FR11)
    return _compute_exit_code(results)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _execute_operation(client: GraphClient, op: Operation) -> str:
    """Execute one operation. Returns GraphClient status string.

    Raises GraphError on unrecoverable failure.
    """
    if op.action == "add-user-to-group":
        return client.add_user_to_group(op.user_id, op.group_id)
    else:
        return client.remove_user_from_group(op.user_id, op.group_id)


def _interpret_outcome(outcome: str) -> tuple[str, OperationStatus]:
    """Map GraphClient return value to (message, status)."""
    if outcome == "ok":
        return "Done", OperationStatus.OK
    elif outcome == "already_member":
        return "User is already a member of the group", OperationStatus.WRN
    elif outcome == "not_member":
        return "User is not a member of the group", OperationStatus.WRN
    else:
        return outcome, OperationStatus.ERR


def _action_verb(action: str) -> str:
    return "Adding" if action == "add-user-to-group" else "Removing"


def _action_preposition(action: str) -> str:
    return "to" if action == "add-user-to-group" else "from"


def _compute_exit_code(results: list[OperationResult]) -> int:
    errs = sum(1 for r in results if r.status == OperationStatus.ERR)
    wrns = sum(1 for r in results if r.status == OperationStatus.WRN)
    if errs > 0:
        return ExitCode.ERRORS
    if wrns > 0:
        return ExitCode.WARNINGS
    return ExitCode.SUCCESS
