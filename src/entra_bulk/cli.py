"""Click CLI entry point."""

from __future__ import annotations

import asyncio
import os
import sys

import click

from entra_bulk.config import load_config
from entra_bulk.exceptions import FatalError
from entra_bulk.execution import execute
from entra_bulk.graph_client import EntraGraphClient
from entra_bulk.input_parser import parse_input
from entra_bulk.reporter import (
    is_tty,
    print_execution_line,
    print_phase1_header,
    print_phase1_result,
    print_summary_table,
)
from entra_bulk.validation import validate


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise FatalError(f"required environment variable not set: {name}")
    return value


@click.command()
@click.option(
    "--config",
    required=True,
    type=click.Path(exists=True),
    help="Path to YAML config file",
)
@click.option(
    "--input",
    "input_path",
    required=True,
    type=click.Path(exists=True),
    help="Path to input file (.json, .yaml, .yml, .csv)",
)
@click.option(
    "--dry-run",
    is_flag=True,
    default=False,
    help="Validate only; skip Graph API mutations",
)
def main(config: str, input_path: str, dry_run: bool) -> None:
    """Entra ID Bulk Group Management Tool."""
    try:
        # 1. Load config
        cfg = load_config(config)

        # 2. Validate env vars
        client_id = _require_env("AZURE_CLIENT_ID")
        client_secret = _require_env("AZURE_CLIENT_SECRET")
        _require_env("AZURE_TENANT_ID")

        # 3. Parse input
        records = parse_input(input_path)

        # 4. Phase 1 — validation
        color = is_tty()
        print_phase1_header(len(records))
        vr = validate(records, cfg)

        if vr.has_errors:
            print_phase1_result(vr, color=color)
            sys.exit(2)

        print_phase1_result(vr, color=color)

        # 5. Initialize Graph client
        client = EntraGraphClient(cfg.tenant_id, client_id, client_secret)

        # 6. Phase 2 — execution
        results = asyncio.run(execute(records, cfg, client, dry_run=dry_run))

        # 7. Print per-record results
        for result in results:
            print_execution_line(result, color=color)

        # 8. Summary table
        print_summary_table(results, color=color)

        # 9. Exit code
        has_errors = any(r.status.value == "ERR" for r in results)
        sys.exit(1 if has_errors else 0)

    except FatalError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(2)
    except Exception as e:
        print(f"Unexpected error: {e}", file=sys.stderr)
        sys.exit(2)
