"""Manufactured filesystem controls; no tool bytes or executables are used."""
import copy
import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("boundary", Path(__file__).with_name("tool-boundary.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Controls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pins = {}
        for index, (role, (relative, unused)) in enumerate(m.SELECTED.items()):
            raw = ("manufactured:" + str(index)).encode()
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            self.pins[role] = (relative, hashlib.sha256(raw).hexdigest())
        self.patch = patch.object(m, "SELECTED", self.pins)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.first = self.root / self.pins["compiler"][0]

    def refused(self):
        r = m.ToolBoundary(self.root).capture("before-probes")
        self.assertFalse(r["complete"])
        self.assertIsNotNone(r["firstFailure"])
        self.assertNotIn(str(self.root), str(r))
        return r

    def test_positive_and_exclusive_text(self):
        b = m.ToolBoundary(self.root)
        a = b.capture("before-probes")
        z = b.capture("after-link")
        self.assertTrue(m.validate_pair(a, z)["boundaryConsistent"])
        out = self.root / "receipt.json"
        b.write(out, z)
        with self.assertRaises(m.Refusal): b.write(out, z)
        self.assertLess(out.stat().st_size, m.MAX_RECEIPT)

    def test_missing_symlink_hardlink(self):
        self.first.unlink()
        self.refused()
        target = self.root / "target"
        target.write_bytes(b"manufactured:0")
        self.first.symlink_to(target)
        self.refused()
        self.first.unlink()
        os.link(target, self.first)
        self.refused()

    def test_parent_symlink(self):
        parent = self.first.parent
        moved = parent.with_name("saved")
        parent.rename(moved)
        parent.symlink_to(moved, target_is_directory=True)
        self.refused()

    def test_parent_swap_during_read(self):
        original = os.read
        done = False
        def read(fd, size):
            nonlocal done
            raw = original(fd, size)
            if not done:
                done = True
                parent = self.first.parent
                parent.rename(parent.with_name("old"))
                parent.mkdir()
                self.first.write_bytes(b"manufactured:0")
            return raw
        with patch.object(m.os, "read", read): self.refused()

    def test_file_replace_and_oversize(self):
        original = os.read
        done = False
        def read(fd, size):
            nonlocal done
            raw = original(fd, size)
            if not done:
                done = True
                self.first.unlink()
                self.first.write_bytes(b"manufactured:0")
            return raw
        with patch.object(m.os, "read", read): self.refused()
        with patch.object(m, "MAX_FILE", 3): self.refused()

    def test_phase_failure_and_partial(self):
        b = m.ToolBoundary(self.root)
        self.assertTrue(b.capture("before-probes")["complete"])
        self.assertFalse(b.capture("before-probes")["complete"])
        with self.assertRaises(m.Refusal): b.capture("after-link")
        self.assertEqual(len(b.status()), 2)
        b = m.ToolBoundary(self.root)
        (self.root / self.pins["linker"][0]).unlink()
        r = b.capture("before-probes")
        self.assertEqual(list(r["roles"]), ["compiler", "assembler"])
        self.assertEqual(b.capture("failure-final")["firstFailure"], r["firstFailure"])
        self.assertFalse(m.ToolBoundary(self.root).capture("unknown")["complete"])

    def test_session_and_typed_schema(self):
        b = m.ToolBoundary(self.root)
        a, z = b.capture("before-probes"), b.capture("after-link")
        bad = copy.deepcopy(z)
        bad["session"] = "0" * 64
        with self.assertRaises(m.Refusal): m.validate_pair(a, bad)
        bad = copy.deepcopy(a)
        bad["sequence"] = True
        with self.assertRaises(m.Refusal): m.validate_pair(bad, z)
        bad = copy.deepcopy(a)
        bad["roles"]["compiler"]["before"]["links"] = True
        with self.assertRaises(m.Refusal): m.validate_pair(bad, z)
        other = m.ToolBoundary(self.root)
        with self.assertRaises(m.Refusal): other.write(self.root / "foreign.json", a)

    def test_failure_final_and_no_calls_after_poison(self):
        b = m.ToolBoundary(self.root)
        self.assertTrue(b.capture("failure-final")["complete"])
        with patch.object(m.os, "stat", side_effect=AssertionError("must not read")):
            self.assertEqual(b.capture("after-link")["firstFailure"], "phase-order")
        b = m.ToolBoundary(self.root)
        self.first.unlink()
        r = b.capture("before-probes")
        with patch.object(m.os, "stat", side_effect=AssertionError("must not read")):
            self.assertEqual(b.capture("failure-final")["firstFailure"], r["firstFailure"])

    def test_malformed_writer_never_serializes_or_opens(self):
        b = m.ToolBoundary(self.root)
        good = b.capture("before-probes")
        recursive = {}; recursive["cycle"] = recursive
        large = {str(i): i for i in range(20000)}
        nested = copy.deepcopy(good); nested["roles"]["compiler"]["before"]["bytes"] = recursive
        malformed = copy.deepcopy(good); malformed["session"] = "x" * 100000
        class Custom(dict): pass
        for value in (recursive, large, nested, malformed, Custom(good)):
            with patch.object(m.json, "dumps", side_effect=AssertionError("serialization forbidden")), patch.object(m.os, "open", side_effect=AssertionError("filesystem forbidden")):
                with self.assertRaises(m.Refusal): b.write(self.root / "bad", value)

    def test_swallowed_status_and_write_reentry(self):
        for operation in ("status", "write"):
            b = m.ToolBoundary(self.root)
            original = os.read
            calls = 0
            def read(fd, size):
                nonlocal calls
                calls += 1
                try:
                    if operation == "status": b.status()
                    else: b.write(self.root / "provisional", {})
                except m.Refusal: pass
                return original(fd, size)
            with patch.object(m.os, "read", read): r = b.capture("before-probes")
            self.assertEqual(r["firstFailure"], "reentry")
            self.assertEqual(calls, 1)
            self.assertEqual(r["roles"], {})
            self.assertFalse((self.root / "provisional").exists())
            self.assertEqual(b.status()[0]["firstFailure"], "reentry")

    def test_writer_origin_reentry(self):
        for operation in ("status", "write", "capture"):
            b = m.ToolBoundary(self.root)
            receipt = b.capture("before-probes")
            original = os.write
            calls = 0
            def write(fd, raw):
                nonlocal calls
                calls += 1
                try:
                    if operation == "status": b.status()
                    elif operation == "capture": b.capture("after-link")
                    else: b.write(self.root / "nested", receipt)
                except m.Refusal: pass
                return original(fd, raw)
            with patch.object(m.os, "write", write):
                with self.assertRaises(m.Refusal): b.write(self.root / ("out-" + operation), receipt)
            self.assertEqual(calls, 1)
            self.assertEqual(len(b.status()), 1)
            self.assertFalse((self.root / "nested").exists())
            self.assertEqual(b.capture("after-link")["firstFailure"], "reentry")

    def test_writer_open_reentry_closes_fd_and_stops(self):
        b = m.ToolBoundary(self.root)
        receipt = b.capture("before-probes")
        original_open, original_close = os.open, os.close
        opened, closed = [], []
        def open_file(*args, **kwargs):
            fd = original_open(*args, **kwargs)
            opened.append(fd)
            try: b.capture("after-link")
            except m.Refusal: pass
            return fd
        def close_file(fd):
            closed.append(fd)
            return original_close(fd)
        with patch.object(m.os, "open", open_file), patch.object(m.os, "close", close_file), patch.object(m.os, "write", side_effect=AssertionError("must not write")):
            with self.assertRaises(m.Refusal): b.write(self.root / "open-partial", receipt)
        self.assertEqual(opened, closed)
        self.assertEqual(len(b.status()), 1)
        with patch.object(m.os, "open", side_effect=AssertionError("poison must stop")):
            with self.assertRaises(m.Refusal): b.write(self.root / "later", receipt)
        self.assertEqual((self.root / "open-partial").stat().st_size, 0)

    def test_partial_diagnostic_write_keeps_failure_and_no_source_opens(self):
        b = m.ToolBoundary(self.root)
        self.first.unlink()
        receipt = b.capture("before-probes")
        original_failure = receipt["firstFailure"]
        original_open = os.open
        destination = self.root / "diagnostic"
        def open_file(path, *args, **kwargs):
            self.assertEqual(path, destination)
            return original_open(path, *args, **kwargs)
        with patch.object(m.os, "open", open_file): b.write(destination, receipt)
        self.assertEqual(b.status()[0]["firstFailure"], original_failure)
        with patch.object(m.os, "open", side_effect=AssertionError("no source opens")):
            later = b.capture("failure-final")
        self.assertEqual(later["firstFailure"], original_failure)
        with patch.object(m.os, "open", side_effect=AssertionError("no retry")):
            with self.assertRaises(m.Refusal): b.write(self.root / "alternative", receipt)
        b.write(self.root / "second-diagnostic", later)
        self.assertEqual(len(b._write_attempts), 2)

    def test_failed_write_consumed_and_partial_reentry_preserves_reason(self):
        b = m.ToolBoundary(self.root)
        self.first.unlink()
        receipt = b.capture("before-probes")
        original_failure = receipt["firstFailure"]
        original_write = os.write
        def write(fd, raw):
            try: b.status()
            except m.Refusal: pass
            return original_write(fd, raw)
        with patch.object(m.os, "write", write):
            with self.assertRaises(m.Refusal): b.write(self.root / "partial-reentry", receipt)
        self.assertEqual(b.status()[0]["firstFailure"], original_failure)
        with patch.object(m.os, "open", side_effect=AssertionError("no retry")):
            with self.assertRaises(m.Refusal): b.write(self.root / "retry", receipt)
        fresh = m.ToolBoundary(self.root)
        partial = fresh.capture("before-probes")
        with patch.object(m.os, "open", side_effect=OSError("manufactured")):
            with self.assertRaises(OSError): fresh.write(self.root / "failed", partial)
        with patch.object(m.os, "open", side_effect=AssertionError("no alternate")):
            with self.assertRaises(m.Refusal): fresh.write(self.root / "alternate", partial)

    def test_swallowed_reentry(self):
        b = m.ToolBoundary(self.root)
        original = os.read
        calls = 0
        def read(fd, size):
            nonlocal calls
            calls += 1
            try: b.capture("failure-final")
            except m.Refusal: pass
            return original(fd, size)
        with patch.object(m.os, "read", read):
            r = b.capture("before-probes")
        self.assertEqual(r["firstFailure"], "reentry")
        self.assertEqual(calls, 1)
        self.assertEqual(r["roles"], {})

if __name__ == "__main__":
    unittest.main()
