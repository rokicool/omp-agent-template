"""Tests for main.py — CLI parsing, flow orchestration, exit codes."""

from __future__ import annotations

import io
import os
import sys
import tempfile
from dataclasses import dataclass
from unittest.mock import MagicMock, patch

import pytest

from src.config import ConfigError, ValidationError
from src.graph_client import GraphError
from src.main import (
    ExitCode,
    OperationResult,
    OperationStatus,
    _action_preposition,
    _action_verb,
    _compute_exit_code,
    _interpret_outcome,
    main,
)
from src.preflight import PreflightResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_temp_yaml(content: str) -> str:
    """Write YAML content to a temp file, return path."""
    fd, path = tempfile.mkstemp(suffix=".yaml")
    with os.fdopen(fd, "w") as f:
        f.write(content)
    return path


def _make_config_path() -> str:
    return _write_temp_yaml("""
identity_id: "app-123"
tenant_id: "tenant-456"
actions:
  - add-user-to-group
  - remove-user-from-group
""")


def _make_input_path() -> str:
    return _write_temp_yaml("""
operations:
  - action: add-user-to-group
    user_id: "user-1"
    group_id: "group-1"
""")


# ---------------------------------------------------------------------------
# Exit codes and computed exit code
# ---------------------------------------------------------------------------


class TestExitCode:
    def test_values(self) -> None:
        assert ExitCode.SUCCESS == 0
        assert ExitCode.PREFLIGHT_FAIL == 1
        assert ExitCode.WARNINGS == 2
        assert ExitCode.ERRORS == 3


class TestComputeExitCode:
    def test_all_ok(self) -> None:
        results = [
            OperationResult(MagicMock(), OperationStatus.OK, "Done"),
            OperationResult(MagicMock(), OperationStatus.OK, "Done"),
        ]
        assert _compute_exit_code(results) == ExitCode.SUCCESS

    def test_with_warnings(self) -> None:
        results = [
            OperationResult(MagicMock(), OperationStatus.OK, "Done"),
            OperationResult(MagicMock(), OperationStatus.WRN, "Already member"),
        ]
        assert _compute_exit_code(results) == ExitCode.WARNINGS

    def test_with_errors(self) -> None:
        results = [
            OperationResult(MagicMock(), OperationStatus.OK, "Done"),
            OperationResult(MagicMock(), OperationStatus.ERR, "Failed"),
        ]
        assert _compute_exit_code(results) == ExitCode.ERRORS

    def test_errors_priority_over_warnings(self) -> None:
        results = [
            OperationResult(MagicMock(), OperationStatus.WRN, "w"),
            OperationResult(MagicMock(), OperationStatus.ERR, "e"),
        ]
        assert _compute_exit_code(results) == ExitCode.ERRORS

    def test_empty(self) -> None:
        assert _compute_exit_code([]) == ExitCode.SUCCESS


# ---------------------------------------------------------------------------
# _interpret_outcome
# ---------------------------------------------------------------------------


class TestInterpretOutcome:
    def test_ok(self) -> None:
        msg, status = _interpret_outcome("ok")
        assert msg == "Done"
        assert status == OperationStatus.OK

    def test_already_member(self) -> None:
        msg, status = _interpret_outcome("already_member")
        assert "already a member" in msg
        assert status == OperationStatus.WRN

    def test_not_member(self) -> None:
        msg, status = _interpret_outcome("not_member")
        assert "not a member" in msg
        assert status == OperationStatus.WRN

    def test_unknown(self) -> None:
        msg, status = _interpret_outcome("something_else")
        assert msg == "something_else"
        assert status == OperationStatus.ERR


# ---------------------------------------------------------------------------
# _action_verb / _action_preposition
# ---------------------------------------------------------------------------


class TestActionHelpers:
    def test_verb_add(self) -> None:
        assert _action_verb("add-user-to-group") == "Adding"

    def test_verb_remove(self) -> None:
        assert _action_verb("remove-user-from-group") == "Removing"

    def test_prep_add(self) -> None:
        assert _action_preposition("add-user-to-group") == "to"

    def test_prep_remove(self) -> None:
        assert _action_preposition("remove-user-from-group") == "from"


# ---------------------------------------------------------------------------
# CLI — --dry-run + --no-preflight mutual exclusion
# ---------------------------------------------------------------------------


class TestDryRunNoPreflight:
    def test_mutual_exclusion(self) -> None:
        """AC: --dry-run + --no-preflight → exit 1."""
        code = main(["--dry-run", "--no-preflight"])
        assert code == ExitCode.PREFLIGHT_FAIL


# ---------------------------------------------------------------------------
# CLI — config load errors
# ---------------------------------------------------------------------------


class TestConfigLoadErrors:
    def test_missing_config_file(self) -> None:
        code = main(["--config", "/nonexistent/config.yaml"])
        assert code == ExitCode.PREFLIGHT_FAIL

    def test_invalid_config(self) -> None:
        path = _write_temp_yaml("bad_yaml: [unclosed")
        try:
            code = main(["--config", path])
            assert code == ExitCode.PREFLIGHT_FAIL
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# CLI — input load errors
# ---------------------------------------------------------------------------


class TestInputLoadErrors:
    def test_missing_input_file(self) -> None:
        cfg_path = _make_config_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            code = main(["--config", cfg_path, "--input", "/nonexistent/input.yaml"])
            assert code == ExitCode.PREFLIGHT_FAIL
        finally:
            os.unlink(cfg_path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# CLI — --help and --version (exit via argparse SystemExit)
# ---------------------------------------------------------------------------


class TestHelpVersion:
    def test_help_exits_0(self) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main(["--help"])
        assert exc_info.value.code == 0

    def test_version_exits_0(self) -> None:
        with pytest.raises(SystemExit) as exc_info:
            main(["--version"])
        assert exc_info.value.code == 0


# ---------------------------------------------------------------------------
# CLI — dry run
# ---------------------------------------------------------------------------


class TestDryRun:
    def test_dry_run_passes(self) -> None:
        """AC8: --dry-run → preflight passes, no mutations, exit 0."""
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockClient:
                mock_client = MockClient.return_value
                mock_client.acquire_token.return_value = "token"
                mock_client.check_user_exists.return_value = True
                mock_client.check_group_exists.return_value = True

                code = main(["--config", cfg_path, "--input", inp_path, "--dry-run"])
                assert code == ExitCode.SUCCESS

                # GraphClient.execute methods should NOT be called
                mock_client.add_user_to_group.assert_not_called()
                mock_client.remove_user_from_group.assert_not_called()
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# CLI — successful execution
# ---------------------------------------------------------------------------


class TestSuccessfulExecution:
    def test_all_ok_exit_0(self) -> None:
        """AC3: all ops OK → exit 0."""
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockPreflightClient, \
                 patch("src.main.GraphClient") as MockExecClient:
                # Preflight mock
                pf_client = MockPreflightClient.return_value
                pf_client.acquire_token.return_value = "token"
                pf_client.check_user_exists.return_value = True
                pf_client.check_group_exists.return_value = True

                # Execution mock
                exec_client = MockExecClient.return_value
                exec_client.add_user_to_group.return_value = "ok"

                code = main(["--config", cfg_path, "--input", inp_path])
                assert code == ExitCode.SUCCESS
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]

    def test_already_member_exit_2(self) -> None:
        """AC4: add user already member → WRN, exit 2."""
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockPreflightClient, \
                 patch("src.main.GraphClient") as MockExecClient:
                pf_client = MockPreflightClient.return_value
                pf_client.acquire_token.return_value = "token"
                pf_client.check_user_exists.return_value = True
                pf_client.check_group_exists.return_value = True

                exec_client = MockExecClient.return_value
                exec_client.add_user_to_group.return_value = "already_member"

                code = main(["--config", cfg_path, "--input", inp_path])
                assert code == ExitCode.WARNINGS
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]

    def test_not_member_exit_2(self) -> None:
        """AC5: remove user not member → WRN, exit 2."""
        cfg_path = _make_config_path()
        inp_path = _write_temp_yaml("""
operations:
  - action: remove-user-from-group
    user_id: "user-1"
    group_id: "group-1"
""")
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockPreflightClient, \
                 patch("src.main.GraphClient") as MockExecClient:
                pf_client = MockPreflightClient.return_value
                pf_client.acquire_token.return_value = "token"
                pf_client.check_user_exists.return_value = True
                pf_client.check_group_exists.return_value = True

                exec_client = MockExecClient.return_value
                exec_client.remove_user_from_group.return_value = "not_member"

                code = main(["--config", cfg_path, "--input", inp_path])
                assert code == ExitCode.WARNINGS
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]

    def test_graph_error_exit_3(self) -> None:
        """Execution error → exit 3."""
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockPreflightClient, \
                 patch("src.main.GraphClient") as MockExecClient:
                pf_client = MockPreflightClient.return_value
                pf_client.acquire_token.return_value = "token"
                pf_client.check_user_exists.return_value = True
                pf_client.check_group_exists.return_value = True

                exec_client = MockExecClient.return_value
                exec_client.add_user_to_group.side_effect = GraphError("Server error", 500)

                code = main(["--config", cfg_path, "--input", inp_path])
                assert code == ExitCode.ERRORS
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# CLI — preflight errors
# ---------------------------------------------------------------------------


class TestPreflightErrors:
    def test_non_existent_group_preflight_fail(self) -> None:
        """AC6: non-existent group → preflight fail, exit 1."""
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockClient:
                mock_client = MockClient.return_value
                mock_client.acquire_token.return_value = "token"
                mock_client.check_user_exists.return_value = True
                from src.graph_client import NotFoundError
                mock_client.check_group_exists.side_effect = NotFoundError("gone", 404)

                code = main(["--config", cfg_path, "--input", inp_path])
                assert code == ExitCode.PREFLIGHT_FAIL
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]

    def test_no_preflight_with_graph_error_exit_3(self) -> None:
        """AC7: --no-preflight with non-existent group → exit 3."""
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.main.GraphClient") as MockExecClient:
                exec_client = MockExecClient.return_value
                exec_client.add_user_to_group.side_effect = GraphError("Not found", 404)

                code = main(["--config", cfg_path, "--input", inp_path, "--no-preflight"])
                assert code == ExitCode.ERRORS
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# CLI — missing ENTRA_CLIENT_SECRET
# ---------------------------------------------------------------------------


class TestMissingSecret:
    def test_missing_secret_exit_1(self) -> None:
        """AC9: missing ENTRA_CLIENT_SECRET → ERR, exit 1."""
        old = os.environ.pop("ENTRA_CLIENT_SECRET", None)
        cfg_path = _make_config_path()
        inp_path = _make_input_path()
        try:
            code = main(["--config", cfg_path, "--input", inp_path])
            assert code == ExitCode.PREFLIGHT_FAIL
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            if old is not None:
                os.environ["ENTRA_CLIENT_SECRET"] = old


# ---------------------------------------------------------------------------
# CLI --quiet
# ---------------------------------------------------------------------------


class TestQuietMode:
    def test_quiet_suppresses_per_op_output(self) -> None:
        """AC11: --quiet suppresses INF and status, still prints summary."""
        cfg_path = _make_config_path()
        inp_path = _write_temp_yaml("""
operations:
  - action: add-user-to-group
    user_id: "user-1"
    group_id: "group-1"
  - action: remove-user-from-group
    user_id: "user-2"
    group_id: "group-1"
""")
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockPreflightClient, \
                 patch("src.main.GraphClient") as MockExecClient:
                pf_client = MockPreflightClient.return_value
                pf_client.acquire_token.return_value = "token"
                pf_client.check_user_exists.return_value = True
                pf_client.check_group_exists.return_value = True

                exec_client = MockExecClient.return_value
                exec_client.add_user_to_group.return_value = "ok"
                exec_client.remove_user_from_group.return_value = "ok"

                # Capture stderr
                capture = io.StringIO()
                old_stderr = sys.stderr
                sys.stderr = capture
                try:
                    code = main(["--config", cfg_path, "--input", inp_path, "--quiet"])
                finally:
                    sys.stderr = old_stderr

                output = capture.getvalue()
                assert code == ExitCode.SUCCESS
                # Preflight INF/OK still present
                assert "Pre-flight validation" in output
                # Per-operation INF should NOT be present (quiet=True)
                assert "[INF] Adding user" not in output
                # Summary MUST be present
                assert "OK" in output
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# CLI — summary table verification
# ---------------------------------------------------------------------------


class TestSummaryOutput:
    def test_summary_shows_correct_counts(self) -> None:
        """AC12: summary shows correct counts and table."""
        cfg_path = _make_config_path()
        inp_path = _write_temp_yaml("""
operations:
  - action: add-user-to-group
    user_id: "u1"
    group_id: "g1"
  - action: add-user-to-group
    user_id: "u2"
    group_id: "g1"
  - action: remove-user-from-group
    user_id: "u3"
    group_id: "g1"
""")
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        try:
            with patch("src.preflight.GraphClient") as MockPreflightClient, \
                 patch("src.main.GraphClient") as MockExecClient:
                pf_client = MockPreflightClient.return_value
                pf_client.acquire_token.return_value = "token"
                pf_client.check_user_exists.return_value = True
                pf_client.check_group_exists.return_value = True

                exec_client = MockExecClient.return_value
                exec_client.add_user_to_group.side_effect = ["ok", "already_member"]
                exec_client.remove_user_from_group.return_value = "not_member"

                capture = io.StringIO()
                old_stderr = sys.stderr
                sys.stderr = capture
                try:
                    code = main(["--config", cfg_path, "--input", inp_path])
                finally:
                    sys.stderr = old_stderr

                output = capture.getvalue()
                assert code == ExitCode.WARNINGS
                assert "1 OK, 2 WRN, 0 ERR" in output
                assert "action" in output
                assert "status" in output
        finally:
            os.unlink(cfg_path)
            os.unlink(inp_path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# OperationResult / OperationStatus
# ---------------------------------------------------------------------------


class TestOperationResult:
    def test_fields(self) -> None:
        from src.config import Operation
        op = Operation("add-user-to-group", "u1", "g1")
        result = OperationResult(op, OperationStatus.OK, "Done")
        assert result.operation == op
        assert result.status == OperationStatus.OK
        assert result.message == "Done"


class TestOperationStatus:
    def test_values(self) -> None:
        assert OperationStatus.OK.value == "OK"
        assert OperationStatus.WRN.value == "WRN"
        assert OperationStatus.ERR.value == "ERR"
