"""Tests for config loading."""

from __future__ import annotations

import pytest
import yaml

from entra_bulk.config import load_config
from entra_bulk.exceptions import FatalError


def _write_config(tmp_path, data):
    p = tmp_path / "config.yaml"
    p.write_text(yaml.dump(data), encoding="utf-8")
    return p


class TestLoadConfig:
    def test_valid_config(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": ["add-user-to-group"],
        })
        cfg = load_config(p)
        assert cfg.tenant_id == "11111111-1111-1111-1111-111111111111"
        assert cfg.identity_id == "22222222-2222-2222-2222-222222222222"
        assert cfg.allowed_operations == frozenset(["add-user-to-group"])

    def test_file_not_found(self, tmp_path):
        with pytest.raises(FatalError, match="file not found"):
            load_config(tmp_path / "nonexistent.yaml")

    def test_missing_tenant_id(self, tmp_path):
        p = _write_config(tmp_path, {
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": ["add-user-to-group"],
        })
        with pytest.raises(FatalError, match="missing required field: tenant_id"):
            load_config(p)

    def test_missing_identity_id(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "allowed_operations": ["add-user-to-group"],
        })
        with pytest.raises(FatalError, match="missing required field: identity_id"):
            load_config(p)

    def test_missing_allowed_operations(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "22222222-2222-2222-2222-222222222222",
        })
        with pytest.raises(FatalError, match="missing required field: allowed_operations"):
            load_config(p)

    def test_malformed_tenant_guid(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "not-a-guid",
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": ["add-user-to-group"],
        })
        with pytest.raises(FatalError, match="tenant_id is not a valid GUID"):
            load_config(p)

    def test_malformed_identity_guid(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "bad-guid",
            "allowed_operations": ["add-user-to-group"],
        })
        with pytest.raises(FatalError, match="identity_id is not a valid GUID"):
            load_config(p)

    def test_bad_allowed_operations_unknown(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": ["bogus-op"],
        })
        with pytest.raises(FatalError, match="unknown operation"):
            load_config(p)

    def test_bad_allowed_operations_empty(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": [],
        })
        with pytest.raises(FatalError, match="non-empty list"):
            load_config(p)

    def test_bad_allowed_operations_not_list(self, tmp_path):
        p = _write_config(tmp_path, {
            "tenant_id": "11111111-1111-1111-1111-111111111111",
            "identity_id": "22222222-2222-2222-2222-222222222222",
            "allowed_operations": "add-user-to-group",
        })
        with pytest.raises(FatalError, match="non-empty list"):
            load_config(p)

    def test_malformed_yaml(self, tmp_path):
        p = tmp_path / "bad.yaml"
        p.write_text("{{{{invalid", encoding="utf-8")
        with pytest.raises(FatalError, match="YAML parse error"):
            load_config(p)

    def test_non_mapping_yaml(self, tmp_path):
        p = tmp_path / "list.yaml"
        p.write_text("- item1\n- item2\n", encoding="utf-8")
        with pytest.raises(FatalError, match="YAML mapping"):
            load_config(p)
