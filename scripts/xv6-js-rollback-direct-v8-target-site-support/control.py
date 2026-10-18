#!/usr/bin/env python3
"""CPU-free same-run lease, report and failure-order controls."""
import importlib.util
import json
from pathlib import Path
import tempfile

path = Path(__file__).with_name("run.py")
spec = importlib.util.spec_from_file_location("direct_v8_support_runner", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.FIRST.name == "xv6-js-rollback-direct-v8-first-build-profiler-header"
assert module.AUTHORITY.parent.name == "xv6-js-rollback-direct-v8-first-build"

with tempfile.TemporaryDirectory(prefix="direct-v8-support-pure-") as name:
    root = Path(name)
    addon = root / "rollback_sampler.node"
    addon.write_bytes(b"synthetic addon")
    expected = module.sha(b"synthetic addon")
    assert module.lease(module._read_bootstrap, addon, expected,
                        len(b"synthetic addon"), 100) == {
        "bytes": 15, "sha256": expected}
    addon.write_bytes(b"synthetic other")
    try: module.lease(module._read_bootstrap, addon, expected, 15, 100)
    except ValueError: pass
    else: raise AssertionError("changed same-run addon admitted")
    addon.unlink()
    addon.symlink_to(root / "other")
    try: module.lease(module._read_bootstrap, addon, expected, 15, 100)
    except (ValueError, OSError): pass
    else: raise AssertionError("symlink addon admitted")

    directory = root / "minor-baseline"
    directory.mkdir()
    (directory / "pre.json").write_bytes(b"{}")
    assert module.output_roles(module._read_bootstrap, directory) == {"pre.json": b"{}"}
    (directory / "addon.node").write_bytes(b"binary")
    try: module.output_roles(module._read_bootstrap, directory)
    except ValueError: pass
    else: raise AssertionError("nested binary output admitted")
    (directory / "addon.node").unlink()

    report = {"firstFailure": None, "secondaryFailures": []}
    module.latch(report, ValueError("compiler-timeout"), "compile-returned")
    module.latch(report, ValueError("postcompile-tool-ld-refusal"), "postcompile")
    assert report["firstFailure"] == {"type": "ValueError",
        "reason": "compiler-timeout", "stage": "compile-returned"}
    assert report["secondaryFailures"][0]["reason"] == \
        "postcompile-tool-ld-refusal"
    receipt = root / "target-site-support.json"
    module.write_report(receipt, report)
    assert json.loads(receipt.read_bytes()) == report
    assert not (root / "target-site-support.pending.json").exists()

    # Neither the JSON receipt nor a substituted live source module can
    # authorize execution before exact Git HEAD/blob checks.
    head = "a" * 40
    live_source = module._read_bootstrap(path.with_name("source.py"), 256000)
    source = {"roles": {module.SOURCE_ROLE: module.sha(live_source)}}
    def git_fact(*args):
        if args == ("rev-parse", "HEAD"): return (head + "\n").encode()
        if args == ("merge-base", module.BASE, head):
            return (module.BASE + "\n").encode()
        if args == ("status", "--porcelain=v1", "-uall"): return b""
        if args == ("show", head + ":" + module.SOURCE_ROLE): return live_source
        raise AssertionError("unexpected bootstrap Git query")
    assert module.bootstrap_source(source, head, git_fact) == live_source
    bad = {"roles": {module.SOURCE_ROLE: "0" * 64}}
    try: module.bootstrap_source(bad, head, git_fact)
    except ValueError: pass
    else: raise AssertionError("receipt-authorized source module admitted")
    def wrong_blob(*args):
        value = git_fact(*args)
        return b"forged module" if args[0] == "show" else value
    try: module.bootstrap_source(source, head, wrong_blob)
    except ValueError: pass
    else: raise AssertionError("substituted live module admitted")
    def dirty_git(*args):
        return b" M source.py" if args[0] == "status" else git_fact(*args)
    try: module.bootstrap_source(source, head, dirty_git)
    except ValueError: pass
    else: raise AssertionError("dirty pre-exec checkout admitted")

    # A failing compiler still publishes all five post-tool attempts. Its
    # primary result cannot be replaced by a later tool mismatch.
    class FakeCompile:
        ARGS = ["-std=c++17", "addon.cc"]
        calls = 0
        def run_bounded(self, *_args):
            self.calls += 1
            return {"timedOut": True, "outputBound": False, "complete": False,
                    "exitCode": -15, "stdout": b"", "stderr": b""}
        def child_receipt(self, value, argv):
            return {**value, "argv": argv, "stdout": {}, "stderr": {}}
        def compile_or_post_failure(self, value, failures):
            return ValueError("compiler-timeout") if value["timedOut"] else \
                (ValueError("post-tool") if failures else None)
        def postcompile_observations(self, *_args):
            return ({role: {"attempted": True} for role in
                     ("g++", "cc1plus", "collect2", "as", "ld")},
                    [{"role": "ld", "type": "ValueError", "reason": "mutated"}])
    fake = FakeCompile()
    build_report = {"build": {"compile": None, "postTools": None,
                              "postToolFailures": []},
                    "firstFailure": None, "secondaryFailures": [],
                    "stage": "five-tool-roster"}
    try:
        module.compile_once(fake, {"tools": {"g++": {"realpath": "/fake/g++"}}},
                            {}, root, {}, build_report, receipt)
    except ValueError as error:
        assert str(error) == "compiler-timeout"
    else: raise AssertionError("failed compile reached case stage")
    assert fake.calls == 1 and len(build_report["build"]["postTools"]) == 5
    assert build_report["firstFailure"]["reason"] == "compiler-timeout"
    assert build_report["build"]["postToolFailures"][0]["role"] == "ld"

    # A refused first support child retains its partial raw file and blocks
    # every later case; no native runtime is launched in this synthetic test.
    class FakeChild:
        read_ordinary = staticmethod(module._read_bootstrap)
        def __init__(self, timeout=False, success=False):
            self.calls = 0
            self.timeout = timeout
            self.success = success
        def run_bounded(self, argv, _work, _env, _timeout):
            self.calls += 1
            out = Path(argv[-1])
            out.mkdir()
            (out / "pre.json").write_bytes(b'{"partial":true}')
            return {"timedOut": self.timeout, "outputBound": False,
                    "complete": not self.timeout,
                    "exitCode": -15 if self.timeout else (0 if self.success else 7),
                    "stdout": b"", "stderr": b""}
        def child_receipt(self, value, argv):
            return {**value, "argv": argv, "stdout": {}, "stderr": {}}
    child = FakeChild()
    node = root / "node"
    node.write_bytes(b"synthetic node")
    addon.unlink()
    addon.write_bytes(b"synthetic addon")
    roles = {"scripts/xv6-js-rollback-direct-v8-target-site/" + role:
             module.sha(module._read_bootstrap(module.TARGET / role, 256000))
             for role in ("case.mjs", "policy.mjs")}
    auth = {"nodeExecutable": {"sha256": module.sha(b"synthetic node"),
                               "bytes": len(b"synthetic node")}}
    def fresh_report():
        return {"build": {"addon": {"sha256": expected,
                                    "bytes": len(b"synthetic addon"),
                                    "loadAttempted": False, "loaded": False}},
                "cases": [], "firstFailure": None,
                "secondaryFailures": [], "stage": "ready"}
    support_report = fresh_report()
    case_evidence = root / "case-evidence"
    case_evidence.mkdir()
    try:
        module.run_cases(child, None, roles, auth, support_report, receipt,
                         root, case_evidence, {}, node, addon)
    except ValueError as error:
        assert str(error) == "bounded support child refused: minor-baseline"
    else: raise AssertionError("failed support child admitted")
    assert child.calls == 1 and len(support_report["cases"]) == 1
    assert support_report["cases"][0]["raw"]["pre.json"] == {
        "bytes": 16, "sha256": module.sha(b'{"partial":true}')}
    assert support_report["firstFailure"]["reason"] == \
        "bounded support child refused: minor-baseline"
    assert support_report["build"]["addon"]["loadAttempted"] is True
    assert support_report["build"]["addon"]["loaded"] is None
    assert support_report["cases"][0]["nodeLease"]["sha256"] == \
        module.sha(b"synthetic node")
    assert support_report["cases"][0]["addonLease"]["sha256"] == expected

    timeout_child = FakeChild(timeout=True)
    timeout_report = fresh_report()
    timeout_evidence = root / "timeout-evidence"
    timeout_evidence.mkdir()
    try:
        module.run_cases(timeout_child, None, roles, auth, timeout_report,
                         receipt, root, timeout_evidence, {}, node, addon)
    except ValueError as error:
        assert str(error) == "bounded support child refused: minor-baseline"
    else: raise AssertionError("timed-out first child admitted")
    assert timeout_child.calls == 1 and len(timeout_report["cases"]) == 1
    assert timeout_report["cases"][0]["raw"]["pre.json"] == {
        "bytes": 16, "sha256": module.sha(b'{"partial":true}')}
    assert timeout_report["cases"][0]["child"]["timedOut"] is True
    assert timeout_report["build"]["addon"]["loadAttempted"] is True
    assert timeout_report["build"]["addon"]["loaded"] is None

    class RefusingGrade:
        def grade_case(self, *_args):
            raise ValueError("synthetic raw grade refused")
    grade_report = fresh_report()
    grade_child = FakeChild(success=True)
    grade_evidence = root / "grade-evidence"
    grade_evidence.mkdir()
    try:
        module.run_cases(grade_child, RefusingGrade(), roles, auth,
                         grade_report, receipt, root, grade_evidence,
                         {}, node, addon)
    except ValueError as error:
        assert str(error) == "synthetic raw grade refused"
    else: raise AssertionError("raw-grade refusal admitted")
    assert grade_child.calls == 1 and len(grade_report["cases"]) == 1
    assert grade_report["firstFailure"]["reason"] == \
        "synthetic raw grade refused"
    assert grade_report["build"]["addon"]["loadAttempted"] is True
    assert grade_report["build"]["addon"]["loaded"] is None

    class PassFirstGrade:
        def grade_case(self, kind, _raw):
            return {"kind": kind}
    class FirstPassSecondFail(FakeChild):
        def run_bounded(self, argv, work, env, timeout):
            self.success = self.calls == 0
            return super().run_bounded(argv, work, env, timeout)
    later_child = FirstPassSecondFail()
    later_report = fresh_report()
    later_evidence = root / "later-evidence"
    later_evidence.mkdir()
    try:
        module.run_cases(later_child, PassFirstGrade(), roles, auth,
                         later_report, receipt, root, later_evidence,
                         {}, node, addon)
    except ValueError as error:
        assert str(error) == "bounded support child refused: minor-enabled"
    else: raise AssertionError("later child refusal admitted")
    assert later_child.calls == 2 and len(later_report["cases"]) == 2
    assert later_report["build"]["addon"]["loadAttempted"] is True
    assert later_report["build"]["addon"]["loaded"] is True
    assert later_report["firstFailure"]["reason"] == \
        "bounded support child refused: minor-enabled"
print("direct V8 target-site-support runner controls PASS")
