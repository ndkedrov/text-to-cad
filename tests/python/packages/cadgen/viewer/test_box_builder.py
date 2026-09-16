"""The CAD Viewer's box builder: names, files written, accounts, limits, builds."""

from __future__ import annotations

import ast
import json
import tempfile
import threading
import time
import unittest
from pathlib import Path

from cadgen import box_plan
from cadgen.box_plan import PlanError, normalize_box_plan, normalize_plan_node
from cadgen.viewer.boxes import (
    MAX_SPEC_BYTES,
    BoxBuilder,
    BoxBusy,
    BoxError,
    BoxLimits,
    BoxNotFound,
    BoxQuotaExceeded,
    BuildResult,
    check_box_name,
    owner_key,
    run_model_script,
)

BASE = {"type": "difference", "children": [
    {"type": "rrect", "w": 40, "d": 30, "h": 20, "r": 3},
    {"type": "rrect", "w": 36, "d": 26, "h": 20, "r": 1, "pos": [0, 0, 2]},
]}
LID = {"type": "rrect", "w": 40, "d": 30, "h": 2, "r": 3}
ALICE = "alice@example.com"


class RecordingRunner:
    def __init__(self, code: int = 0, output: str = "", *, gate: threading.Event | None = None) -> None:
        self.code = code
        self.output = output
        self.gate = gate
        self.scripts: list[Path] = []
        self.calls: list[dict] = []
        self.lock = threading.Lock()

    def __call__(self, script: Path, **options) -> BuildResult:
        with self.lock:
            self.scripts.append(Path(script))
            self.calls.append(options)
        if self.gate is not None:
            self.gate.wait(10)
        return BuildResult(self.code, self.output)


def plan_literal(script: Path) -> dict:
    tree = ast.parse(script.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "PLAN":
            return ast.literal_eval(node.value)
    raise AssertionError(f"{script.name} has no PLAN")


def body(spec=None, plan=None) -> bytes:
    return json.dumps({"spec": spec or {"base": {"width": 40}}, "plan": plan or {"base": BASE, "lid": LID}}).encode("utf-8")


class BoxNames(unittest.TestCase):
    def test_accepts_plain_names(self):
        for name in ("box", "pi-zero_case", "2024box"):
            with self.subTest(name=name):
                self.assertEqual(check_box_name(name), name)

    def test_refuses_paths_blanks_device_names_and_untrimmed_input(self):
        for name in ("", "../escape", "a/b", "a b", ".hidden", "con", "LPT1", "x" * 65, "коробка", "a\n", " a ", None, 5):
            with self.subTest(name=name):
                with self.assertRaises(BoxError):
                    check_box_name(name)

    def test_owner_folders_are_hashes_not_addresses(self):
        key = owner_key("Alice@Example.com")
        self.assertEqual(key, owner_key(ALICE))
        self.assertTrue(key.startswith("u-"))
        self.assertNotIn("alice", key)
        self.assertIsNone(owner_key(None))
        with self.assertRaises(BoxError):
            owner_key("   ")


class PlanGrammar(unittest.TestCase):
    def test_keeps_only_grammar_keys(self):
        clean = normalize_plan_node({"type": "cyl", "r": 2, "h": 5, "pos": [1, 2, 3], "evil": "__import__"})
        self.assertEqual(clean, {"type": "cyl", "r": 2.0, "h": 5.0, "pos": [1.0, 2.0, 3.0]})

    def test_refuses_unknown_types_bad_numbers_and_out_of_envelope_values(self):
        bad = [
            {"type": "exec", "code": "x"},
            {"type": ["cyl"], "r": 1, "h": 1},
            {"type": "cyl", "r": -1, "h": 5},
            {"type": "cyl", "r": float("nan"), "h": 5},
            {"type": "cyl", "r": True, "h": 5},
            {"type": "cyl", "r": 5e-324, "h": 1},
            {"type": "cyl", "r": 10**400, "h": 1},
            {"type": "rrect", "w": 1500, "d": 1, "h": 1},
            {"type": "union", "children": []},
            {"type": "poly", "points": [[0, 0], [1, 1]], "h": 1},
            {"type": "rrect", "w": 1, "d": 1, "h": 1, "rot": [0, 0]},
            {"type": "rrect", "w": 1, "d": 1, "h": 1, "pos": [3000, 0, 0]},
        ]
        for node in bad:
            with self.subTest(node=str(node)[:60]):
                with self.assertRaises(PlanError):
                    normalize_plan_node(node)

    def test_refuses_plans_that_are_too_big_to_build_quickly(self):
        many = {"type": "union", "children": [{"type": "cyl", "r": 1, "h": 1}] * 1001}
        with self.assertRaises(PlanError):
            normalize_plan_node(many)
        # One polygon past what a polygon may hold, and then more points than a
        # plan may; counted from the limits themselves, which move as engravings
        # ask for more.
        point = [0, 0]
        with self.assertRaises(PlanError):
            normalize_plan_node({"type": "poly", "points": [point] * (box_plan._MAX_POLY_POINTS + 1), "h": 1})
        full = {"type": "poly", "points": [point] * box_plan._MAX_POLY_POINTS, "h": 1}
        over = box_plan._MAX_TOTAL_POINTS // box_plan._MAX_POLY_POINTS + 1
        with self.assertRaises(PlanError):
            normalize_plan_node({"type": "union", "children": [full] * over})

    def test_a_refusal_does_not_echo_a_huge_value(self):
        with self.assertRaises(PlanError) as caught:
            normalize_plan_node({"type": "x" * 100000})
        self.assertLess(len(str(caught.exception)), 200)

    def test_a_box_plan_needs_a_base_and_no_other_parts(self):
        with self.assertRaises(PlanError):
            normalize_box_plan({"lid": LID})
        with self.assertRaises(PlanError):
            normalize_box_plan({"base": BASE, "hinge": LID})
        self.assertIsNone(normalize_box_plan({"base": BASE})["lid"])


class BuilderTestCase(unittest.TestCase):
    limits = BoxLimits()
    expose_paths = True

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.runner = RecordingRunner()
        self.builder = self.make_builder(self.limits)

    def tearDown(self):
        self.temp.cleanup()

    def make_builder(self, limits, runner=None):
        return BoxBuilder(str(self.root), limits=limits, runner=runner or self.runner, expose_paths=self.expose_paths)

    def save(self, name="case", spec=None, plan=None, owner=None, builder=None):
        builder = builder or self.builder
        status = builder.save(name, body(spec, plan), owner=owner)
        self.assertTrue(builder.wait(name, owner=owner, timeout=5))
        return status


class SavingABox(BuilderTestCase):
    def test_writes_the_spec_and_one_script_per_part_and_builds_them(self):
        self.save()
        folder = self.root / "boxes" / "case"
        document = json.loads((folder / "case.box.json").read_text(encoding="utf-8"))
        self.assertEqual(document["spec"], {"base": {"width": 40}})
        self.assertEqual(plan_literal(folder / "case_base.py"), normalize_box_plan({"base": BASE})["base"])
        self.assertEqual(plan_literal(folder / "case_lid.py"), normalize_box_plan({"base": LID})["base"])
        self.assertEqual(sorted(path.name for path in self.runner.scripts), ["case_base.py", "case_lid.py"])
        status = self.builder.status("case")
        self.assertEqual(status["build"]["state"], "done")
        self.assertEqual(status["build"]["parts"]["lid"], {"state": "done", "error": ""})
        self.assertNotIn("quota", status)
        self.assertEqual([path.name for path in folder.iterdir() if path.name.endswith(".tmp")], [])
        self.assertFalse(self.runner.calls[0]["ephemeral_cache"])

    def test_an_inlay_is_written_together_with_the_lid_it_fills(self):
        self.save(name="inlaid", plan={"base": BASE, "lid": LID, "inlay": BASE})
        source = (self.root / "boxes" / "inlaid" / "inlaid_inlay.py").read_text(encoding="utf-8")
        # One model of two coloured bodies, so a slicer opens both in their places.
        self.assertIn("HOLDER_PLAN", source)
        self.assertIn("bd.Compound(children=[holder, piece])", source)
        self.assertIn('piece.label = "inlay"', source)
        self.assertIn('holder.label = "lid"', source)
        compile(source, "inlaid_inlay.py", "exec")
        # The lid on its own says nothing of the inlay.
        lid_source = (self.root / "boxes" / "inlaid" / "inlaid_lid.py").read_text(encoding="utf-8")
        self.assertNotIn("HOLDER_PLAN", lid_source)

    def test_the_generated_script_compiles_and_names_a_valid_model(self):
        self.save(name="2-part")
        source = (self.root / "boxes" / "2-part" / "2-part_base.py").read_text(encoding="utf-8")
        functions = [node.name for node in ast.parse(source).body if isinstance(node, ast.FunctionDef)]
        self.assertEqual(functions, ["box_2_part_base"])

    def test_a_malformed_plan_writes_nothing_and_holds_no_place(self):
        with self.assertRaises(BoxError) as caught:
            self.builder.save("case", json.dumps({"spec": {}, "plan": {"base": {"type": "exec"}}}).encode("utf-8"))
        self.assertEqual(caught.exception.code, "bad_plan")
        self.assertFalse((self.root / "boxes").exists())
        self.assertEqual(self.runner.scripts, [])
        self.assertIsNone(self.builder.status("case")["build"])

    def test_oversized_requests_and_specs_are_refused(self):
        with self.assertRaises(BoxError) as caught:
            self.builder.save("case", b" " * (1024 * 1024 + 1))
        self.assertEqual(caught.exception.status, 413)
        with self.assertRaises(BoxError) as caught:
            self.builder.save("case", body(spec={"junk": "x" * (MAX_SPEC_BYTES + 1000)}))
        self.assertEqual(caught.exception.status, 413)

    def test_switching_the_lid_off_removes_only_generated_lid_files(self):
        self.save()
        folder = self.root / "boxes" / "case"
        for fmt in ("step", "stl", "3mf"):
            (folder / f"case_lid.{fmt}").write_text("mesh", encoding="utf-8")
        (folder / "notes.txt").write_text("mine", encoding="utf-8")
        self.save(plan={"base": BASE, "lid": None})
        self.assertEqual(sorted(path.name for path in folder.iterdir()), ["case.box.json", "case_base.py", "notes.txt"])

    def test_without_our_script_lid_outputs_are_left_alone(self):
        folder = self.root / "boxes" / "case"
        folder.mkdir(parents=True)
        (folder / "case_lid.stl").write_text("hand made", encoding="utf-8")
        self.save(plan={"base": BASE, "lid": None})
        self.assertTrue((folder / "case_lid.stl").is_file())

    def test_a_failed_job_reports_its_message_without_server_paths(self):
        self.runner.code = 1
        self.runner.output = "[cadgen] FAILED: ValueError: radius too large in /opt/3dmaker/data/boxes/case/case_base.py\n"
        self.save()
        build = self.builder.status("case")["build"]
        self.assertEqual(build["state"], "error")
        error = build["parts"]["base"]["error"]
        self.assertIn("radius too large", error)
        self.assertNotIn("/opt/", error)

    def test_list_and_load_round_trip(self):
        self.save(name="alpha", spec={"base": {"width": 50}})
        self.assertEqual([box["name"] for box in self.builder.list_boxes()["boxes"]], ["alpha"])
        self.assertEqual(self.builder.load("alpha")["spec"], {"base": {"width": 50}})
        with self.assertRaises(BoxNotFound):
            self.builder.load("missing")

    def test_outputs_are_listed_root_relative_and_downloadable(self):
        self.save()
        (self.root / "boxes" / "case" / "case_base.stl").write_text("mesh", encoding="utf-8")
        outputs = self.builder.status("case")["outputs"]
        self.assertEqual([(item["part"], item["format"], item["file"]) for item in outputs], [
            ("base", "stl", "boxes/case/case_base.stl"),
        ])
        self.assertIn("path", outputs[0])
        self.assertEqual(self.builder.output_file("case", "base", "stl").name, "case_base.stl")
        with self.assertRaises(BoxNotFound):
            self.builder.output_file("case", "lid", "stl")
        for part, fmt in (("base", "py"), ("../x", "stl"), ("base", "json")):
            with self.subTest(part=part, fmt=fmt):
                with self.assertRaises(BoxError):
                    self.builder.output_file("case", part, fmt)


class Accounts(BuilderTestCase):
    limits = BoxLimits(daily_new_boxes=1, daily_builds=3)
    expose_paths = False

    def test_each_account_sees_only_its_own_boxes(self):
        self.save(name="case", owner=ALICE)
        self.assertEqual([box["name"] for box in self.builder.list_boxes(ALICE)["boxes"]], ["case"])
        self.assertEqual(self.builder.list_boxes("bob@example.com")["boxes"], [])
        with self.assertRaises(BoxNotFound):
            self.builder.load("case", "bob@example.com")
        with self.assertRaises(BoxNotFound):
            self.builder.output_file("case", "base", "stl", "bob@example.com")
        self.assertEqual(self.builder.list_boxes(None)["boxes"], [])
        alice_folder = self.root / "boxes" / owner_key(ALICE) / "case"
        self.assertTrue((alice_folder / "case.box.json").is_file())

    def test_hosted_outputs_carry_no_server_paths(self):
        self.save(owner=ALICE)
        folder = self.root / "boxes" / owner_key(ALICE) / "case"
        (folder / "case_base.stl").write_text("mesh", encoding="utf-8")
        outputs = self.builder.status("case", ALICE)["outputs"]
        self.assertNotIn("path", outputs[0])

    def test_one_new_box_a_day_and_a_bounded_number_of_builds(self):
        first = self.save(name="first", owner=ALICE)
        self.assertEqual(first["quota"]["newBoxes"], 1)
        with self.assertRaises(BoxQuotaExceeded) as caught:
            self.builder.save("second", body(), owner=ALICE)
        self.assertEqual(caught.exception.code, "quota_new")
        self.assertFalse((self.root / "boxes" / owner_key(ALICE) / "second").exists())
        self.save(name="first", owner=ALICE)
        self.save(name="first", owner=ALICE)
        with self.assertRaises(BoxQuotaExceeded) as caught:
            self.builder.save("first", body(), owner=ALICE)
        self.assertEqual(caught.exception.code, "quota_builds")
        # Another account and the local viewer are unaffected.
        self.save(name="first", owner="bob@example.com")
        self.save(name="first")

    def test_parallel_saves_of_two_new_boxes_cannot_both_pass_the_daily_limit(self):
        gate = threading.Event()
        gate.set()
        results = []
        barrier = threading.Barrier(2)

        def attempt(name):
            barrier.wait()
            try:
                self.builder.save(name, body(), owner=ALICE)
                results.append("ok")
            except (BoxQuotaExceeded, BoxBusy) as error:
                results.append(error.code)

        threads = [threading.Thread(target=attempt, args=(name,)) for name in ("one", "two")]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(10)
        self.assertEqual(results.count("ok"), 1, results)
        for name in ("one", "two"):
            self.assertTrue(self.builder.wait(name, owner=ALICE, timeout=5))

    def test_the_quota_resets_on_a_new_day(self):
        self.save(name="first", owner=ALICE)
        quota_file = self.root / ".box-quota" / f"{owner_key(ALICE)}.json"
        stored = json.loads(quota_file.read_text(encoding="utf-8"))
        stored["day"] = "2000-01-01"
        quota_file.write_text(json.dumps(stored), encoding="utf-8")
        self.save(name="second", owner=ALICE)

    def test_unreadable_counters_refuse_instead_of_resetting(self):
        self.save(name="first", owner=ALICE)
        quota_file = self.root / ".box-quota" / f"{owner_key(ALICE)}.json"
        quota_file.write_text("{broken", encoding="utf-8")
        with self.assertRaises(BoxBusy) as caught:
            self.builder.save("first", body(), owner=ALICE)
        self.assertEqual(caught.exception.code, "quota_unavailable")


class HostedLimits(BuilderTestCase):
    expose_paths = False

    def test_one_active_build_per_account(self):
        gate = threading.Event()
        runner = RecordingRunner(gate=gate)
        builder = self.make_builder(BoxLimits(), runner=runner)
        builder.save("one", body(plan={"base": BASE, "lid": None}), owner=ALICE)
        (self.root / "boxes" / owner_key(ALICE) / "two").mkdir(parents=True)
        with self.assertRaises(BoxBusy) as caught:
            builder.save("two", body(plan={"base": BASE, "lid": None}), owner=ALICE)
        self.assertEqual(caught.exception.code, "busy_account")
        builder.save("one", body(plan={"base": BASE, "lid": None}), owner="bob@example.com")
        gate.set()
        self.assertTrue(builder.wait("one", owner=ALICE, timeout=5))
        self.assertTrue(builder.wait("one", owner="bob@example.com", timeout=5))
        builder.save("two", body(plan={"base": BASE, "lid": None}), owner=ALICE)
        self.assertTrue(builder.wait("two", owner=ALICE, timeout=5))

    def test_a_daily_cap_on_new_boxes_across_all_accounts(self):
        builder = self.make_builder(BoxLimits(global_daily_new_boxes=2))
        self.save(name="a", owner="one@example.com", builder=builder)
        self.save(name="a", owner="two@example.com", builder=builder)
        with self.assertRaises(BoxQuotaExceeded) as caught:
            builder.save("a", body(), owner="three@example.com")
        self.assertEqual(caught.exception.code, "quota_global")
        self.save(name="a", owner="one@example.com", builder=builder)

    def test_an_account_over_its_disk_budget_cannot_save(self):
        builder = self.make_builder(BoxLimits(account_max_bytes=1000))
        self.save(name="a", owner=ALICE, builder=builder)
        (self.root / "boxes" / owner_key(ALICE) / "a" / "a_base.stl").write_bytes(b"x" * 2000)
        with self.assertRaises(BoxQuotaExceeded) as caught:
            builder.save("a", body(), owner=ALICE)
        self.assertEqual(caught.exception.code, "quota_disk")

    def test_no_build_starts_when_the_disk_is_low(self):
        builder = self.make_builder(BoxLimits(min_free_bytes=10**18))
        with self.assertRaises(BoxBusy) as caught:
            builder.save("a", body(), owner=ALICE)
        self.assertEqual(caught.exception.code, "disk_full")
        self.assertFalse((self.root / "boxes").exists())

    def test_hosted_limits_come_from_the_environment(self):
        limits = BoxLimits.from_env(hosted=True, environ={})
        self.assertEqual((limits.daily_new_boxes, limits.daily_builds), (1, 20))
        self.assertTrue(limits.ephemeral_cache)
        self.assertEqual(limits.build_timeout, 90.0)
        local = BoxLimits.from_env(hosted=False, environ={})
        self.assertIsNone(local.daily_new_boxes)
        self.assertFalse(local.ephemeral_cache)
        tuned = BoxLimits.from_env(hosted=True, environ={"CADGEN_BOX_DAILY_NEW": "3", "CADGEN_BOX_MIN_FREE_BYTES": "-1"})
        self.assertEqual(tuned.daily_new_boxes, 3)
        self.assertIsNone(tuned.min_free_bytes)


class Capacity(unittest.TestCase):
    def test_a_full_queue_refuses_new_builds_until_one_finishes(self):
        with tempfile.TemporaryDirectory() as temp:
            gate = threading.Event()
            runner = RecordingRunner(gate=gate)
            builder = BoxBuilder(temp, limits=BoxLimits(max_builds=1, max_queue=1), runner=runner)
            builder.save("a", body(plan={"base": BASE, "lid": None}))
            builder.save("b", body(plan={"base": BASE, "lid": None}))
            with self.assertRaises(BoxBusy):
                builder.save("c", body(plan={"base": BASE, "lid": None}))
            # Re-saving a box that is already queued takes no new place.
            builder.save("b", body(plan={"base": BASE, "lid": None}))
            deadline = time.monotonic() + 5
            while not runner.scripts and time.monotonic() < deadline:
                time.sleep(0.01)
            self.assertEqual(len(runner.scripts), 1, "only one build runs at a time")
            gate.set()
            self.assertTrue(builder.wait("a", timeout=5))
            self.assertTrue(builder.wait("b", timeout=5))
            builder.save("c", body(plan={"base": BASE, "lid": None}))
            self.assertTrue(builder.wait("c", timeout=5))


class RealRunner(unittest.TestCase):
    def test_a_build_past_its_timeout_is_killed_and_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / "slow_box.py"
            script.write_text("import time\ntime.sleep(60)\n", encoding="utf-8")
            started = time.monotonic()
            result = run_model_script(script, timeout=1, max_output_bytes=10_000_000)
            self.assertTrue(result.timed_out)
            self.assertLess(time.monotonic() - started, 30)

    def test_build_output_is_kept_to_its_tail(self):
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / "chatty_box.py"
            script.write_text("import sys\nfor _ in range(200000):\n    print('x' * 20)\nprint('LAST')\n", encoding="utf-8")
            result = run_model_script(script, timeout=60, max_output_bytes=100_000_000)
            self.assertEqual(result.code, 0)
            self.assertLessEqual(len(result.output), 20_000)
            self.assertIn("LAST", result.output)

    def test_a_generated_script_builds_its_files_with_a_throwaway_cache(self):
        with tempfile.TemporaryDirectory() as temp:
            builder = BoxBuilder(temp, limits=BoxLimits(ephemeral_cache=True))
            builder.save("cup", body(plan={"base": BASE, "lid": None}))
            self.assertTrue(builder.wait("cup", timeout=240))
            status = builder.status("cup")
            self.assertEqual(status["build"]["state"], "done", status["build"])
            self.assertEqual(sorted(item["format"] for item in status["outputs"]), ["3mf", "step", "stl"])


class ExactGeometry(unittest.TestCase):
    def test_the_kernel_builds_a_plan_to_the_expected_volume(self):
        from cadgen.box_csg import shape_from_plan

        cup = {"type": "difference", "children": [
            {"type": "rrect", "w": 20, "d": 10, "h": 10, "r": 0},
            {"type": "rrect", "w": 16, "d": 6, "h": 10, "r": 0, "pos": [0, 0, 2]},
            {"type": "union", "rot": [90, 0, 0], "pos": [0, -5, 6], "children": [
                {"type": "cyl", "r": 1, "h": 4, "pos": [0, 0, -3]},
            ]},
        ]}
        shape = shape_from_plan(cup)
        box = shape.bounding_box()
        self.assertAlmostEqual(box.max.Z, 10, places=6)
        self.assertAlmostEqual(box.min.Y, -5, places=6)
        # 20*10*10 - 16*6*8, minus a d2 hole through the 2 mm front wall.
        expected = 2000 - 768 - 3.141592653589793 * 1 * 1 * 2
        self.assertAlmostEqual(shape.volume, expected, places=3)


if __name__ == "__main__":
    unittest.main()
