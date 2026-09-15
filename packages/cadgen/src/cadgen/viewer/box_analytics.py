"""Usage analytics for a hosted box builder, and the numbers behind its admin page.

Two files live under a hidden folder of the served root, which no route serves:

* ``.box-analytics/events-YYYY-MM.jsonl`` is append-only, one event per line:
  ``{"t": epoch, "e": kind, "a": e-mail, ...fields}``. The kinds are ``account``
  (an account seen for the first time), ``visit`` (an account's first request of
  the day), ``save``, ``build`` and ``reject``.
* ``.box-analytics/accounts.json`` holds each account's e-mail with its first and
  last activity.

Only the admin stats route reads them. Recording never raises: analytics must not
break a request. Nothing here loads the kernel.
"""

from __future__ import annotations

import contextlib
import datetime as _dt
import json
import os
import shutil
import tempfile
import threading
import time
from collections import Counter, deque
from pathlib import Path
from typing import Any, Callable

__all__ = ["ANALYTICS_DIRNAME", "BoxAnalytics"]

ANALYTICS_DIRNAME = ".box-analytics"
SEEN_WRITE_INTERVAL_SECONDS = 300.0
RECENT_EVENTS = 200
HISTORY_DAYS = 400
_DAY_SECONDS = 86400
_FIELD_TYPES = (str, int, float, bool, type(None))


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


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(fraction * (len(ordered) - 1))))
    return round(ordered[index], 2)


class BoxAnalytics:
    """Records what accounts do with the box builder and summarises it for admins."""

    def __init__(self, root: str, *, timezone: str = "Europe/Kyiv", clock: Callable[[], float] = time.time) -> None:
        self.root = Path(root).resolve()
        self.directory = self.root / ANALYTICS_DIRNAME
        self.timezone = timezone
        self._clock = clock
        self._lock = threading.Lock()
        self._accounts: dict[str, dict] | None = None
        self._written_at: dict[str, float] = {}
        self._visits: set[tuple[str, str]] = set()

    def day(self, epoch: float) -> str:
        try:
            from zoneinfo import ZoneInfo

            return _dt.datetime.fromtimestamp(epoch, ZoneInfo(self.timezone)).date().isoformat()
        except Exception:  # noqa: BLE001 - no tz database: UTC days
            return _dt.datetime.fromtimestamp(epoch, _dt.timezone.utc).date().isoformat()

    # --- recording -------------------------------------------------------

    def seen(self, email: str) -> None:
        """An account made a request: keep its last activity, log its first visit of the day."""
        address = str(email or "").strip().lower()
        if not address or len(address) > 320:
            return
        now = self._clock()
        try:
            with self._lock:
                accounts = self._load_accounts()
                entry = accounts.get(address)
                is_new = entry is None
                if is_new:
                    entry = accounts[address] = {"firstSeen": now, "lastSeen": now}
                entry["lastSeen"] = now
                if is_new or now - self._written_at.get(address, 0.0) >= SEEN_WRITE_INTERVAL_SECONDS:
                    self._save_accounts(accounts)
                    self._written_at[address] = now
                visit = (self.day(now), address)
                first_visit = visit not in self._visits
                if first_visit:
                    self._visits = {key for key in self._visits if key[0] == visit[0]}
                    self._visits.add(visit)
        except Exception:  # noqa: BLE001 - analytics never breaks a request
            return
        if is_new:
            self.record("account", address)
        if first_visit:
            self.record("visit", address)

    def record(self, event: str, email: str | None = None, **fields: Any) -> None:
        now = self._clock()
        address = str(email or "").strip().lower() or None
        line: dict[str, Any] = {"t": round(now, 3), "e": str(event)[:32], "a": address}
        for key, value in fields.items():
            if isinstance(value, _FIELD_TYPES):
                line[str(key)[:32]] = value[:200] if isinstance(value, str) else value
        month = _dt.datetime.fromtimestamp(now, _dt.timezone.utc).strftime("%Y-%m")
        try:
            with self._lock:
                self.directory.mkdir(parents=True, exist_ok=True)
                with open(self.directory / f"events-{month}.jsonl", "a", encoding="utf-8", newline="\n") as stream:
                    stream.write(json.dumps(line, ensure_ascii=False, separators=(",", ":")) + "\n")
        except Exception:  # noqa: BLE001 - analytics never breaks a request
            return

    def _load_accounts(self) -> dict[str, dict]:
        if self._accounts is None:
            try:
                stored = json.loads((self.directory / "accounts.json").read_text(encoding="utf-8", errors="replace"))
            except (OSError, json.JSONDecodeError):
                stored = {}
            self._accounts = (
                {str(key): dict(value) for key, value in stored.items() if isinstance(value, dict)}
                if isinstance(stored, dict)
                else {}
            )
        return self._accounts

    def _save_accounts(self, accounts: dict[str, dict]) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        _atomic_write(self.directory / "accounts.json", json.dumps(accounts, ensure_ascii=False, indent=1) + "\n")

    # --- reading ---------------------------------------------------------

    def _events_since(self, since: float):
        if not self.directory.is_dir():
            return
        first_month = _dt.datetime.fromtimestamp(since, _dt.timezone.utc).strftime("%Y-%m")
        for path in sorted(self.directory.glob("events-*.jsonl")):
            if path.stem[len("events-"):] < first_month:
                continue
            try:
                with open(path, encoding="utf-8", errors="replace") as stream:
                    for raw in stream:
                        try:
                            event = json.loads(raw)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(event, dict) and isinstance(event.get("t"), (int, float)) and event["t"] >= since:
                            yield event
            except OSError:
                continue

    def stats(self, builder, *, days: int = 30) -> dict:
        """Everything the admin page shows, computed from the log, the accounts and the disk."""
        now = self._clock()
        with self._lock:
            accounts = {address: dict(entry) for address, entry in self._load_accounts().items()}

        day_keys: list[str] = []
        for offset in range(days - 1, -1, -1):
            key = self.day(now - offset * _DAY_SECONDS)
            if key not in day_keys:
                day_keys.append(key)
        today = self.day(now)
        series = {
            key: {"day": key, "builds": 0, "failed": 0, "timeouts": 0, "newBoxes": 0,
                  "newAccounts": 0, "rejects": 0, "active": set()}
            for key in day_keys
        }
        window_start = now - days * _DAY_SECONDS
        week_start = now - 7 * _DAY_SECONDS
        per_account: dict[str, dict] = {}
        rejects: Counter = Counter()
        durations: list[float] = []
        recent: deque = deque(maxlen=RECENT_EVENTS)
        builds_all = failed_all = 0

        for event in self._events_since(now - HISTORY_DAYS * _DAY_SECONDS):
            kind = event.get("e")
            address = event.get("a")
            stamp = float(event["t"])
            bucket = series.get(self.day(stamp)) if stamp >= window_start else None
            usage = per_account.setdefault(address, {"builds": 0, "failed": 0, "rejects": 0, "saves": 0}) if address else None
            if kind == "build":
                failed = event.get("state") != "done"
                builds_all += 1
                failed_all += int(failed)
                if usage is not None:
                    usage["builds"] += 1
                    usage["failed"] += int(failed)
                if bucket is not None:
                    bucket["builds"] += 1
                    bucket["failed"] += int(failed)
                    bucket["timeouts"] += int(bool(event.get("timedOut")))
                seconds = event.get("seconds")
                if not failed and stamp >= week_start and isinstance(seconds, (int, float)):
                    durations.append(float(seconds))
            elif kind == "save":
                if usage is not None:
                    usage["saves"] += 1
                if bucket is not None and event.get("new"):
                    bucket["newBoxes"] += 1
            elif kind == "reject":
                if usage is not None:
                    usage["rejects"] += 1
                if stamp >= window_start:
                    rejects[str(event.get("code") or "unknown")] += 1
                if bucket is not None:
                    bucket["rejects"] += 1
            elif kind == "account" and bucket is not None:
                bucket["newAccounts"] += 1
            if bucket is not None and address:
                bucket["active"].add(address)
            if kind != "visit":
                recent.append(event)

        rows = []
        boxes_total = bytes_total = 0
        for address, entry in accounts.items():
            try:
                disk = builder.account_usage(address)
            except Exception:  # noqa: BLE001 - one unreadable folder must not blank the page
                disk = {"boxes": 0, "bytes": 0}
            boxes_total += disk["boxes"]
            bytes_total += disk["bytes"]
            usage = per_account.get(address, {})
            rows.append({
                "email": address,
                "firstSeen": entry.get("firstSeen"),
                "lastSeen": entry.get("lastSeen"),
                "boxes": disk["boxes"],
                "bytes": disk["bytes"],
                "saves": usage.get("saves", 0),
                "builds": usage.get("builds", 0),
                "failed": usage.get("failed", 0),
                "rejects": usage.get("rejects", 0),
            })
        rows.sort(key=lambda row: row.get("lastSeen") or 0, reverse=True)

        last_week = day_keys[-7:]
        builds_window = sum(bucket["builds"] for bucket in series.values())
        failed_window = sum(bucket["failed"] for bucket in series.values())
        try:
            usage_disk = shutil.disk_usage(builder.root)
            disk_info = {"free": usage_disk.free, "total": usage_disk.total}
        except OSError:
            disk_info = None
        limits = builder.limits
        return {
            "generatedAt": now,
            "timezone": self.timezone,
            "days": days,
            "totals": {
                "accounts": len(accounts),
                "newAccounts7d": sum(1 for entry in accounts.values() if (entry.get("firstSeen") or 0) >= week_start),
                "newAccounts30d": sum(1 for entry in accounts.values() if (entry.get("firstSeen") or 0) >= window_start),
                "activeToday": len(series[today]["active"]) if today in series else 0,
                "active7d": len(set().union(*(series[key]["active"] for key in last_week))),
                "boxes": boxes_total,
                "bytes": bytes_total,
                "buildsToday": series[today]["builds"] if today in series else 0,
                "builds7d": sum(series[key]["builds"] for key in last_week),
                "builds30d": builds_window,
                "failed30d": failed_window,
                "failureRate30d": round(failed_window / builds_window, 4) if builds_window else None,
                "buildsAllTime": builds_all,
                "failedAllTime": failed_all,
                "avgBuildSeconds7d": round(sum(durations) / len(durations), 2) if durations else None,
                "p95BuildSeconds7d": _percentile(durations, 0.95),
            },
            "series": [{**bucket, "active": len(bucket["active"])} for bucket in series.values()],
            "rejects": dict(rejects.most_common()),
            "accounts": rows,
            # Newest first; events logged in the same instant keep their logged order, latest first.
            "recent": [event for _, event in sorted(enumerate(recent), key=lambda pair: (pair[1]["t"], pair[0]), reverse=True)],
            "queue": builder.activity(),
            "disk": disk_info,
            "limits": {
                "dailyNewBoxes": limits.daily_new_boxes,
                "dailyBuilds": limits.daily_builds,
                "globalDailyNewBoxes": limits.global_daily_new_boxes,
                "accountMaxBytes": limits.account_max_bytes,
                "minFreeBytes": limits.min_free_bytes,
                "maxBuilds": limits.max_builds,
                "maxQueue": limits.max_queue,
                "buildTimeout": limits.build_timeout,
            },
        }
