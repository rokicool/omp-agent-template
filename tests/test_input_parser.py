"""Tests for input parsing."""

from __future__ import annotations

import json

import pytest
import yaml

from entra_bulk.exceptions import FatalError
from entra_bulk.input_parser import parse_input


class TestParseInput:
    def test_json_basic(self, tmp_path):
        data = [
            {"operation": "add-user-to-group", "user": "a@b.com", "group": "G"},
            {"operation": "remove-user-from-group", "user": "c@d.com", "group": "H"},
        ]
        p = tmp_path / "input.json"
        p.write_text(json.dumps(data), encoding="utf-8")
        records = parse_input(p)
        assert len(records) == 2
        assert records[0].operation == "add-user-to-group"
        assert records[0].user == "a@b.com"
        assert records[0].row == 1
        assert records[1].row == 2

    def test_json_with_comment(self, tmp_path):
        data = [{"operation": "add-user-to-group", "user": "a@b.com", "group": "G", "comment": "test"}]
        p = tmp_path / "input.json"
        p.write_text(json.dumps(data), encoding="utf-8")
        records = parse_input(p)
        assert records[0].comment == "test"

    def test_json_missing_fields_defaults(self, tmp_path):
        data = [{}]
        p = tmp_path / "input.json"
        p.write_text(json.dumps(data), encoding="utf-8")
        records = parse_input(p)
        assert records[0].operation == ""
        assert records[0].user == ""
        assert records[0].group == ""

    def test_json_not_array(self, tmp_path):
        p = tmp_path / "input.json"
        p.write_text('{"operation": "add-user-to-group"}', encoding="utf-8")
        with pytest.raises(FatalError, match="JSON input must be an array"):
            parse_input(p)

    def test_json_parse_error(self, tmp_path):
        p = tmp_path / "input.json"
        p.write_text("{invalid json", encoding="utf-8")
        with pytest.raises(FatalError, match="JSON parse error"):
            parse_input(p)

    def test_yaml_basic(self, tmp_path):
        data = [
            {"operation": "add-user-to-group", "user": "a@b.com", "group": "G"},
        ]
        p = tmp_path / "input.yaml"
        p.write_text(yaml.dump(data), encoding="utf-8")
        records = parse_input(p)
        assert len(records) == 1
        assert records[0].row == 1

    def test_yml_extension(self, tmp_path):
        data = [{"operation": "add-user-to-group", "user": "a@b.com", "group": "G"}]
        p = tmp_path / "input.yml"
        p.write_text(yaml.dump(data), encoding="utf-8")
        records = parse_input(p)
        assert len(records) == 1

    def test_yaml_not_list(self, tmp_path):
        p = tmp_path / "input.yaml"
        p.write_text(yaml.dump({"operation": "add-user-to-group"}), encoding="utf-8")
        with pytest.raises(FatalError, match="YAML input must be a list"):
            parse_input(p)

    def test_yaml_parse_error(self, tmp_path):
        p = tmp_path / "input.yaml"
        p.write_text("{{{{invalid", encoding="utf-8")
        with pytest.raises(FatalError, match="YAML parse error"):
            parse_input(p)

    def test_csv_basic(self, tmp_path):
        p = tmp_path / "input.csv"
        p.write_text(
            "operation,user,group,comment\n"
            "add-user-to-group,a@b.com,G,first\n"
            "remove-user-from-group,c@d.com,H,second\n",
            encoding="utf-8",
        )
        records = parse_input(p)
        assert len(records) == 2
        assert records[0].operation == "add-user-to-group"
        assert records[0].comment == "first"
        assert records[0].row == 1
        assert records[1].row == 2

    def test_csv_missing_columns(self, tmp_path):
        p = tmp_path / "input.csv"
        p.write_text("operation,user\nadd-user-to-group,a@b.com\n", encoding="utf-8")
        with pytest.raises(FatalError, match="CSV missing required columns"):
            parse_input(p)

    def test_csv_empty(self, tmp_path):
        p = tmp_path / "input.csv"
        p.write_text("", encoding="utf-8")
        with pytest.raises(FatalError, match="empty or has no header"):
            parse_input(p)

    def test_unsupported_extension(self, tmp_path):
        p = tmp_path / "input.txt"
        p.write_text("data", encoding="utf-8")
        with pytest.raises(FatalError, match="unsupported input format"):
            parse_input(p)

    def test_file_not_found(self, tmp_path):
        with pytest.raises(FatalError, match="file not found"):
            parse_input(tmp_path / "nonexistent.json")
