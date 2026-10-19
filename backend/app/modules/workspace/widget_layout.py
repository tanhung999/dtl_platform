"""Stable widget IDs and reconciliation of saved layouts with the current catalog."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = 1
DEFAULT_COLUMNS = {
    "launcher": ("apps", "bookmarks"),
    "tasks": ("tasks",),
    "notes": ("calendar", "notes"),
}
WIDGET_IDS = frozenset(item for items in DEFAULT_COLUMNS.values() for item in items)


def normalize_columns(saved):
    result = {column: [] for column in DEFAULT_COLUMNS}
    seen = set()
    if isinstance(saved, dict):
        for column in DEFAULT_COLUMNS:
            items = saved.get(column, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if isinstance(item, str) and item in WIDGET_IDS and item not in seen:
                    result[column].append(item)
                    seen.add(item)
    # Missing widgets, including those assigned to a removed/invalid column,
    # go to the end of their own default column. Never duplicate an ID.
    for column, items in DEFAULT_COLUMNS.items():
        result[column].extend(item for item in items if item not in seen)
    return result


class WidgetLayoutWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1] = 1
    expected_version: int = Field(ge=0)
    columns: dict[str, list[str]] = Field(max_length=16)

    def bounded(self):
        return all(len(key) <= 64 and len(items) <= 100 and all(len(item) <= 80 for item in items) for key, items in self.columns.items())


class WidgetLayoutResponse(BaseModel):
    columns: dict[str, list[str]]
    schema_version: int
    version: int
