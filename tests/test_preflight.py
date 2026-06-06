"""Tests for preflight.py — three-phase validation."""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from src.config import AppConfig, InputSpec, Operation
from src.graph_client import GraphError, NotFoundError, PermissionError, TokenError
from src.preflight import (
    PreflightResult,
    _validate_connectivity,
    _validate_cross_reference,
    _validate_existence,
    run,
)


def make_app_config(actions: frozenset[str] | None = None) -> AppConfig:
    if actions is None:
        actions = frozenset({"add-user-to-group", "remove-user-from-group"})
    return AppConfig(
        identity_id="app-1",
        tenant_id="tenant-1",
        client_secret="secret-1",
        actions=actions,
    )


def make_input_spec(operations: list[Operation] | None = None) -> InputSpec:
    if operations is None:
        operations = []
    return InputSpec(operations=operations)


# ---------------------------------------------------------------------------
# PreflightResult
# ---------------------------------------------------------------------------


class TestPreflightResult:
    def test_default_passed(self) -> None:
        pr = PreflightResult()
        assert pr.passed

    def test_not_passed_with_errors(self) -> None:
        pr = PreflightResult(errors=["e1"], err_count=1)
        assert not pr.passed

    def test_ok_count_increases_passed(self) -> None:
        pr = PreflightResult(ok_count=3)
        assert pr.passed


# ---------------------------------------------------------------------------
# Phase 1: cross-reference
# ---------------------------------------------------------------------------


class TestCrossReference:
    def test_all_actions_allowed(self) -> None:
        cfg = make_app_config(frozenset({"add-user-to-group"}))
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
                Operation("add-user-to-group", "u2", "g1"),
            ]
        )
        errors = _validate_cross_reference(spec, cfg)
        assert errors == []

    def test_action_not_allowed(self) -> None:
        cfg = make_app_config(frozenset({"add-user-to-group"}))
        spec = make_input_spec(
            [
                Operation("remove-user-from-group", "u1", "g1"),
            ]
        )
        errors = _validate_cross_reference(spec, cfg)
        assert len(errors) == 1
        assert "operations[0]" in errors[0]
        assert "remove-user-from-group" in errors[0]

    def test_multiple_violations_collected(self) -> None:
        cfg = make_app_config(frozenset())
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
                Operation("remove-user-from-group", "u2", "g1"),
            ]
        )
        errors = _validate_cross_reference(spec, cfg)
        assert len(errors) == 2


# ---------------------------------------------------------------------------
# Phase 2: connectivity
# ---------------------------------------------------------------------------


class TestConnectivity:
    def test_success(self) -> None:
        client = MagicMock()
        client.acquire_token.return_value = "token"
        errors = _validate_connectivity(client)
        assert errors == []

    def test_token_error(self) -> None:
        client = MagicMock()
        client.acquire_token.side_effect = TokenError("bad token")
        errors = _validate_connectivity(client)
        assert len(errors) == 1
        assert "bad token" in errors[0]


# ---------------------------------------------------------------------------
# Phase 3: existence
# ---------------------------------------------------------------------------


class TestExistence:
    def test_all_exist(self) -> None:
        client = MagicMock()
        client.check_user_exists.return_value = True
        client.check_group_exists.return_value = True
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
                Operation("add-user-to-group", "u2", "g1"),
            ]
        )
        errors = _validate_existence(spec, client)
        assert errors == []

    def test_deduplication(self) -> None:
        """Same user_id checked only once."""
        client = MagicMock()
        client.check_user_exists.return_value = True
        client.check_group_exists.return_value = True
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
                Operation("add-user-to-group", "u1", "g2"),
                Operation("remove-user-from-group", "u1", "g1"),
            ]
        )
        _validate_existence(spec, client)
        # u1 should be checked exactly once
        assert client.check_user_exists.call_count == 1
        # g1 and g2: two unique groups
        assert client.check_group_exists.call_count == 2

    def test_user_not_found(self) -> None:
        client = MagicMock()
        client.check_user_exists.side_effect = NotFoundError("not found", 404)
        client.check_group_exists.return_value = True
        spec = make_input_spec([Operation("add-user-to-group", "u1", "g1")])
        errors = _validate_existence(spec, client)
        assert len(errors) == 1
        assert "not found" in errors[0]

    def test_group_not_found(self) -> None:
        client = MagicMock()
        client.check_user_exists.return_value = True
        client.check_group_exists.side_effect = NotFoundError("not found", 404)
        spec = make_input_spec([Operation("add-user-to-group", "u1", "g1")])
        errors = _validate_existence(spec, client)
        assert len(errors) == 1
        assert "Group" in errors[0]

    def test_permission_error_stops_checking(self) -> None:
        client = MagicMock()
        client.check_user_exists.side_effect = PermissionError("no perms", 403)
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
                Operation("add-user-to-group", "u2", "g2"),
            ]
        )
        errors = _validate_existence(spec, client)
        assert len(errors) == 1
        assert "Insufficient permissions" in errors[0]
        # Should stop after first permission error on users
        assert client.check_user_exists.call_count == 1
        # Groups should not be checked
        client.check_group_exists.assert_not_called()

    def test_graph_error_collected(self) -> None:
        client = MagicMock()
        client.check_user_exists.side_effect = GraphError("unexpected", 500)
        client.check_group_exists.return_value = True
        spec = make_input_spec([Operation("add-user-to-group", "u1", "g1")])
        errors = _validate_existence(spec, client)
        assert len(errors) == 1
        assert "unexpected" in errors[0]


# ---------------------------------------------------------------------------
# run() — orchestration
# ---------------------------------------------------------------------------


class TestRunOrchestration:
    def test_run_all_phases_pass(self) -> None:
        cfg = make_app_config()
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
            ]
        )
        # Mock GraphClient at the module level where it's imported
        with patch("src.preflight.GraphClient") as MockClient:
            mock_client = MockClient.return_value
            mock_client.acquire_token.return_value = "token"
            mock_client.check_user_exists.return_value = True
            mock_client.check_group_exists.return_value = True

            result = run(spec, cfg)
            assert result.passed
            assert result.ok_count >= 2  # phase1 + phase2 + phase3 OK messages
            assert result.err_count == 0

    def test_run_cross_reference_fails(self) -> None:
        cfg = make_app_config(frozenset({"add-user-to-group"}))
        spec = make_input_spec(
            [
                Operation("remove-user-from-group", "u1", "g1"),
            ]
        )
        with patch("src.preflight.GraphClient") as MockClient:
            result = run(spec, cfg)
            assert not result.passed
            assert result.err_count >= 1

    def test_run_connectivity_fails_skips_existence(self) -> None:
        cfg = make_app_config()
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
            ]
        )
        with patch("src.preflight.GraphClient") as MockClient:
            mock_client = MockClient.return_value
            mock_client.acquire_token.side_effect = TokenError("auth failed")

            result = run(spec, cfg)
            # Cross-ref passes, connectivity fails
            assert not result.passed
            # Existence should NOT be checked
            mock_client.check_user_exists.assert_not_called()
            mock_client.check_group_exists.assert_not_called()

    def test_run_no_preflight_skips_connectivity_existence(self) -> None:
        cfg = make_app_config()
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
            ]
        )
        with patch("src.preflight.GraphClient") as MockClient:
            result = run(spec, cfg, no_preflight=True)
            # Cross-ref passes (action is in config.actions)
            assert result.passed
            # GraphClient should NOT be instantiated
            MockClient.assert_not_called()

    def test_run_existence_fails(self) -> None:
        cfg = make_app_config()
        spec = make_input_spec(
            [
                Operation("add-user-to-group", "u1", "g1"),
            ]
        )
        with patch("src.preflight.GraphClient") as MockClient:
            mock_client = MockClient.return_value
            mock_client.acquire_token.return_value = "token"
            mock_client.check_user_exists.return_value = True
            mock_client.check_group_exists.side_effect = NotFoundError("gone", 404)

            result = run(spec, cfg)
            assert not result.passed
            assert result.err_count >= 1
            assert any("Group" in e for e in result.errors)
