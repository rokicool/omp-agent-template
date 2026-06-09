"""Tests for reporter output."""

from __future__ import annotations

import sys
from io import StringIO
from unittest.mock import patch

import pytest

from entra_bulk.models import (
    ExecutionResult,
    OperationRecord,
    RecordStatus,
    ValidationResult,
)
from entra_bulk.reporter import (
    is_tty,
    print_execution_line,
    print_phase1_header,
    print_phase1_result,
    print_summary_table,
)


class TestIsTty:
    def test_returns_bool(self):
        result = is_tty()
        assert isinstance(result, bool)

    def test_false_when_redirected(self):
        fake = StringIO()
        with patch.object(sys, "stdout", fake):
            assert is_tty() is False


class TestPrintPhase1Header:
    def test_output(self, capsys):
        print_phase1_header(5)
        out = capsys.readouterr().out
        assert "[Phase 1] Validating 5 records..." in out


class TestPrintPhase1Result:
    def test_pass(self, capsys):
        vr = ValidationResult()
        print_phase1_result(vr, color=False)
        out = capsys.readouterr().out
        assert "PASS" in out

    def test_fail_shows_errors(self, capsys):
        vr = ValidationResult()
        vr.add(1, "VR-001", RecordStatus.ERR, "bad op")
        print_phase1_result(vr, color=False)
        out = capsys.readouterr().out
        assert "FAIL" in out
        assert "VR-001" not in out  # rule_id not printed, message is
        assert "bad op" in out
        assert "[row 1]" in out

    def test_color_enabled(self, capsys):
        vr = ValidationResult()
        vr.add(1, "VR-001", RecordStatus.ERR, "bad")
        print_phase1_result(vr, color=True)
        out = capsys.readouterr().out
        assert "\033[" in out  # ANSI codes present

    def test_color_disabled(self, capsys):
        vr = ValidationResult()
        vr.add(1, "VR-001", RecordStatus.ERR, "bad")
        print_phase1_result(vr, color=False)
        out = capsys.readouterr().out
        assert "\033[" not in out


class TestPrintExecutionLine:
    def test_output_format(self, capsys):
        rec = OperationRecord(
            operation="add-user-to-group",
            user="a@b.com",
            group="G",
            row=1,
        )
        result = ExecutionResult(record=rec, status=RecordStatus.OK, message="added")
        print_execution_line(result, color=False)
        out = capsys.readouterr().out
        assert "OK" in out
        assert "add-user-to-group" in out
        assert "a@b.com" in out
        assert "added" in out

    def test_no_color(self, capsys):
        rec = OperationRecord(
            operation="add-user-to-group",
            user="a@b.com",
            group="G",
            row=1,
        )
        result = ExecutionResult(record=rec, status=RecordStatus.ERR, message="fail")
        print_execution_line(result, color=False)
        out = capsys.readouterr().out
        assert "\033[" not in out


class TestPrintSummaryTable:
    def test_table_format(self, capsys):
        results = [
            ExecutionResult(
                record=OperationRecord(operation="add-user-to-group", user="a", group="G"),
                status=RecordStatus.OK,
                message="added",
            ),
            ExecutionResult(
                record=OperationRecord(operation="add-user-to-group", user="b", group="G"),
                status=RecordStatus.WRN,
                message="already a member",
            ),
            ExecutionResult(
                record=OperationRecord(operation="add-user-to-group", user="c", group="G"),
                status=RecordStatus.ERR,
                message="fail",
            ),
        ]
        print_summary_table(results, color=False)
        out = capsys.readouterr().out
        assert "┌" in out
        assert "OK" in out
        assert "WRN" in out
        assert "ERR" in out
        assert "1" in out  # counts

    def test_no_color(self, capsys):
        results = [
            ExecutionResult(
                record=OperationRecord(operation="add-user-to-group", user="a", group="G"),
                status=RecordStatus.OK,
                message="ok",
            ),
        ]
        print_summary_table(results, color=False)
        out = capsys.readouterr().out
        assert "\033[" not in out

    def test_color_enabled(self, capsys):
        results = [
            ExecutionResult(
                record=OperationRecord(operation="add-user-to-group", user="a", group="G"),
                status=RecordStatus.OK,
                message="ok",
            ),
        ]
        print_summary_table(results, color=True)
        out = capsys.readouterr().out
        assert "\033[" in out
