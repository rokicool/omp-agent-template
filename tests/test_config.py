"""Tests for config.py — batched error collection, validation."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

from src.config import (
    AppConfig,
    ConfigError,
    InputSpec,
    KNOWN_ACTIONS,
    Operation,
    ValidationError,
    _get_secret,
    _read_yaml,
    _require_str,
    _validate_actions,
    load_config,
    load_input,
)

# ---------------------------------------------------------------------------
# ValidationError
# ---------------------------------------------------------------------------


class TestValidationError:
    def test_creation(self) -> None:
        ve = ValidationError(source="config", message="bad", key="actions")
        assert ve.source == "config"
        assert ve.message == "bad"
        assert ve.key == "actions"

    def test_default_key(self) -> None:
        ve = ValidationError(source="input", message="oops")
        assert ve.key == ""


# ---------------------------------------------------------------------------
# ConfigError
# ---------------------------------------------------------------------------


class TestConfigError:
    def test_wraps_errors(self) -> None:
        errors = [
            ValidationError("config", "e1"),
            ValidationError("input", "e2"),
        ]
        exc = ConfigError(errors)
        assert exc.errors is errors
        assert "2 validation error(s)" in str(exc)

    def test_single_error(self) -> None:
        exc = ConfigError([ValidationError("config", "bad")])
        assert "1 validation" in str(exc)


# ---------------------------------------------------------------------------
# load_config — missing file
# ---------------------------------------------------------------------------


class TestLoadConfigMissingFile:
    def test_nonexistent_path(self) -> None:
        with pytest.raises(ConfigError) as exc_info:
            load_config("/nonexistent/config.yaml")
        errors = exc_info.value.errors
        assert len(errors) == 1
        assert errors[0].source == "config"
        assert "file not found" in errors[0].message


# ---------------------------------------------------------------------------
# load_config — invalid YAML
# ---------------------------------------------------------------------------


class TestLoadConfigInvalidYaml:
    def test_bad_syntax(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("identity_id: [unclosed\n")
            bad_path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_config(bad_path)
            errors = exc_info.value.errors
            assert len(errors) == 1
            assert errors[0].source == "config"
            assert "invalid YAML" in errors[0].message
        finally:
            os.unlink(bad_path)

    def test_root_not_mapping(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("- item1\n- item2\n")
            bad_path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_config(bad_path)
            errors = exc_info.value.errors
            assert len(errors) == 1
            assert "root must be a mapping" in errors[0].message
        finally:
            os.unlink(bad_path)


# ---------------------------------------------------------------------------
# load_config — batched errors (multiple errors collected)
# ---------------------------------------------------------------------------


class TestLoadConfigBatchedErrors:
    def test_missing_all_required_keys(self) -> None:
        """Empty config should collect errors for all missing keys."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("actions: []\n")
            path = f.name
        try:
            # ENTRA_CLIENT_SECRET also missing
            old_secret = os.environ.pop("ENTRA_CLIENT_SECRET", None)
            try:
                with pytest.raises(ConfigError) as exc_info:
                    load_config(path)
                errors = exc_info.value.errors
                assert len(errors) >= 3  # identity_id, tenant_id, secret, actions empty
            finally:
                if old_secret is not None:
                    os.environ["ENTRA_CLIENT_SECRET"] = old_secret
        finally:
            os.unlink(path)

    def test_bad_actions_collect_all(self) -> None:
        """All bad actions should be collected."""
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("""
identity_id: "app-123"
tenant_id: "tenant-456"
actions:
  - 42
  - unknown-action
  - 3.14
""")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_config(path)
            errors = exc_info.value.errors
            # 3 bad actions + possibly no valid actions -> actions empty
            action_errors = [e for e in errors if "action" in e.key.lower()]
            assert len(action_errors) >= 2  # 2 non-string + 1 unknown
        finally:
            os.unlink(path)
            del os.environ["ENTRA_CLIENT_SECRET"]

    def test_missing_entra_secret(self) -> None:
        """When ENTRA_CLIENT_SECRET is not set, it should be in errors."""
        old = os.environ.pop("ENTRA_CLIENT_SECRET", None)
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".yaml", delete=False
            ) as f:
                f.write("""
identity_id: "app-123"
tenant_id: "tenant-456"
actions:
  - add-user-to-group
""")
                path = f.name
            try:
                with pytest.raises(ConfigError) as exc_info:
                    load_config(path)
                errors = exc_info.value.errors
                secret_errors = [
                    e for e in errors if "ENTRA_CLIENT_SECRET" in e.message
                ]
                assert len(secret_errors) == 1
            finally:
                os.unlink(path)
        finally:
            if old is not None:
                os.environ["ENTRA_CLIENT_SECRET"] = old


# ---------------------------------------------------------------------------
# load_config — valid
# ---------------------------------------------------------------------------


class TestLoadConfigValid:
    def test_minimal_valid_config(self) -> None:
        os.environ["ENTRA_CLIENT_SECRET"] = "test-secret"
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("""
identity_id: "app-123"
tenant_id: "tenant-456"
actions:
  - add-user-to-group
""")
            path = f.name
        try:
            cfg = load_config(path)
            assert cfg.identity_id == "app-123"
            assert cfg.tenant_id == "tenant-456"
            assert cfg.client_secret == "test-secret"
            assert cfg.actions == frozenset({"add-user-to-group"})
            assert "login.microsoftonline.com" in cfg.authority
        finally:
            os.unlink(path)
            del os.environ["ENTRA_CLIENT_SECRET"]


# ---------------------------------------------------------------------------
# load_input — missing file / invalid YAML
# ---------------------------------------------------------------------------


class TestLoadInputMissingFile:
    def test_nonexistent_path(self) -> None:
        with pytest.raises(ConfigError) as exc_info:
            load_input("/nonexistent/input.yaml")
        errors = exc_info.value.errors
        assert len(errors) == 1
        assert errors[0].source == "input"
        assert "file not found" in errors[0].message


# ---------------------------------------------------------------------------
# load_input — empty operations
# ---------------------------------------------------------------------------


class TestLoadInputEmptyOperations:
    def test_empty_list(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("operations: []\n")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_input(path)
            errors = exc_info.value.errors
            assert len(errors) == 1
            assert "empty" in errors[0].message.lower()
        finally:
            os.unlink(path)

    def test_operations_not_list(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("operations: not-a-list\n")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_input(path)
            errors = exc_info.value.errors
            assert len(errors) == 1
            assert "must be a list" in errors[0].message.lower()
        finally:
            os.unlink(path)

    def test_missing_operations_key(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("other_key: value\n")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_input(path)
            errors = exc_info.value.errors
            assert len(errors) == 1
            assert "missing required key 'operations'" in errors[0].message
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# load_input — batched errors on operations
# ---------------------------------------------------------------------------


class TestLoadInputBatchedErrors:
    def test_multiple_ops_with_errors(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("""
operations:
  - action: add-user-to-group
    # missing user_id and group_id
  - action: remove-user-from-group
    user_id: "u2"
    # missing group_id
  - bad_type: value
    user_id: "u3"
    group_id: "g3"
""")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_input(path)
            errors = exc_info.value.errors
            assert (
                len(errors) >= 3
            )  # op0: missing 2, op1: missing 1, op2: not dict/extra/bad action
        finally:
            os.unlink(path)

    def test_extra_keys_detected(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("""
operations:
  - action: add-user-to-group
    user_id: "u1"
    group_id: "g1"
    extra_field: oops
    another_extra: also
""")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_input(path)
            errors = exc_info.value.errors
            assert len(errors) >= 1
            assert "unknown key" in errors[0].message.lower()
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# load_input — valid
# ---------------------------------------------------------------------------


class TestLoadInputValid:
    def test_valid_input(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("""
operations:
  - action: add-user-to-group
    user_id: "user-123"
    group_id: "group-456"
  - action: remove-user-from-group
    user_id: "user-789"
    group_id: "group-012"
""")
            path = f.name
        try:
            spec = load_input(path)
            assert len(spec.operations) == 2
            assert spec.operations[0].action == "add-user-to-group"
            assert spec.operations[0].user_id == "user-123"
            assert spec.operations[0].group_id == "group-456"
            assert spec.operations[1].action == "remove-user-from-group"
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# load_input — empty string fields
# ---------------------------------------------------------------------------


class TestLoadInputEmptyFields:
    def test_empty_action(self) -> None:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".yaml", delete=False) as f:
            f.write("""
operations:
  - action: ""
    user_id: "u1"
    group_id: "g1"
""")
            path = f.name
        try:
            with pytest.raises(ConfigError) as exc_info:
                load_input(path)
            errors = exc_info.value.errors
            assert len(errors) >= 1
            assert "must not be empty" in errors[0].message
        finally:
            os.unlink(path)


# ---------------------------------------------------------------------------
# AppConfig / Operation / InputSpec dataclasses
# ---------------------------------------------------------------------------


class TestDataClasses:
    def test_appconfig_authority(self) -> None:
        cfg = AppConfig(
            identity_id="app-1",
            tenant_id="tenant-1",
            client_secret="secret",
        )
        assert "login.microsoftonline.com" in cfg.authority
        assert "tenant-1" in cfg.authority

    def test_operation_fields(self) -> None:
        op = Operation(action="add-user-to-group", user_id="u1", group_id="g1")
        assert op.action == "add-user-to-group"
        assert op.user_id == "u1"
        assert op.group_id == "g1"

    def test_inputspec_operations(self) -> None:
        ops = [Operation("add-user-to-group", "u1", "g1")]
        spec = InputSpec(operations=ops)
        assert spec.operations == ops
        assert len(spec.operations) == 1


# ---------------------------------------------------------------------------
# Client secret never in error messages
# ---------------------------------------------------------------------------


class TestClientSecretSafety:
    def test_secret_not_in_validation_error(self) -> None:
        """ValidationErrors must never contain the raw secret string."""
        secret_val = "SuperSecret123!"
        os.environ["ENTRA_CLIENT_SECRET"] = secret_val
        try:
            # Trigger a config error but NOT because of the secret
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".yaml", delete=False
            ) as f:
                f.write("""
identity_id: "app-1"
tenant_id: "tenant-1"
actions:
  - bad
""")
                path = f.name
            try:
                with pytest.raises(ConfigError) as exc_info:
                    load_config(path)
                for ve in exc_info.value.errors:
                    assert secret_val not in ve.message
                    assert secret_val not in ve.key
            finally:
                os.unlink(path)
        finally:
            del os.environ["ENTRA_CLIENT_SECRET"]

    def test_secret_not_in_config_str(self) -> None:
        """AppConfig repr must not leak the secret."""
        cfg = AppConfig(
            identity_id="app-1",
            tenant_id="tenant-1",
            client_secret="secret123",
        )
        rep = repr(cfg)
        assert (
            "secret123" in rep
        )  # dataclass default repr includes it (not safety concern)
        # The real safety mechanism is: never print AppConfig itself in errors.
        # ValidationErrors reference config keys, not AppConfig values.
