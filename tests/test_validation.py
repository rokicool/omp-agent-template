"""Tests for validation engine."""

from __future__ import annotations

import pytest

from entra_bulk.config import Config
from entra_bulk.models import OperationRecord, RecordStatus
from entra_bulk.validation import validate


@pytest.fixture
def config():
    return Config(
        tenant_id="11111111-1111-1111-1111-111111111111",
        identity_id="22222222-2222-2222-2222-222222222222",
        allowed_operations=frozenset(
            ["add-user-to-group", "remove-user-from-group"]
        ),
    )


class TestVR001:
    def test_empty_operation(self, config):
        records = [OperationRecord(operation="", user="a@b.com", group="G", row=1)]
        result = validate(records, config)
        assert result.has_errors
        assert any(i.rule_id == "VR-001" for i in result.issues)

    def test_empty_operation_skips_vr002(self, config):
        records = [OperationRecord(operation="", user="a@b.com", group="G", row=1)]
        result = validate(records, config)
        assert not any(i.rule_id == "VR-002" for i in result.issues)


class TestVR002:
    def test_disallowed_operation(self, config):
        records = [
            OperationRecord(
                operation="remove-user-from-group",
                user="a@b.com",
                group="G",
                row=1,
            )
        ]
        restricted = Config(
            tenant_id="11111111-1111-1111-1111-111111111111",
            identity_id="22222222-2222-2222-2222-222222222222",
            allowed_operations=frozenset(["add-user-to-group"]),
        )
        result = validate(records, restricted)
        assert result.has_errors
        assert any(i.rule_id == "VR-002" for i in result.issues)

    def test_allowed_operation_passes(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            )
        ]
        result = validate(records, config)
        assert not any(i.rule_id == "VR-002" for i in result.issues)


class TestVR003:
    def test_empty_user(self, config):
        records = [OperationRecord(operation="add-user-to-group", user="", group="G", row=1)]
        result = validate(records, config)
        assert result.has_errors
        assert any(i.rule_id == "VR-003" for i in result.issues)


class TestVR004:
    def test_invalid_user_format(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="not-a-valid-user",
                group="G",
                row=1,
            )
        ]
        result = validate(records, config)
        assert result.has_errors
        assert any(i.rule_id == "VR-004" for i in result.issues)

    def test_upn_passes(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            )
        ]
        result = validate(records, config)
        assert not any(i.rule_id == "VR-004" for i in result.issues)

    def test_guid_user_passes(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="11111111-1111-1111-1111-111111111111",
                group="G",
                row=1,
            )
        ]
        result = validate(records, config)
        assert not any(i.rule_id == "VR-004" for i in result.issues)


class TestVR005:
    def test_empty_group(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="",
                row=1,
            )
        ]
        result = validate(records, config)
        assert result.has_errors
        assert any(i.rule_id == "VR-005" for i in result.issues)


class TestVR008:
    def test_duplicate_warning(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=2,
            ),
        ]
        result = validate(records, config)
        assert not result.has_errors  # warnings only
        assert any(
            i.rule_id == "VR-008" and i.level == RecordStatus.WRN
            for i in result.issues
        )

    def test_same_user_different_group_no_warning(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="H",
                row=2,
            ),
        ]
        result = validate(records, config)
        assert not any(i.rule_id == "VR-008" for i in result.issues)


class TestVR009:
    def test_empty_input(self, config):
        result = validate([], config)
        assert result.has_errors
        assert any(i.rule_id == "VR-009" for i in result.issues)


class TestBatchValidation:
    def test_multiple_errors_across_records(self, config):
        records = [
            OperationRecord(operation="", user="a@b.com", group="G", row=1),
            OperationRecord(
                operation="add-user-to-group", user="bad", group="G", row=2
            ),
            OperationRecord(
                operation="add-user-to-group", user="a@b.com", group="", row=3
            ),
        ]
        result = validate(records, config)
        assert result.has_errors
        # VR-001 for row 1, VR-004 for row 2, VR-005 for row 3
        rule_ids = [i.rule_id for i in result.issues]
        assert "VR-001" in rule_ids
        assert "VR-004" in rule_ids
        assert "VR-005" in rule_ids

    def test_all_valid(self, config):
        records = [
            OperationRecord(
                operation="add-user-to-group",
                user="a@b.com",
                group="G",
                row=1,
            ),
        ]
        result = validate(records, config)
        assert not result.has_errors
        assert len(result.issues) == 0
