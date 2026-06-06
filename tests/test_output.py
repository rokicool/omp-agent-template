"""Tests for output.py — colored output, quiet mode, summary table."""

from __future__ import annotations

import io
import sys

import pytest

from src.output import (
    ResultRow,
    err,
    inf,
    ok,
    print_summary,
    wrn,
)


# ---------------------------------------------------------------------------
# Output presence (not quiet)
# ---------------------------------------------------------------------------


class TestOutputPresence:
    def test_inf_emits(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            inf("hello world")
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "[INF]" in output
        assert "hello world" in output
        # ANSI escape codes should be present (colored output)
        assert "\033" in output

    def test_ok_emits(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            ok("done")
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "[OK ]" in output
        assert "done" in output

    def test_wrn_emits(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            wrn("careful")
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "[WRN]" in output
        assert "careful" in output

    def test_err_emits(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            err("failure")
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "[ERR]" in output
        assert "failure" in output


# ---------------------------------------------------------------------------
# Quiet mode suppression
# ---------------------------------------------------------------------------


class TestQuietSuppression:
    def test_inf_quiet(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            inf("should not appear", quiet=True)
        finally:
            sys.stderr = old
        assert capture.getvalue() == ""

    def test_ok_quiet(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            ok("nope", quiet=True)
        finally:
            sys.stderr = old
        assert capture.getvalue() == ""

    def test_wrn_quiet(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            wrn("shh", quiet=True)
        finally:
            sys.stderr = old
        assert capture.getvalue() == ""

    def test_err_quiet(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            err("hidden", quiet=True)
        finally:
            sys.stderr = old
        assert capture.getvalue() == ""

    def test_quiet_default_is_false(self) -> None:
        """Without quiet kwarg, output should appear (default False)."""
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            inf("default quiet is false")
        finally:
            sys.stderr = old
        assert "[INF]" in capture.getvalue()


# ---------------------------------------------------------------------------
# Summary table
# ---------------------------------------------------------------------------


class TestSummaryTable:
    def test_empty_rows(self) -> None:
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            print_summary([])
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "0 OK, 0 WRN, 0 ERR" in output
        # No table rows
        assert "action" not in output

    def test_counts(self) -> None:
        rows = [
            ResultRow("add-user-to-group", "u1", "g1", "OK"),
            ResultRow("add-user-to-group", "u2", "g1", "OK"),
            ResultRow("remove-user-from-group", "u3", "g1", "WRN"),
            ResultRow("add-user-to-group", "u4", "g2", "ERR"),
            ResultRow("remove-user-from-group", "u5", "g2", "ERR"),
        ]
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            print_summary(rows)
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "2 OK, 1 WRN, 2 ERR" in output

    def test_table_headers(self) -> None:
        rows = [ResultRow("add-user-to-group", "u1", "g1", "OK")]
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            print_summary(rows)
        finally:
            sys.stderr = old
        output = capture.getvalue()
        assert "action" in output
        assert "user_id" in output
        assert "group_id" in output
        assert "status" in output

    def test_table_column_alignment(self) -> None:
        rows = [
            ResultRow("add-user-to-group", "u1", "g1", "OK"),
            ResultRow("remove-user-from-group", "u-longer", "g-longer", "WRN"),
        ]
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            print_summary(rows)
        finally:
            sys.stderr = old
        output = capture.getvalue()
        # Both rows should appear
        assert "u1" in output
        assert "u-longer" in output

    def test_always_emits_regardless_of_quiet(self) -> None:
        """Summary is NEVER suppressed — it doesn't take quiet parameter."""
        rows = [ResultRow("add-user-to-group", "u1", "g1", "OK")]
        capture = io.StringIO()
        old = sys.stderr
        sys.stderr = capture
        try:
            print_summary(rows)
        finally:
            sys.stderr = old
        assert capture.getvalue() != ""


# ---------------------------------------------------------------------------
# ResultRow dataclass
# ---------------------------------------------------------------------------


class TestResultRow:
    def test_fields(self) -> None:
        row = ResultRow(
            action="add-user-to-group", user_id="u1", group_id="g1", status="OK"
        )
        assert row.action == "add-user-to-group"
        assert row.user_id == "u1"
        assert row.group_id == "g1"
        assert row.status == "OK"
