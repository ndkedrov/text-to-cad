"""Material bodies and clipped SVG faces must survive the exact CAD kernel."""
import unittest

from cadgen.box_csg import colored_shapes_from_plan, shape_from_plan
from cadgen.color import linear_to_srgb


class ColoredBoxGeometry(unittest.TestCase):
    def test_colours_and_parent_print_transform_survive(self):
        plan = {"type": "union", "rot": [180, 0, 0], "pos": [0, 0, 10], "children": [
            {"type": "rrect", "w": 2, "d": 3, "h": 1, "r": 0, "color": "#ff00ff", "pos": [0, 0, 8]},
            {"type": "rrect", "w": 2, "d": 3, "h": 1, "r": 0, "color": "#00ffff", "pos": [3, 0, 8]},
        ]}
        parts = colored_shapes_from_plan(plan)
        self.assertEqual(len(parts), 2)
        for part in parts:
            self.assertTrue(part.is_valid)
            self.assertAlmostEqual(part.volume, 6)
            self.assertAlmostEqual(part.bounding_box().min.Z, 1)
            self.assertAlmostEqual(part.bounding_box().max.Z, 2)
        self.assertNotEqual(tuple(parts[0].color), tuple(parts[1].color))

    def test_svg_srgb_hex_round_trips_through_export_linear_color(self):
        for color in ("#001a4e", "#0140ab", "#fdd202", "#f6f8fc", "#07e7fc", "#089af8", "#03f6b2", "#041120"):
            part = colored_shapes_from_plan({"type": "rrect", "w": 2, "d": 3, "h": 1, "r": 0, "color": color})[0]
            encoded = "#" + "".join(f"{round(linear_to_srgb(c) * 255):02x}" for c in tuple(part.color)[:3])
            self.assertEqual(encoded, color)

    def test_touching_svg_ring_becomes_valid_upward_prisms(self):
        # Two squares touching at a vertex, as SVG boolean clipping can produce.
        points = [[0, 0], [2, 0], [2, 2], [4, 2], [4, 4], [2, 4], [2, 2], [0, 2]]
        solid = shape_from_plan({"type": "poly", "points": points, "h": 0.6})
        self.assertTrue(solid.is_valid)
        self.assertAlmostEqual(solid.volume, 4.8)
        self.assertAlmostEqual(solid.bounding_box().min.Z, 0)
        self.assertAlmostEqual(solid.bounding_box().max.Z, 0.6)


if __name__ == "__main__":
    unittest.main()
