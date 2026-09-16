"""Validation for box-builder CSG plans (no kernel).

The CAD Viewer's box builder describes a printable box as a small tree of
primitives and boolean operations -- the SAME tree its in-browser preview
evaluates -- and cadgen turns that tree into exact geometry with
``cadgen.box_csg``. This module is the grammar, shared by the viewer server
(which refuses a malformed plan before writing anything) and the interpreter
(which re-checks a plan a person may have edited by hand).

Grammar, millimetres and degrees::

    {"type": "rrect", "w", "d", "h", "r"}   rounded rectangle, centred in XY, z 0..h
    {"type": "cyl", "r", "h"}               cylinder, centred in XY, z 0..h
    {"type": "poly", "points": [[x, y]], "h"} polygon prism, z 0..h
    {"type": "union", "children": [...]}    fuse (one child = a transform group)
    {"type": "difference", "children": [...]} first child minus the rest

Every node may carry ``"rot": [rx, ry, rz]`` and ``"pos": [x, y, z]``, applied
as rotation about global X, then global Y, then global Z, then translation.

The limits describe a desktop-printable box, not what the kernel could do: a
plan is also a request for CPU time, and an internet-facing viewer must not
accept one that keeps a worker busy for an hour.
"""

from __future__ import annotations

import math
from typing import Any

__all__ = [
    "PlanError",
    "BOX_PART_NAMES",
    "normalize_plan_node",
    "normalize_box_plan",
]

BOX_PART_NAMES = ("base", "lid", "inlay")

_PRIMITIVES = frozenset({"rrect", "cyl", "poly"})
_OPERATIONS = frozenset({"union", "difference"})
_MAX_NODES = 1000
_MAX_DEPTH = 16
_MAX_POLY_POINTS = 64
_MAX_TOTAL_POINTS = 2000
_MIN_SIZE = 0.01
_MAX_SIZE = 1000.0
_MAX_COORDINATE = 2000.0
_MAX_ANGLE = 3600.0


class PlanError(ValueError):
    """A plan that does not follow the grammar."""


def _shown(value: Any) -> str:
    text = repr(value)
    return text if len(text) <= 40 else f"{text[:37]}..."


def _number(value: Any, where: str, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PlanError(f"{where}: expected a number, got {_shown(value)}")
    try:
        number = float(value)
    except OverflowError:
        raise PlanError(f"{where}: number out of range") from None
    if not math.isfinite(number) or not low <= number <= high:
        raise PlanError(f"{where}: expected a number in [{low:g}, {high:g}], got {_shown(value)}")
    return number


def _vector(value: Any, where: str, size: int, low: float, high: float) -> list[float]:
    if not isinstance(value, (list, tuple)) or len(value) != size:
        raise PlanError(f"{where}: expected a list of {size} numbers")
    return [_number(item, f"{where}[{index}]", low, high) for index, item in enumerate(value)]


class _Budget:
    __slots__ = ("nodes", "points")

    def __init__(self) -> None:
        self.nodes = _MAX_NODES
        self.points = _MAX_TOTAL_POINTS


def normalize_plan_node(node: Any, where: str = "plan", *, _budget: _Budget | None = None, _depth: int = 0) -> dict:
    """Return a clean copy of ``node`` holding only grammar keys, or raise ``PlanError``."""
    budget = _budget if _budget is not None else _Budget()
    if _depth > _MAX_DEPTH:
        raise PlanError(f"{where}: nested deeper than {_MAX_DEPTH} levels")
    budget.nodes -= 1
    if budget.nodes < 0:
        raise PlanError(f"plan has more than {_MAX_NODES} nodes")
    if not isinstance(node, dict):
        raise PlanError(f"{where}: expected an object")
    kind = node.get("type")
    if not isinstance(kind, str) or kind not in _PRIMITIVES | _OPERATIONS:
        known = ", ".join(sorted(_PRIMITIVES | _OPERATIONS))
        raise PlanError(f"{where}.type: expected one of {known}, got {_shown(kind)}")
    clean: dict[str, Any] = {"type": kind}
    if kind == "rrect":
        clean["w"] = _number(node.get("w"), f"{where}.w", _MIN_SIZE, _MAX_SIZE)
        clean["d"] = _number(node.get("d"), f"{where}.d", _MIN_SIZE, _MAX_SIZE)
        clean["h"] = _number(node.get("h"), f"{where}.h", _MIN_SIZE, _MAX_SIZE)
        clean["r"] = _number(node.get("r", 0), f"{where}.r", 0.0, _MAX_SIZE)
    elif kind == "cyl":
        clean["r"] = _number(node.get("r"), f"{where}.r", _MIN_SIZE, _MAX_SIZE)
        clean["h"] = _number(node.get("h"), f"{where}.h", _MIN_SIZE, _MAX_SIZE)
    elif kind == "poly":
        points = node.get("points")
        if not isinstance(points, (list, tuple)) or not 3 <= len(points) <= _MAX_POLY_POINTS:
            raise PlanError(f"{where}.points: expected 3..{_MAX_POLY_POINTS} points")
        budget.points -= len(points)
        if budget.points < 0:
            raise PlanError(f"plan has more than {_MAX_TOTAL_POINTS} polygon points")
        clean["points"] = [
            _vector(point, f"{where}.points[{index}]", 2, -_MAX_COORDINATE, _MAX_COORDINATE)
            for index, point in enumerate(points)
        ]
        clean["h"] = _number(node.get("h"), f"{where}.h", _MIN_SIZE, _MAX_SIZE)
    else:
        children = node.get("children")
        if not isinstance(children, (list, tuple)) or not children:
            raise PlanError(f"{where}.children: expected a non-empty list")
        if len(children) > _MAX_NODES:
            raise PlanError(f"plan has more than {_MAX_NODES} nodes")
        clean["children"] = [
            normalize_plan_node(child, f"{where}.children[{index}]", _budget=budget, _depth=_depth + 1)
            for index, child in enumerate(children)
        ]
    if "rot" in node:
        clean["rot"] = _vector(node["rot"], f"{where}.rot", 3, -_MAX_ANGLE, _MAX_ANGLE)
    if "pos" in node:
        clean["pos"] = _vector(node["pos"], f"{where}.pos", 3, -_MAX_COORDINATE, _MAX_COORDINATE)
    return clean


def normalize_box_plan(plan: Any) -> dict:
    """``{"base": node, "lid": node | None, "inlay": node | None}`` checked; ``base`` is required."""
    if not isinstance(plan, dict):
        raise PlanError("plan: expected an object with base and lid")
    unknown = sorted(str(key)[:20] for key in set(plan) - set(BOX_PART_NAMES))
    if unknown:
        raise PlanError(f"plan: unknown parts {', '.join(unknown[:5])}")
    if plan.get("base") is None:
        raise PlanError("plan.base: required")
    budget = _Budget()
    clean: dict[str, Any] = {}
    for part in BOX_PART_NAMES:
        node = plan.get(part)
        clean[part] = None if node is None else normalize_plan_node(node, f"plan.{part}", _budget=budget)
    return clean
