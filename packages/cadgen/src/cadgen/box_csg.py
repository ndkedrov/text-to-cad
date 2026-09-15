"""Exact geometry for box-builder plans (loads the kernel).

Evaluates the plan grammar of ``cadgen.box_plan`` with build123d. Imported by
the model scripts the CAD Viewer's box builder writes -- never by the viewer
server, which only validates plans and submits those scripts as jobs.
"""

from __future__ import annotations

from typing import Any

from cadgen.box_plan import normalize_plan_node

__all__ = ["shape_from_plan"]

_EPS = 1e-6


def shape_from_plan(node: Any):
    """Build the solid a plan node describes."""
    from cadgen import build123d as bd

    return _build(bd, normalize_plan_node(node))


def _build(bd, node: dict):
    kind = node["type"]
    if kind == "rrect":
        shape = _rounded_prism(bd, node["w"], node["d"], node["h"], node["r"])
    elif kind == "cyl":
        shape = bd.Cylinder(node["r"], node["h"], align=(bd.Align.CENTER, bd.Align.CENTER, bd.Align.MIN))
    elif kind == "poly":
        outline = bd.Polygon(*[tuple(point) for point in node["points"]], align=None)
        shape = bd.extrude(outline, amount=node["h"])
    else:
        children = [_build(bd, child) for child in node["children"]]
        shape = children[0]
        for other in children[1:]:
            shape = shape + other if kind == "union" else shape - other
    return _placed(bd, shape, node)


def _rounded_prism(bd, width: float, depth: float, height: float, radius: float):
    half = min(width, depth) / 2
    if radius <= _EPS:
        outline = bd.Rectangle(width, depth)
    elif radius >= half - _EPS:
        if abs(width - depth) <= _EPS:
            outline = bd.Circle(half)
        else:
            outline = bd.SlotOverall(max(width, depth), min(width, depth), rotation=0 if width >= depth else 90)
    else:
        outline = bd.RectangleRounded(width, depth, radius)
    return bd.extrude(outline, amount=height)


def _placed(bd, shape, node: dict):
    rx, ry, rz = node.get("rot", (0.0, 0.0, 0.0))
    for axis, angle in ((bd.Axis.X, rx), (bd.Axis.Y, ry), (bd.Axis.Z, rz)):
        if abs(angle) > _EPS:
            shape = shape.rotate(axis, angle)
    x, y, z = node.get("pos", (0.0, 0.0, 0.0))
    if abs(x) > _EPS or abs(y) > _EPS or abs(z) > _EPS:
        shape = shape.translate(bd.Vector(x, y, z))
    return shape
