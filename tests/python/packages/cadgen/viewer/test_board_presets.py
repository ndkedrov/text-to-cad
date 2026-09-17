"""Board templates: the shipped set, an admin's edits to it, and what is refused."""

from __future__ import annotations

import json
import tempfile
import unittest

from tests.python.support.paths import repo_path

from cadgen.viewer.board_presets import BoardPresets, PresetError, normalize_board_presets, shipped_presets


class ShippedPresets(unittest.TestCase):
    def test_the_shipped_boards_are_valid_unique_and_kept_whole(self):
        shipped = shipped_presets()
        boards = normalize_board_presets(shipped["boards"], shipped["portTypes"], shipped["categories"])
        self.assertGreaterEqual(len(boards), 10)
        self.assertEqual(len({board["id"] for board in boards}), len(boards))
        self.assertEqual(boards, shipped["boards"], "normalizing changes nothing in the shipped set")

    def test_the_box_builder_package_ships_the_same_list(self):
        # The panel's package carries the list for hosts without this server; the
        # wheel ships alone, so it keeps its own copy, and the two must not drift.
        package_copy = repo_path("packages/box-builder/src/presets/boards.json")
        server_copy = repo_path("packages/cadgen/src/cadgen/viewer/board_presets.json")
        with open(package_copy, encoding="utf-8") as package_file, open(server_copy, encoding="utf-8") as server_file:
            self.assertEqual(json.load(package_file), json.load(server_file), "edit both copies of the board list")


class EditedPresets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.presets = BoardPresets(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def board(self, **changes):
        # The first shipped board has ports and holes.
        return {**shipped_presets()["boards"][0], **changes}

    def save(self, boards):
        return self.presets.save(json.dumps({"boards": boards}).encode("utf-8"))

    def test_an_edited_list_replaces_the_shipped_one_until_reset(self):
        self.assertFalse(self.presets.load()["edited"])
        saved = self.save([self.board(id="mine", name="  Mine  ")])
        self.assertEqual([board["id"] for board in saved["boards"]], ["mine"])
        self.assertEqual((saved["boards"][0]["name"], saved["edited"]), ("Mine", True))
        self.assertTrue(self.presets.path.is_file())
        self.assertTrue(self.presets.path.parent.name.startswith("."), "kept in a hidden folder no route serves")
        restored = self.presets.save(b'{"reset": true}')
        self.assertFalse(restored["edited"])
        self.assertFalse(self.presets.path.exists())
        self.assertEqual(restored["boards"], self.presets.defaults())

    def test_ribs_and_a_clamp_are_kept_only_when_set(self):
        rails = [{"offset": 8, "length": 22, "thickness": 4}]
        ribbed = self.save([self.board(id="ribbed", rails=rails, clamp=True, clampHeight=14)])["boards"][0]
        self.assertEqual((ribbed["rails"], ribbed["clamp"], ribbed["clampHeight"]), (rails, True, 14))
        plain = self.save([self.board(id="plain")])["boards"][0]
        self.assertFalse({"rails", "clamp", "clampHeight"} & set(plain))

    def test_an_unreadable_edited_list_reads_as_the_shipped_one(self):
        self.presets.path.parent.mkdir(parents=True)
        self.presets.path.write_text("{broken", encoding="utf-8")
        loaded = self.presets.load()
        self.assertFalse(loaded["edited"])
        self.assertEqual(loaded["boards"], self.presets.defaults())

    def test_bad_lists_are_refused_with_the_field_named_and_nothing_written(self):
        port = self.board()["ports"][0]
        cases = {
            "id": [self.board(id="Bad Id")],
            "custom": [self.board(id="custom")],
            "twice": [self.board(), self.board()],
            "name": [self.board(name="")],
            "category": [self.board(category="toaster")],
            "width": [self.board(width=1000)],
            "boreDiameter": [self.board(boreDiameter=50)],
            "holes": [self.board(holes=[{"x": 1, "y": 1, "diameter": 3}] * 9)],
            "type": [self.board(ports=[{**port, "type": "lightning"}])],
            "offset": [self.board(ports=[{**port, "offset": 500}])],
            ".x": [self.board(holes=[{"x": True, "y": 1, "diameter": 3}])],
            "rails": [self.board(rails=[{"offset": 1, "length": 5, "thickness": 2}] * 5)],
            ".thickness": [self.board(rails=[{"offset": 1, "length": 5, "thickness": 0}])],
            ".clamp": [self.board(clamp="yes")],
            "clampHeight": [self.board(clampHeight=0)],
        }
        for fragment, boards in cases.items():
            with self.subTest(fragment=fragment):
                with self.assertRaises(PresetError) as caught:
                    self.save(boards)
                self.assertIn(fragment, str(caught.exception))
        for body in (b"not json", b"[]", json.dumps({"boards": "nope"}).encode("utf-8")):
            with self.subTest(body=body[:10]):
                with self.assertRaises(PresetError):
                    self.presets.save(body)
        self.assertFalse(self.presets.path.exists(), "nothing refused is written")


if __name__ == "__main__":
    unittest.main()
