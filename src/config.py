"""YAML configuration loading and schema validation with batched error collection."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

KNOWN_ACTIONS: frozenset[str] = frozenset({"add-user-to-group", "remove-user-from-group"})


@dataclass
class ValidationError:
    """A single schema validation error."""

    source: str  # "config" | "input"
    message: str
    key: str = ""


class ConfigError(Exception):
    """Raised when configuration or input validation fails."""

    def __init__(self, errors: list[ValidationError]) -> None:
        self.errors = errors
        super().__init__(f"{len(errors)} validation error(s)")


@dataclass
class AppConfig:
    identity_id: str
    tenant_id: str
    client_secret: str
    actions: frozenset[str] = field(default_factory=lambda: KNOWN_ACTIONS)

    @property
    def authority(self) -> str:
        return f"https://login.microsoftonline.com/{self.tenant_id}"


@dataclass
class Operation:
    action: str
    user_id: str
    group_id: str


@dataclass
class InputSpec:
    operations: list[Operation]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def load_config(path: str | Path) -> AppConfig:
    """Load application configuration from a YAML file.

    Collects ALL validation errors before raising ConfigError.
    """
    errors: list[ValidationError] = []
    p = Path(path)

    raw = _read_yaml(p, "config", errors)
    if raw is None:
        raise ConfigError(errors)

    identity_id = _require_str(raw, "identity_id", "config", errors)
    tenant_id = _require_str(raw, "tenant_id", "config", errors)
    client_secret = _get_secret(errors)
    actions_frozen = _validate_actions(raw, errors)

    if errors:
        raise ConfigError(errors)

    # Sentinel values safe: errors list was empty, so all helpers returned real values
    return AppConfig(
        identity_id=identity_id,
        tenant_id=tenant_id,
        client_secret=client_secret,
        actions=actions_frozen,
    )


def load_input(path: str | Path) -> InputSpec:
    """Load input file containing operations.

    Collects ALL validation errors before raising ConfigError.
    Schema-level only: action cross-reference with config.actions
    is deferred to preflight.
    """
    errors: list[ValidationError] = []
    p = Path(path)

    raw = _read_yaml(p, "input", errors)
    if raw is None:
        raise ConfigError(errors)

    if not isinstance(raw, dict):
        errors.append(ValidationError(
            source="input",
            message=f"root must be a mapping, got {type(raw).__name__}",
            key="",
        ))
        raise ConfigError(errors)

    ops_raw = raw.get("operations")
    if ops_raw is None:
        errors.append(ValidationError(
            source="input", message="missing required key 'operations'", key="operations",
        ))
        raise ConfigError(errors)
    if not isinstance(ops_raw, list):
        errors.append(ValidationError(
            source="input",
            message=f"'operations' must be a list, got {type(ops_raw).__name__}",
            key="operations",
        ))
        raise ConfigError(errors)
    if not ops_raw:
        errors.append(ValidationError(
            source="input", message="'operations' list is empty", key="operations",
        ))
        raise ConfigError(errors)

    operations: list[Operation] = []
    for i, entry in enumerate(ops_raw):
        if not isinstance(entry, dict):
            errors.append(ValidationError(
                source="input",
                message=f"operations[{i}] must be a mapping, got {type(entry).__name__}",
                key=f"operations[{i}]",
            ))
            continue

        # Check for extra keys
        extra_keys = set(entry.keys()) - {"action", "user_id", "group_id"}
        if extra_keys:
            keys_str = ", ".join(sorted(extra_keys))
            errors.append(ValidationError(
                source="input",
                message=f"operations[{i}] contains unknown key(s): {keys_str}",
                key=f"operations[{i}]",
            ))
            continue

        action = _require_str_in_dict(entry, "action", "input", errors, f"operations[{i}]")
        user_id = _require_str_in_dict(entry, "user_id", "input", errors, f"operations[{i}]")
        group_id = _require_str_in_dict(entry, "group_id", "input", errors, f"operations[{i}]")

        # Only create operation if all three fields are valid strings
        if action is not None and user_id is not None and group_id is not None:
            operations.append(Operation(action=action, user_id=user_id, group_id=group_id))

    if errors:
        raise ConfigError(errors)

    return InputSpec(operations=operations)


# ---------------------------------------------------------------------------
# Internal helpers — all append to a shared errors list
# ---------------------------------------------------------------------------


def _read_yaml(path: Path, label: str, errors: list[ValidationError]) -> dict[str, Any] | None:
    """Read and parse YAML. Returns None if unrecoverable, appends to errors."""
    if not path.exists():
        errors.append(ValidationError(
            source=label,
            message=f"file not found at '{path}'",
            key="",
        ))
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except yaml.YAMLError as exc:
        errors.append(ValidationError(
            source=label,
            message=f"invalid YAML — {exc}",
            key="",
        ))
        return None
    if not isinstance(data, dict):
        errors.append(ValidationError(
            source=label,
            message=f"root must be a mapping, got {type(data).__name__}",
            key="",
        ))
        return None
    return data


def _require_str(
    mapping: dict[str, Any],
    key: str,
    label: str,
    errors: list[ValidationError],
) -> str:
    """Require a non-empty string value. Returns "" on error (sentinel)."""
    return _require_str_in_dict(mapping, key, label, errors, "")


def _require_str_in_dict(
    mapping: dict[str, Any],
    key: str,
    label: str,
    errors: list[ValidationError],
    prefix: str,
) -> str | None:
    """Require a non-empty string in a dict. Returns None on error.

    The `prefix` is prepended to the key path for nested error messages
    (e.g. "operations[2]").
    """
    key_path = f"{prefix}.{key}" if prefix else key
    value = mapping.get(key)
    if value is None:
        errors.append(ValidationError(
            source=label,
            message=f"missing required key '{key_path}'",
            key=key_path,
        ))
        return None
    if not isinstance(value, str):
        errors.append(ValidationError(
            source=label,
            message=f"'{key_path}' must be a string, got {type(value).__name__}",
            key=key_path,
        ))
        return None
    stripped = value.strip()
    if not stripped:
        errors.append(ValidationError(
            source=label,
            message=f"'{key_path}' must not be empty",
            key=key_path,
        ))
        return None
    return stripped


def _require_list(
    mapping: dict[str, Any],
    key: str,
    label: str,
    errors: list[ValidationError],
) -> list[Any] | None:
    """Require a non-empty list. Returns None on error."""
    value = mapping.get(key)
    if value is None:
        errors.append(ValidationError(
            source=label,
            message=f"missing required key '{key}'",
            key=key,
        ))
        return None
    if not isinstance(value, list):
        errors.append(ValidationError(
            source=label,
            message=f"'{key}' must be a list, got {type(value).__name__}",
            key=key,
        ))
        return None
    return value


def _get_secret(errors: list[ValidationError]) -> str:
    """Get ENTRA_CLIENT_SECRET from env. Returns "" on error (sentinel)."""
    secret = os.environ.get("ENTRA_CLIENT_SECRET", "")
    if not secret:
        errors.append(ValidationError(
            source="config",
            message="ENTRA_CLIENT_SECRET environment variable is not set",
            key="",
        ))
    return secret


def _validate_actions(
    raw: dict[str, Any],
    errors: list[ValidationError],
) -> frozenset[str]:
    """Validate the 'actions' key. Returns frozenset (empty on error)."""
    actions_list = raw.get("actions")
    if actions_list is None:
        errors.append(ValidationError(
            source="config",
            message="missing required key 'actions'",
            key="actions",
        ))
        return frozenset()
    if not isinstance(actions_list, list):
        errors.append(ValidationError(
            source="config",
            message=f"'actions' must be a list, got {type(actions_list).__name__}",
            key="actions",
        ))
        return frozenset()
    if not actions_list:
        errors.append(ValidationError(
            source="config",
            message="'actions' must be a non-empty list",
            key="actions",
        ))
        return frozenset()

    actions: set[str] = set()
    for i, action in enumerate(actions_list):
        if not isinstance(action, str):
            errors.append(ValidationError(
                source="config",
                message=f"actions[{i}] must be a string, got {type(action).__name__}",
                key=f"actions[{i}]",
            ))
            continue
        if action not in KNOWN_ACTIONS:
            known = ", ".join(sorted(KNOWN_ACTIONS))
            errors.append(ValidationError(
                source="config",
                message=f"actions[{i}] '{action}' is not a known action. Known: {known}",
                key=f"actions[{i}]",
            ))
            continue
        actions.add(action)

    return frozenset(actions)
