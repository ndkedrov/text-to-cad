"""Analytics behind the hosted box builder's admin page."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from cadgen.viewer.box_analytics import BoxAnalytics
from cadgen.viewer.boxes import BoxBuilder, BoxLimits, BuildResult

DAY = 86400.0
NOON = 1_789_473_600.0  # 2026-09-15 12:00 in Kyiv


class Clock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def runner(script, **options):
    return BuildResult(0, "")


class Analytics(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.clock = Clock(NOON)
        self.analytics = BoxAnalytics(str(self.root), clock=self.clock)

    def tearDown(self):
        self.temp.cleanup()

    def events(self):
        lines = []
        for path in sorted((self.root / ".box-analytics").glob("events-*.jsonl")):
            lines += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        return lines

    def test_an_account_is_registered_once_and_visits_once_a_day(self):
        for _ in range(3):
            self.analytics.seen("Alice@Example.com")
        self.clock.now += DAY
        self.analytics.seen("alice@example.com")
        kinds = [event["e"] for event in self.events()]
        self.assertEqual(kinds, ["account", "visit", "visit"])
        accounts = json.loads((self.root / ".box-analytics" / "accounts.json").read_text(encoding="utf-8"))
        self.assertEqual(list(accounts), ["alice@example.com"])

    def test_recording_ignores_values_that_are_not_plain(self):
        self.analytics.record("save", "a@example.com", box="x" * 500, new=True, junk={"nested": 1})
        event = self.events()[0]
        self.assertEqual(len(event["box"]), 200)
        self.assertTrue(event["new"])
        self.assertNotIn("junk", event)

    def test_stats_bucket_by_day_and_summarise_accounts(self):
        builder = BoxBuilder(str(self.root), limits=BoxLimits(), runner=runner, expose_paths=False)
        self.analytics.seen("alice@example.com")
        self.analytics.record("save", "alice@example.com", box="case", new=True)
        self.analytics.record("build", "alice@example.com", box="case", state="done", seconds=4.0, timedOut=False)
        self.clock.now -= 2 * DAY
        self.analytics.record("build", "bob@example.com", box="lid", state="error", seconds=90.0, timedOut=True)
        self.analytics.record("reject", "bob@example.com", code="quota_new", box="two")
        self.clock.now = NOON

        stats = self.analytics.stats(builder)
        totals = stats["totals"]
        self.assertEqual(totals["accounts"], 1)
        self.assertEqual((totals["builds7d"], totals["builds30d"], totals["failed30d"]), (2, 2, 1))
        self.assertEqual(totals["failureRate30d"], 0.5)
        self.assertEqual(totals["avgBuildSeconds7d"], 4.0)
        self.assertEqual(totals["activeToday"], 1)
        self.assertEqual(totals["active7d"], 2)
        self.assertEqual(stats["rejects"], {"quota_new": 1})
        self.assertEqual(len(stats["series"]), 30)
        self.assertEqual(stats["series"][-1]["newBoxes"], 1)
        self.assertEqual(stats["series"][-3]["timeouts"], 1)
        self.assertEqual(stats["accounts"][0]["email"], "alice@example.com")
        self.assertEqual(stats["accounts"][0]["builds"], 1)
        self.assertEqual(stats["recent"][0]["e"], "build")
        self.assertEqual(stats["queue"]["maxBuilds"], 2)


if __name__ == "__main__":
    unittest.main()
