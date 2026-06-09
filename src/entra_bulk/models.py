"""Data models for entra-bulk."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from enum import Enum

GUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class OperationType(str, Enum):
    ADD = "add-user-to-group"
    REMOVE = "remove-user-from-group"


class RecordStatus(str, Enum):
    OK = "OK"
    WRN = "WRN"
    ERR = "ERR"


@dataclass(frozen=True, slots=True)
class OperationRecord:
    """A single parsed input row before validation."""

    operation: str
    user: str
    group: str
    comment: str = ""
    row: int = 0  # 1-based row number for error reporting


@dataclass(slots=True)
class ValidationIssue:
    """A single validation error or warning."""

    row: int  # 1-based
    rule_id: str  # e.g. "VR-001"
    level: RecordStatus  # ERR or WRN
    message: str


@dataclass(slots=True)
class ValidationResult:
    """Accumulated result of Phase 1 validation."""

    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.level == RecordStatus.ERR]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.level == RecordStatus.WRN]

    @property
    def has_errors(self) -> bool:
        return any(i.level == RecordStatus.ERR for i in self.issues)

    def add(self, row: int, rule_id: str, level: RecordStatus, message: str) -> None:
        self.issues.append(ValidationIssue(row, rule_id, level, message))


@dataclass(slots=True)
class ExecutionResult:
    """Outcome of executing a single operation."""

    record: OperationRecord
    status: RecordStatus
    message: str
