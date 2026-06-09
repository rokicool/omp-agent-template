"""Tests for CLI integration."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml
from click.testing import CliRunner

from entra_bulk.cli import main
from entra_bulk.models import ExecutionResult, OperationRecord, RecordStatus


@pytest.fixture
def runner():
    return CliRunner()


@pytest.fixture
def valid_config(tmp_path):
    p = tmp_path / "config.yaml"
    p.write_text(
        yaml.dump({
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": ["add-user-to-group"],
        }),
        encoding="utf-8",
    )
    return p


@pytest.fixture
def valid_input(tmp_path):
    p = tmp_path / "input.json"
    p.write_text(
        json.dumps([
            {"operation": "add-user-to-group", "user": "a@b.com", "group": "G"},
        ]),
        encoding="utf-8",
    )
    return p


class TestCLI:
    def test_missing_config(self, runner, valid_input):
        result = runner.invoke(
            main, ["--config", "/nonexistent.yaml", "--input", str(valid_input)]
        )
        assert result.exit_code == 2

    def test_missing_input(self, runner, valid_config):
        result = runner.invoke(
            main, ["--config", str(valid_config), "--input", "/nonexistent.json"]
        )
        assert result.exit_code == 2

    def test_missing_env_vars(self, runner, valid_config, valid_input, monkeypatch):
        monkeypatch.delenv("AZURE_CLIENT_ID", raising=False)
        result = runner.invoke(
            main,
            ["--config", str(valid_config), "--input", str(valid_input)],
        )
        assert result.exit_code == 2

    def test_validation_error_exits_2(self, runner, tmp_path):
        config = tmp_path / "config.yaml"
        config.write_text(
            yaml.dump({
                "tenant_id": "11111111-1111-1111-1111-111111111111",
                "identity_id": "22222222-2222-2222-2222-222222222222",
                "allowed_operations": ["add-user-to-group"],
            }),
            encoding="utf-8",
        )
        input_file = tmp_path / "input.json"
        input_file.write_text(
            json.dumps([{"operation": "", "user": "a@b.com", "group": "G"}]),
            encoding="utf-8",
        )
        result = runner.invoke(
            main, ["--config", str(config), "--input", str(input_file)]
        )
        assert result.exit_code == 2

    @patch("entra_bulk.cli.EntraGraphClient")
    @patch("entra_bulk.cli.execute")
    def test_dry_run_flag_passed(
        self, mock_execute, mock_client_cls, runner, valid_config, valid_input
    ):
        mock_execute.return_value = AsyncMock(return_value=[])()
        mock_execute.return_value = []
        mock_client_cls.return_value = MagicMock()

        result = runner.invoke(
            main,
            [
                "--config", str(valid_config),
                "--input", str(valid_input),
                "--dry-run",
            ],
        )
        mock_execute.assert_called_once()
        assert mock_execute.call_args.kwargs.get("dry_run") is True

    @patch("entra_bulk.cli.EntraGraphClient")
    @patch("entra_bulk.cli.execute")
    def test_exit_0_on_all_ok(
        self, mock_execute, mock_client_cls, runner, valid_config, valid_input
    ):
        rec = OperationRecord(
            operation="add-user-to-group", user="a@b.com", group="G", row=1
        )
        mock_execute.return_value = [
            ExecutionResult(record=rec, status=RecordStatus.OK, message="added")
        ]
        mock_client_cls.return_value = MagicMock()

        result = runner.invoke(
            main, ["--config", str(valid_config), "--input", str(valid_input)]
        )
        assert result.exit_code == 0

    @patch("entra_bulk.cli.EntraGraphClient")
    @patch("entra_bulk.cli.execute")
    def test_exit_1_on_error(
        self, mock_execute, mock_client_cls, runner, valid_config, valid_input
    ):
        rec = OperationRecord(
            operation="add-user-to-group", user="a@b.com", group="G", row=1
        )
        mock_execute.return_value = [
            ExecutionResult(record=rec, status=RecordStatus.ERR, message="fail")
        ]
        mock_client_cls.return_value = MagicMock()

        result = runner.invoke(
            main, ["--config", str(valid_config), "--input", str(valid_input)]
        )
        assert result.exit_code == 1
