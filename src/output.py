"""Colored terminal output for action status reporting."""

from __future__ import annotations

from dataclasses import dataclass
import sys

from colorama import Fore, Style, init as colorama_init

colorama_init(autoreset=True)

_TAG_WIDTH = 3


def _tag(label: str, color: str) -> str:
    """Format a colored tag like [INF]."""
    return f"{color}[{label}]{Style.RESET_ALL}"


def inf(msg: str, *, quiet: bool = False) -> None:
    """Informational message (blue). Suppressed when quiet=True."""
    if not quiet:
        print(f"{_tag('INF', Fore.BLUE)} {msg}", file=sys.stderr)


def ok(msg: str, *, quiet: bool = False) -> None:
    """Success message (green). Suppressed when quiet=True."""
    if not quiet:
        print(f"{_tag('OK ', Fore.GREEN)} {msg}", file=sys.stderr)


def wrn(msg: str, *, quiet: bool = False) -> None:
    """Warning — something is not right, but execution may continue (yellow)."""
    if not quiet:
        print(f"{_tag('WRN', Fore.YELLOW)} {msg}", file=sys.stderr)


def err(msg: str, *, quiet: bool = False) -> None:
    """Error — action cannot or will not be performed (red)."""
    if not quiet:
        print(f"{_tag('ERR', Fore.RED)} {msg}", file=sys.stderr)


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------


@dataclass
class ResultRow:
    """One row in the end-of-run summary table."""

    action: str
    user_id: str
    group_id: str
    status: str  # "OK", "WRN", "ERR"


def print_summary(rows: list[ResultRow]) -> None:
    """Print summary counts and aligned table to stderr.

    Always emits to stderr, regardless of --quiet.
    """

    ok_n = sum(1 for r in rows if r.status == "OK")
    wrn_n = sum(1 for r in rows if r.status == "WRN")
    err_n = sum(1 for r in rows if r.status == "ERR")

    print(f"{ok_n} OK, {wrn_n} WRN, {err_n} ERR", file=sys.stderr)
    print(file=sys.stderr)

    if not rows:
        return

    # Column widths: max(header width, max data width)
    col_w = {
        "action": max(len("action"), max((len(r.action) for r in rows), default=0)),
        "user_id": max(len("user_id"), max((len(r.user_id) for r in rows), default=0)),
        "group_id": max(len("group_id"), max((len(r.group_id) for r in rows), default=0)),
        "status": max(len("status"), max((len(r.status) for r in rows), default=0)),
    }

    header = (
        f"{'action':<{col_w['action']}}  "
        f"{'user_id':<{col_w['user_id']}}  "
        f"{'group_id':<{col_w['group_id']}}  "
        f"{'status':<{col_w['status']}}"
    )
    print(header, file=sys.stderr)
    for r in rows:
        line = (
            f"{r.action:<{col_w['action']}}  "
            f"{r.user_id:<{col_w['user_id']}}  "
            f"{r.group_id:<{col_w['group_id']}}  "
            f"{r.status:<{col_w['status']}}"
        )
        print(line, file=sys.stderr)
