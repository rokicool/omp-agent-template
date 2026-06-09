"""Tests for data models."""

from __future__ import annotations

import pytest

from entra_bulk.models import (
    ExecutionResult,
    OperationRecord,
    RecordStatus,
    ValidationIssue,
    ValidationResult,
)


class TestValidationResult:
    def test_errors_filtering(self):
        vr = ValidationResult()
        vr.add(1, "VR-001", RecordStatus.ERR, "bad op")
        vr.add(2, "VR-008", RecordStatus.WRN, "dup")
        vr.add(3, "VR-003", RecordStatus.ERR, "no user")
        assert len(vr.errors) == 2
        assert all(i.level == RecordStatus.ERR for i in vr.errors)

    def test_warnings_filtering(self):
        vr = ValidationResult()
        vr.add(1, "VR-001", RecordStatus.ERR, "bad op")
        vr.add(2, "VR-008", RecordStatus.WRN, "dup")
        assert len(vr.warnings) == 1
        assert vr.warnings[0].rule_id == "VR-008"

    def test_has_errors_true(self):
        vr = ValidationResult()
        vr.add(1, "VR-001", RecordStatus.ERR, "bad")
        assert vr.has_errors is True

    def test_has_errors_false_only_warnings(self):
        vr = ValidationResult()
        vr.add(1, "VR-008", RecordStatus.WRN, "dup")
        assert vr.has_errors is False

    def test_has_errors_false_empty(self):
        vr = ValidationResult()
        assert vr.has_errors is False


class TestOperationRecord:
    def test_frozen(self):
        rec = OperationRecord(
            operation="add-user-to-group",
            user="a@b.com",
            group="G",
            row=1,
        )
        with pytest.raises(AttributeError):
            rec.operation = "other"

    def test_default_comment(self):
        rec = OperationRecord(
            operation="add-user-to-group",
            user="a@b.com",
            group="G",
        )
        assert rec.comment == ""
        assert rec.row == 0
