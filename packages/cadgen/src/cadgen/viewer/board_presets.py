"""Circuit-board templates for the box builder, and an admin's edits to them.

The shipped set is ``board_presets.json`` beside this module: the connector types
the builder knows (``portTypes``, the body size each starts with) and common
boards. An admin can replace the board list from ``/admin``; the edited list lives
in ``.box-presets/boards.json`` under the served root, a hidden folder no route
serves, and a reset deletes it. Nothing here loads the kernel.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

__all__ = [
    "BOARD_PRESETS_FILENAME",
    "MAX_PRESET_REQUEST_BYTES",
    "BoardPresets",
    "PresetError",
    "normalize_board_presets",
    "shipped_presets",
]

PRESETS_DIRNAME = ".box-presets"
BOARD_PRESETS_FILENAME = "board_presets.json"
MAX_PRESET_REQUEST_BYTES = 512 * 1024
MAX_PRESETS = 200
MAX_HOLES = 8
MAX_PORTS = 8
BOARD_EDGES = ("front", "back", "left", "right")
PORT_SHAPES = ("rect", "circle")
_PRESET_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,39}")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class PresetError(ValueError):
    """A board list that cannot be saved; the message names the field."""


def shipped_presets() -> dict:
    return json.loads(Path(__file__).with_name(BOARD_PRESETS_FILENAME).read_text(encoding="utf-8", errors="replace"))


def _number(source: dict, key: str, where: str, low: float, high: float, default: float | None = None) -> float | int:
    value = source.get(key, default)
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise PresetError(f"{where}.{key}: expected a number from {low:g} to {high:g}")
    number = round(float(value), 4)
    return int(number) if number.is_integer() else number


def _object(value: Any, where: str) -> dict:
    if not isinstance(value, dict):
        raise PresetError(f"{where}: expected an object")
    return value


def _choice(source: dict, key: str, where: str, options) -> str:
    value = source.get(key)
    if value not in options:
        raise PresetError(f"{where}.{key}: expected one of {', '.join(options)}")
    return value


def _normalize_port(raw: Any, where: str, width: float, length: float, port_types) -> dict:
    source = _object(raw, where)
    port_type = _choice(source, "type", where, tuple(port_types))
    edge = _choice(source, "edge", where, BOARD_EDGES)
    shape = _choice(source, "shape", where, PORT_SHAPES)
    edge_length = width if edge in ("front", "back") else length
    port_width = _number(source, "width", where, 0.5, 100)
    port_height = port_width if shape == "circle" else _number(source, "height", where, 0.5, 100)
    return {
        "type": port_type,
        "edge": edge,
        "offset": _number(source, "offset", where, 0, edge_length),
        "elevation": _number(source, "elevation", where, -20, 100, 0),
        "shape": shape,
        "width": port_width,
        "height": port_height,
        "radius": 0 if shape == "circle" else _number(source, "radius", where, 0, min(port_width, port_height) / 2, 0),
        "overhang": _number(source, "overhang", where, 0, 30, 0),
        "margin": _number(source, "margin", where, 0, 5, 0.5),
    }


def normalize_board_presets(boards: Any, port_types, categories) -> list[dict]:
    """A clean copy of an admin's board list holding only known keys, or ``PresetError``."""
    if not isinstance(boards, list):
        raise PresetError("boards: expected a list")
    if len(boards) > MAX_PRESETS:
        raise PresetError(f"boards: at most {MAX_PRESETS} presets")
    seen: set[str] = set()
    clean = []
    for index, raw in enumerate(boards):
        where = f"boards[{index}]"
        source = _object(raw, where)
        preset_id = source.get("id")
        if not isinstance(preset_id, str) or not _PRESET_ID.fullmatch(preset_id) or preset_id == "custom":
            raise PresetError(f"{where}.id: 1 to 40 Latin letters, digits or '-', not 'custom'")
        if preset_id in seen:
            raise PresetError(f"{where}.id: '{preset_id}' is used twice")
        seen.add(preset_id)
        name = source.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 60 or _CONTROL.search(name):
            raise PresetError(f"{where}.name: 1 to 60 characters")
        category = _choice(source, "category", where, tuple(categories))
        width = _number(source, "width", where, 5, 400)
        length = _number(source, "length", where, 5, 400)
        pad = _number(source, "padDiameter", where, 2, 30)
        holes = source.get("holes", [])
        if not isinstance(holes, list) or len(holes) > MAX_HOLES:
            raise PresetError(f"{where}.holes: a list of at most {MAX_HOLES}")
        ports = source.get("ports", [])
        if not isinstance(ports, list) or len(ports) > MAX_PORTS:
            raise PresetError(f"{where}.ports: a list of at most {MAX_PORTS}")
        clean.append({
            "id": preset_id,
            "name": name.strip(),
            "category": category,
            "width": width,
            "length": length,
            "thickness": _number(source, "thickness", where, 0.4, 5, 1.6),
            "clearance": _number(source, "clearance", where, 0, 200),
            "componentHeight": _number(source, "componentHeight", where, 0, 200),
            "padDiameter": pad,
            "boreDiameter": _number(source, "boreDiameter", where, 0, pad - 0.8),
            "holes": [
                {
                    "x": _number(_object(hole, f"{where}.holes[{hole_index}]"), "x", f"{where}.holes[{hole_index}]", 0, width),
                    "y": _number(hole, "y", f"{where}.holes[{hole_index}]", 0, length),
                    "diameter": _number(hole, "diameter", f"{where}.holes[{hole_index}]", 0.5, 12),
                }
                for hole_index, hole in enumerate(holes)
            ],
            "ports": [
                _normalize_port(port, f"{where}.ports[{port_index}]", width, length, port_types)
                for port_index, port in enumerate(ports)
            ],
        })
    return clean


def _atomic_write(path: Path, text: str) -> None:
    handle, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        os.replace(temporary, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise


class BoardPresets:
    """The board templates the builder offers: the admin's list when there is one, else the shipped one."""

    def __init__(self, root: str) -> None:
        self.path = Path(root).resolve() / PRESETS_DIRNAME / "boards.json"
        self._lock = threading.Lock()
        self._shipped = shipped_presets()

    @property
    def port_types(self) -> dict:
        return self._shipped["portTypes"]

    @property
    def categories(self) -> list[str]:
        """Board kinds in display order ("sbc", "wireless", "power", ...)."""
        return self._shipped["categories"]

    def defaults(self) -> list[dict]:
        return normalize_board_presets(self._shipped["boards"], self.port_types, self.categories)

    def load(self) -> dict:
        """``{"boards": [...], "categories": [...], "edited": bool}``. An unreadable edited list reads as none."""
        with self._lock:
            try:
                stored = json.loads(self.path.read_text(encoding="utf-8", errors="replace"))
                boards = normalize_board_presets(
                    stored.get("boards") if isinstance(stored, dict) else None, self.port_types, self.categories
                )
                return {"boards": boards, "categories": self.categories, "edited": True}
            except (OSError, json.JSONDecodeError, PresetError):
                return {"boards": self.defaults(), "categories": self.categories, "edited": False}

    def save(self, body: bytes) -> dict:
        """``{"boards": [...]}`` replaces the list; ``{"reset": true}`` goes back to the shipped one."""
        if len(body) > MAX_PRESET_REQUEST_BYTES:
            raise PresetError("the preset list is too large")
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise PresetError("expected JSON") from None
        if not isinstance(payload, dict):
            raise PresetError("expected {boards: [...]} or {reset: true}")
        with self._lock:
            if payload.get("reset") is True:
                with contextlib.suppress(FileNotFoundError):
                    self.path.unlink()
            else:
                boards = normalize_board_presets(payload.get("boards"), self.port_types, self.categories)
                self.path.parent.mkdir(parents=True, exist_ok=True)
                document = {"format": "cadgen-board-presets", "version": 1, "boards": boards}
                _atomic_write(self.path, json.dumps(document, ensure_ascii=False, indent=1) + "\n")
        return self.load()
