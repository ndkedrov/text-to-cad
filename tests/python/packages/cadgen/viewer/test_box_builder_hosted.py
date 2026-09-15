"""The hosted (internet-facing) viewer: only the client and the signed-in account's boxes."""

from __future__ import annotations

import base64
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path

from cadgen.viewer import handler as handler_module
from cadgen.viewer.boxes import BuildResult
from cadgen.viewer.http_app import create_cad_app

BASE = {"type": "rrect", "w": 40, "d": 30, "h": 20, "r": 3}
GUARD = {"x-cadgen-viewer": "1", "content-type": "application/json"}
PROXY_SECRET = "proxy-secret-for-tests"


def proxy_authorization(secret: str = PROXY_SECRET) -> str:
    return "Basic " + base64.b64encode(f"alice:{secret}".encode("utf-8")).decode("ascii")


def outputs_writing_runner(script: Path, **options) -> BuildResult:
    stem = script.with_suffix("")
    for fmt in ("step", "stl", "3mf"):
        Path(f"{stem}.{fmt}").write_text(f"{fmt} bytes", encoding="utf-8")
    return BuildResult(0, "")


class HostedServer:
    def __init__(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = os.path.join(self.tmp.name, "data")
        os.makedirs(self.root)
        self.dist = os.path.join(self.tmp.name, "dist")
        os.makedirs(os.path.join(self.dist, "assets"))
        Path(self.dist, "index.html").write_text("<!doctype html><title>cad</title>", encoding="utf-8")
        Path(self.root, "secret.step").write_text("not for the internet", encoding="utf-8")
        settings = {
            "CADGEN_VIEWER_HOSTED": "1",
            "CADGEN_VIEWER_PROXY_SECRET": PROXY_SECRET,
            "CADGEN_VIEWER_ADMIN_EMAILS": "owner@example.com",
            "CADGEN_VIEWER_SOURCE_URL": "https://example.com/source",
            "CADGEN_VIEWER_SOURCE_VERSION": "0.5.1-box.abc1234",
            "CADGEN_VIEWER_SOURCE_VERSION_URL": "https://example.com/source/commit/abc1234",
            "CADGEN_VIEWER_TELEGRAM_URL": "javascript:alert(1)",
            "CADGEN_BOX_DAILY_NEW": "1",
            "CADGEN_BOX_MIN_FREE_BYTES": "-1",
        }
        previous = {key: os.environ.get(key) for key in settings}
        os.environ.update(settings)
        try:
            self.app = create_cad_app(root=self.root, host="127.0.0.1", port=0, dist_dir=self.dist)
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value
        self.app.boxes._runner = outputs_writing_runner
        self.server = handler_module.serve(self.app, "127.0.0.1", 0)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.tmp.cleanup()

    def request(self, method, path, *, account=None, headers=None, body=None, proxy=True):
        all_headers = dict(headers or {})
        if proxy:
            all_headers.setdefault("authorization", proxy_authorization())
        if account:
            all_headers["x-forwarded-email"] = account
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            conn.request(method, path, body=body, headers=all_headers)
            response = conn.getresponse()
            return response.status, {k.lower(): v for k, v in response.getheaders()}, response.read()
        finally:
            conn.close()

    def json(self, method, path, **kwargs):
        status, headers, payload = self.request(method, path, **kwargs)
        return status, json.loads(payload.decode("utf-8")) if payload else None

    def save(self, name, account, plan=None):
        body = json.dumps({"spec": {"base": {"width": 40}}, "plan": plan or {"base": BASE, "lid": None}})
        return self.json("POST", f"/__cad/boxes/save?name={name}", account=account, headers=GUARD, body=body)

    def wait_built(self, name, account):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            status, payload = self.json("GET", f"/__cad/boxes/status?name={name}", account=account)
            if status == 200 and (payload.get("build") or {}).get("state") in ("done", "error"):
                return payload
            time.sleep(0.05)
        raise AssertionError("build did not finish")


class HostedSurface(unittest.TestCase):
    def setUp(self):
        self.server = HostedServer()

    def tearDown(self):
        self.server.close()

    def test_nothing_answers_without_the_proxy_secret(self):
        for path in ("/", "/__cad/server", "/__cad/boxes"):
            with self.subTest(path=path, secret="missing"):
                status, _, _ = self.server.request("GET", path, account="alice@example.com", proxy=False)
                self.assertEqual(status, 401)
            with self.subTest(path=path, secret="wrong"):
                status, _, _ = self.server.request(
                    "GET", path, account="alice@example.com",
                    headers={"authorization": proxy_authorization("guess")},
                )
                self.assertEqual(status, 401)

    def test_the_client_is_served_and_server_info_hides_the_machine(self):
        status, _, body = self.server.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>cad</title>", body)
        status, info = self.server.json("GET", "/__cad/server", account="alice@example.com")
        self.assertEqual(status, 200)
        for key in ("rootPath", "packageDir", "identityToken", "viewerVersion", "url"):
            self.assertEqual(info[key], "", key)
        self.assertEqual((info["pid"], info["startedAt"]), (0, 0))
        self.assertEqual(info["boxBuilder"]["mode"], "hosted")
        self.assertEqual(info["boxBuilder"]["account"], "alice@example.com")
        self.assertEqual(info["boxBuilder"]["dailyNewBoxes"], 1)
        self.assertEqual(info["boxBuilder"]["sourceUrl"], "https://example.com/source")
        self.assertEqual(info["boxBuilder"]["sourceVersion"], "0.5.1-box.abc1234")
        self.assertEqual(info["boxBuilder"]["sourceVersionUrl"], "https://example.com/source/commit/abc1234")
        self.assertEqual(info["boxBuilder"]["telegramUrl"], "", "a non-https link is never passed to the client")

    def test_the_catalog_is_empty_and_never_lists_the_root(self):
        status, catalog = self.server.json("GET", "/__cad/catalog")
        self.assertEqual(status, 200)
        self.assertEqual(catalog["entries"], [])

    def test_every_local_file_store_compile_and_cache_route_is_absent(self):
        secret = os.path.join(self.server.root, "secret.step").replace("\\", "/")
        cases = [
            ("GET", f"/__cad/asset?file={secret}", None, {}),
            ("GET", f"/__cad/artifact?file={secret}", None, {}),
            ("GET", "/__cad/store?file=" + "a" * 64 + "/assembly.json", None, {}),
            ("GET", "/__tess_cache/a.tess", None, {}),
            ("POST", f"/__cad/artifact?file={secret}&force=1", b"", GUARD),
            ("POST", "/__tess_cache/a.tess", b"x" * 10, GUARD),
            ("POST", "/__tess_cache/batch", b'{"names":["a.tess"]}', GUARD),
        ]
        for method, path, body, headers in cases:
            with self.subTest(method=method, path=path[:40]):
                status, _, payload = self.server.request(method, path, account="alice@example.com", headers=headers, body=body)
                self.assertEqual(status, 404)
                self.assertNotIn(b"not for the internet", payload)

    def test_box_routes_need_an_account(self):
        for path in ("/__cad/boxes", "/__cad/boxes/spec?name=a", "/__cad/boxes/status?name=a", "/__cad/boxes/file?name=a&part=base&format=stl"):
            with self.subTest(path=path):
                status, payload = self.server.json("GET", path)
                self.assertEqual(status, 401)
                self.assertEqual(payload["code"], "unauthorized")

    def test_a_save_needs_the_guard_header_and_a_small_body(self):
        status, _, _ = self.server.request(
            "POST", "/__cad/boxes/save?name=a", account="alice@example.com",
            headers={"content-type": "application/json"}, body=b"{}",
        )
        self.assertEqual(status, 403)
        status, payload = self.server.json(
            "POST", "/__cad/boxes/save?name=a", account="alice@example.com",
            headers=GUARD, body=b" " * (1024 * 1024 + 1),
        )
        self.assertEqual(status, 413)
        self.assertEqual(payload["code"], "too_large")

    def test_accounts_are_isolated_and_files_download_as_attachments(self):
        status, saved = self.server.save("case", "alice@example.com")
        self.assertEqual(status, 200, saved)
        built = self.server.wait_built("case", "alice@example.com")
        self.assertEqual(built["build"]["state"], "done")
        self.assertTrue(all("path" not in item for item in built["outputs"]))

        status, listing = self.server.json("GET", "/__cad/boxes", account="bob@example.com")
        self.assertEqual((status, listing["boxes"]), (200, []))
        status, payload = self.server.json("GET", "/__cad/boxes/spec?name=case", account="bob@example.com")
        self.assertEqual((status, payload["code"]), (404, "not_found"))
        status, _, _ = self.server.request("GET", "/__cad/boxes/file?name=case&part=base&format=stl", account="bob@example.com")
        self.assertEqual(status, 404)

        status, headers, body = self.server.request(
            "GET", "/__cad/boxes/file?name=case&part=base&format=stl", account="alice@example.com",
        )
        self.assertEqual(status, 200)
        self.assertEqual(body, b"stl bytes")
        self.assertEqual(headers["content-disposition"], 'attachment; filename="case_base.stl"')
        self.assertEqual(headers["content-type"], "model/stl")

    def test_the_daily_new_box_limit_answers_429_with_a_code(self):
        self.assertEqual(self.server.save("first", "alice@example.com")[0], 200)
        self.server.wait_built("first", "alice@example.com")
        status, payload = self.server.save("second", "alice@example.com")
        self.assertEqual(status, 429)
        self.assertEqual(payload["code"], "quota_new")
        self.assertEqual(self.server.save("second", "bob@example.com")[0], 200)

    def test_errors_carry_no_server_detail(self):
        status, payload = self.server.json(
            "POST", "/__cad/boxes/save?name=x", account="alice@example.com",
            headers=GUARD, body=json.dumps({"spec": {}, "plan": {"base": {"type": "cyl", "r": 10**400, "h": 1}}}),
        )
        self.assertEqual(status, 400)
        self.assertEqual(payload["code"], "bad_plan")
        self.assertNotIn(self.server.root, json.dumps(payload))
        self.assertNotIn("Traceback", json.dumps(payload))

    def test_the_admin_page_and_its_stats_exist_only_for_admins(self):
        for account in (None, "alice@example.com"):
            with self.subTest(account=account):
                self.assertEqual(self.server.request("GET", "/admin", account=account)[0], 404)
                self.assertEqual(self.server.request("GET", "/__cad/admin/stats", account=account)[0], 404)
        status, headers, body = self.server.request("GET", "/admin", account="Owner@Example.com")
        self.assertEqual(status, 200)
        self.assertIn("text/html", headers["content-type"])
        self.assertIn(b"/__cad/admin/stats", body)
        self.assertTrue(self.server.json("GET", "/__cad/server", account="owner@example.com")[1]["boxBuilder"]["admin"])
        self.assertFalse(self.server.json("GET", "/__cad/server", account="alice@example.com")[1]["boxBuilder"]["admin"])

    def test_admin_stats_count_accounts_saves_builds_and_refusals(self):
        self.assertEqual(self.server.save("first", "alice@example.com")[0], 200)
        self.server.wait_built("first", "alice@example.com")
        self.assertEqual(self.server.save("second", "alice@example.com")[0], 429)
        status, stats = self.server.json("GET", "/__cad/admin/stats", account="owner@example.com")
        self.assertEqual(status, 200)
        alice = next(row for row in stats["accounts"] if row["email"] == "alice@example.com")
        self.assertEqual((alice["boxes"], alice["builds"], alice["rejects"]), (1, 1, 1))
        self.assertEqual(stats["rejects"].get("quota_new"), 1)
        self.assertEqual(stats["totals"]["builds7d"], 1)
        self.assertEqual(stats["series"][-1]["newBoxes"], 1)
        kinds = [event["e"] for event in stats["recent"]]
        self.assertIn("build", kinds)
        self.assertIn("reject", kinds)
        self.assertEqual(stats["service"]["sourceVersion"], "0.5.1-box.abc1234")


if __name__ == "__main__":
    unittest.main()
