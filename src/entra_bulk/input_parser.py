"""Input file parsing (JSON, YAML, CSV)."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import yaml

from entra_bulk.exceptions import FatalError
from entra_bulk.models import OperationRecord


def parse_input(path: str | Path) -> list[OperationRecord]:
    """Parse JSON, YAML, or CSV input file into OperationRecords."""
    path = Path(path)

    if not path.exists():
        raise FatalError(f"file not found: {path}")

    suffix = path.suffix.lower()

    if suffix == ".json":
        return _parse_json(path)
    elif suffix in (".yaml", ".yml"):
        return _parse_yaml(path)
    elif suffix == ".csv":
        return _parse_csv(path)
    else:
        raise FatalError(
            f"unsupported input format: {suffix!r}. "
            "Supported: .json, .yaml, .yml, .csv"
        )


def _parse_json(path: Path) -> list[OperationRecord]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise FatalError(f"JSON parse error in {path}: {e}")

    if not isinstance(raw, list):
        raise FatalError(f"JSON input must be an array, got {type(raw).__name__}")

    return [
        OperationRecord(
            operation=item.get("operation", ""),
            user=item.get("user", ""),
            group=item.get("group", ""),
            comment=item.get("comment", ""),
            row=i + 1,
        )
        for i, item in enumerate(raw)
    ]


def _parse_yaml(path: Path) -> list[OperationRecord]:
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        raise FatalError(f"YAML parse error in {path}: {e}")

    if not isinstance(raw, list):
        raise FatalError(f"YAML input must be a list, got {type(raw).__name__}")

    return [
        OperationRecord(
            operation=item.get("operation", ""),
            user=item.get("user", ""),
            group=item.get("group", ""),
            comment=item.get("comment", ""),
            row=i + 1,
        )
        for i, item in enumerate(raw)
    ]


def _parse_csv(path: Path) -> list[OperationRecord]:
    try:
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames is None:
                raise FatalError("CSV file is empty or has no header row")

            required = {"operation", "user", "group"}
            actual = set(reader.fieldnames)
            missing = required - actual
            if missing:
                raise FatalError(
                    f"CSV missing required columns: {', '.join(sorted(missing))}"
                )

            records = []
            for i, row in enumerate(reader):
                records.append(
                    OperationRecord(
                        operation=row.get("operation", ""),
                        user=row.get("user", ""),
                        group=row.get("group", ""),
                        comment=row.get("comment", ""),
                        row=i + 1,
                    )
                )
            return records

    except csv.Error as e:
        raise FatalError(f"CSV parse error in {path}: {e}")
