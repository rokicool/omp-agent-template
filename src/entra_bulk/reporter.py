"""Colored console output and summary table."""

from __future__ import annotations

import sys

from entra_bulk.models import (
    ExecutionResult,
    RecordStatus,
    ValidationResult,
)


def is_tty() -> bool:
    """Return True if stdout is a TTY (for color detection)."""
    return sys.stdout.isatty()


_GREEN = "\033[32m"
_YELLOW = "\033[33m"
_RED = "\033[31m"
_RESET = "\033[0m"


def _colorize(text: str, status: RecordStatus, *, color: bool) -> str:
    if not color:
        return text
    codes = {
        RecordStatus.OK: _GREEN,
        RecordStatus.WRN: _YELLOW,
        RecordStatus.ERR: _RED,
    }
    code = codes.get(status, "")
    return f"{code}{text}{_RESET}"


def print_phase1_header(record_count: int) -> None:
    """Print '[Phase 1] Validating N records...'"""
    print(f"[Phase 1] Validating {record_count} records...")


def print_phase1_result(
    result: ValidationResult, *, color: bool = True
) -> None:
    """Print PASS or FAIL with all issues."""
    if not result.has_errors:
        total = len(result.issues) + len(result.errors)
        print(f"[Phase 1] PASS — {total} records valid")
    else:
        print(f"[Phase 1] FAIL — {len(result.errors)} errors found")
        for issue in result.issues:
            prefix = _colorize(issue.level.value, issue.level, color=color)
            print(f"  {prefix}  [row {issue.row}] {issue.message}")


def print_execution_line(
    result: ExecutionResult, *, color: bool = True
) -> None:
    """Print one execution result line with status coloring."""
    status_str = _colorize(result.status.value.ljust(3), result.status, color=color)
    op = result.record.operation.ljust(25)
    user = result.record.user.ljust(30)
    group = result.record.group.ljust(30)
    print(f"  {status_str}  {op}{user}{group}{result.message}")


def print_summary_table(
    results: list[ExecutionResult], *, color: bool = True
) -> None:
    """Print the summary table with OK/WRN/ERR counts."""
    ok = sum(1 for r in results if r.status == RecordStatus.OK)
    wrn = sum(1 for r in results if r.status == RecordStatus.WRN)
    err = sum(1 for r in results if r.status == RecordStatus.ERR)

    ok_str = _colorize(str(ok).rjust(3), RecordStatus.OK, color=color)
    wrn_str = _colorize(str(wrn).rjust(3), RecordStatus.WRN, color=color)
    err_str = _colorize(str(err).rjust(3), RecordStatus.ERR, color=color)

    print("┌─────┬─────┬─────┐")
    print("│ OK  │ WRN │ ERR │")
    print("├─────┼─────┼─────┤")
    print(f"│{ok_str} │{wrn_str} │{err_str} │")
    print("└─────┴─────┴─────┘")
