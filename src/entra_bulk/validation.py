"""Phase 1 validation engine."""

from __future__ import annotations

from entra_bulk.config import Config
from entra_bulk.models import (
    GUID_RE,
    OperationRecord,
    RecordStatus,
    ValidationResult,
)


def validate(records: list[OperationRecord], config: Config) -> ValidationResult:
    """Run all VR-xxx rules against the record list."""
    result = ValidationResult()

    # VR-009: empty input
    if not records:
        result.add(
            row=0,
            rule_id="VR-009",
            level=RecordStatus.ERR,
            message="input file contains no records",
        )
        return result

    seen: set[tuple[str, str, str]] = set()

    for rec in records:
        r = rec.row

        # VR-001: operation present
        if not rec.operation:
            result.add(r, "VR-001", RecordStatus.ERR, "operation field is empty")
            continue  # no point checking VR-002 without a value

        # VR-002: operation in allowed_operations
        if rec.operation not in config.allowed_operations:
            result.add(
                r,
                "VR-002",
                RecordStatus.ERR,
                f'operation "{rec.operation}" not in allowed_operations',
            )

        # VR-003: user present
        if not rec.user:
            result.add(r, "VR-003", RecordStatus.ERR, "user field is empty")
        else:
            # VR-004: user is UPN or GUID
            if "@" not in rec.user and not GUID_RE.match(rec.user):
                result.add(
                    r,
                    "VR-004",
                    RecordStatus.ERR,
                    f'user "{rec.user}" is not a valid UPN or GUID',
                )

        # VR-005: group present
        if not rec.group:
            result.add(r, "VR-005", RecordStatus.ERR, "group field is empty")

        # VR-008: duplicate detection
        key = (rec.operation, rec.user, rec.group)
        if key in seen:
            result.add(
                r,
                "VR-008",
                RecordStatus.WRN,
                "duplicate record (same operation + user + group)",
            )
        else:
            seen.add(key)

    return result
