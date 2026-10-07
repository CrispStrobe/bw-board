#!/usr/bin/env python3
"""Small admission and process-bound controls; no xv6 or Node workload."""

from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from run import REQUIRED_SOURCE_ROLES, check_source_inventory, load_json, run_bounded


class RunnerControls(unittest.TestCase):
    def test_json_duplicate_and_nonfinite_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "input.json"
            for body in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}'):
                file.write_text(body)
                with self.assertRaises(ValueError):
                    load_json(file)
            file.write_text('{"x":1}')
            self.assertEqual(load_json(file), {"x": 1})

    def test_source_bytes_and_symlink_denied(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            scripts = root / "scripts"
            scripts.mkdir()
            inventory = {}
            for role in REQUIRED_SOURCE_ROLES:
                file = scripts / role
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(role.encode())
                inventory[role] = hashlib.sha256(role.encode()).hexdigest()
            check_source_inventory(root, inventory)
            victim = scripts / "probe-xv6-stock.mjs"
            victim.write_bytes(b"changed")
            with self.assertRaises(ValueError):
                check_source_inventory(root, inventory)
            victim.unlink()
            target = scripts / "elsewhere.mjs"
            target.write_bytes(b"./probe-xv6-stock.mjs")
            victim.symlink_to(target)
            with self.assertRaises(ValueError):
                check_source_inventory(root, inventory)

    def test_fresh_child_success_failure_and_timeout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            success = run_bounded([sys.executable, "-c", "print('ok')"], root,
                                  dict(os.environ), root / "success", "synthetic", seconds=2)
            self.assertEqual(success["exitCode"], 0)
            self.assertTrue(success["processGroupEmptyAfterExit"])
            self.assertGreater(success["cpuSeconds"], 0)
            self.assertEqual((root / "success" / "stdout.json").read_text().strip(), "ok")
            with self.assertRaises(ValueError):
                run_bounded([sys.executable, "-c", "raise SystemExit(7)"], root,
                            dict(os.environ), root / "failure", "synthetic", seconds=2)
            self.assertEqual(json.loads((root / "failure" / "process.json").read_text())
                             ["exitCode"], 7)
            with self.assertRaises(ValueError):
                run_bounded([sys.executable, "-c", "import time; time.sleep(3)"], root,
                            dict(os.environ), root / "timeout", "synthetic", seconds=1)
            timeout = json.loads((root / "timeout" / "process.json").read_text())
            self.assertTrue(timeout["timedOut"])
            self.assertTrue(timeout["processGroupEmptyAfterExit"])


if __name__ == "__main__":
    unittest.main()
