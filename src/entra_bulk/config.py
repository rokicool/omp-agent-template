"""Config loading and validation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml

from entra_bulk.exceptions import FatalError
from entra_bulk.models import GUID_RE, OperationType


@dataclass(frozen=True, slots=True)
class Config:
    tenant_id: str
    identity_id: str
    allowed_operations: frozenset[str]


def load_config(path: str | Path) -> Config:
    """Load and validate a YAML config file."""
    path = Path(path)

    if not path.exists():
        raise FatalError(f"file not found: {path}")

    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise FatalError(f"YAML parse error in {path}: {e}")

    if not isinstance(raw, dict):
        raise FatalError(f"config must be a YAML mapping, got {type(raw).__name__}")

    tenant_id = raw.get("tenant_id")
    identity_id = raw.get("identity_id")
    allowed = raw.get("allowed_operations")

    if tenant_id is None:
        raise FatalError("missing required field: tenant_id")
    if identity_id is None:
        raise FatalError("missing required field: identity_id")
    if allowed is None:
        raise FatalError("missing required field: allowed_operations")

    if not GUID_RE.match(str(tenant_id)):
        raise FatalError(f"tenant_id is not a valid GUID: {tenant_id}")
    if not GUID_RE.match(str(identity_id)):
        raise FatalError(f"identity_id is not a valid GUID: {identity_id}")

    known_ops = {OperationType.ADD.value, OperationType.REMOVE.value}
    if not isinstance(allowed, list) or len(allowed) == 0:
        raise FatalError("allowed_operations must be a non-empty list")
    for op in allowed:
        if op not in known_ops:
            raise FatalError(f"unknown operation in allowed_operations: {op!r}")

    return Config(
        tenant_id=str(tenant_id),
        identity_id=str(identity_id),
        allowed_operations=frozenset(allowed),
    )
