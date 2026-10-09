#!/usr/bin/env python3
"""CPU-free first-build source and file/mock-process controls."""
import copy
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile

path = Path(__file__).with_name("run.py")
spec = importlib.util.spec_from_file_location("direct_v8_first_build", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
authority = module.checked_authority(json.loads(path.with_name("authority.json").read_bytes()))
assert set(authority["tools"]) == set(module.TOOLS)
assert authority["arguments"] == module.ARGS
assert authority["headersArchive"]["totalMemberBytes"] == 49_002_796


def refuse(operation):
    try:
        operation()
    except (ValueError, FileExistsError):
        return
    raise AssertionError("first-build malformed input accepted")


for mutate in (
    lambda x: x["original"].update(reportSha256="0" * 64),
    lambda x: x["nodeExecutable"].update(bytes=1),
    lambda x: x["headersArchive"].update(canonicalMemberMapSha256="0" * 64),
    lambda x: x["tools"]["cc1plus"].update(versionStatus="VERSION_OBSERVED"),
    lambda x: x["tools"]["collect2"].update(versionStatus="VERSION_OBSERVED"),
    lambda x: x.update(arguments=["-c", "addon.cc"]),
):
    altered = copy.deepcopy(authority)
    mutate(altered)
    refuse(lambda: module.checked_authority(altered))

with tempfile.TemporaryDirectory(prefix="direct-v8-first-build-pure-") as temp:
    root = Path(temp)
    file = root / "role"
    file.write_bytes(b"owned")
    assert module.read_ordinary(file, 10) == b"owned"
    refuse(lambda: module.read_ordinary(file, 4))
    file.unlink()
    file.symlink_to(root / "missing")
    refuse(lambda: module.read_ordinary(file, 10))
    file.unlink()
    file.write_bytes(b"owned")
    original_open = module.os.open
    swapped = False
    def race_fifo(target, flags, *args, **kwargs):
        global swapped
        if Path(target) == file and not swapped:
            swapped = True
            assert flags & os.O_NONBLOCK
            file.unlink()
            os.mkfifo(file)
        return original_open(target, flags, *args, **kwargs)
    try:
        module.os.open = race_fifo
        refuse(lambda: module.read_ordinary(file, 10))
        assert swapped
    finally:
        module.os.open = original_open
    file.unlink()
    file.write_bytes(b"owned")
    original_read = module.os.read
    replaced = False
    def race_inode(fd, length):
        global replaced
        raw = original_read(fd, length)
        if not replaced:
            replaced = True
            file.unlink()
            file.write_bytes(b"owned")
        return raw
    try:
        module.os.read = race_inode
        refuse(lambda: module.read_ordinary(file, 10))
        assert replaced
    finally:
        module.os.read = original_read

    class Member:
        def __init__(self, name, body=b"x", kind="regular"):
            self.name, self.body, self.kind = name, body, kind
            self.size = len(body)
        def isfile(self): return self.kind == "regular"
        def isdir(self): return self.kind == "directory"

    class Archive:
        def __init__(self, members): self.members = members
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def __iter__(self): return iter(self.members)
        def extractfile(self, member): return io.BytesIO(member.body)

    original_tar = module.tarfile.open
    prefix = "node-v20.20.2/include/node/"
    def parse(members):
        module.tarfile.open = lambda **_kwargs: Archive(members)
        with tempfile.TemporaryDirectory(dir=root) as output:
            return module.extract_headers(b"mock", Path(output))
    try:
        members = [Member(prefix + "node.h"), Member(prefix + "v8-profiler.h")]
        result = parse(members)
        assert result["memberCount"] == 2 and result["totalMemberBytes"] == 2
        refuse(lambda: parse(members + [members[0]]))
        refuse(lambda: parse([Member(prefix + "node.h", b"x" * 2_000_001)]))
        refuse(lambda: parse([Member("node-v20.20.2/../escape")]))
        refuse(lambda: parse([Member(prefix + "node.h", kind="symlink")]))
        refuse(lambda: parse([Member(prefix + "node.h")]))
    finally:
        module.tarfile.open = original_tar

    env = module.closed_environment(root)
    assert set(env) == {"PATH", "LANG", "LC_ALL", "TZ", "HOME", "TMPDIR"}
    assert not set(env) & {"GCC_EXEC_PREFIX", "COMPILER_PATH", "CPATH",
                           "CPLUS_INCLUDE_PATH", "LIBRARY_PATH", "LD_PRELOAD"}
    good = {"exitCode": 0, "timedOut": False, "outputBound": False,
            "complete": True, "stdout": b"", "stderr": b""}
    module.require_compile(good)
    for change in ({"exitCode": 1}, {"timedOut": True}, {"outputBound": True},
                   {"complete": False}, {"stdout": b"noise"},
                   {"stderr": b"warning"}):
        bad = {**good, **change}
        receipt = module.child_receipt(bad, ["pinned-g++", *module.ARGS])
        assert receipt["stderr"]["sha256"] == module.sha(bad["stderr"])
        refuse(lambda: module.require_compile(bad))

    mock_identity = {}
    for name, item in authority["tools"].items():
        mock_identity[item["selectedPath"]] = {
            "realpath": item["realpath"], "bytes": item["bytes"],
            "sha256": item["sha256"], "device": 1, "inode": len(name)}
        mock_identity[item["realpath"]] = copy.deepcopy(mock_identity[item["selectedPath"]])
    original_pin = module.pinned_target
    original_run = module.run_bounded
    original_which = module.shutil.which
    def fake_pin(value, _limit=100 * 1024 * 1024):
        if str(value) not in mock_identity:
            raise ValueError("unreviewed tool")
        return copy.deepcopy(mock_identity[str(value)])
    def fake_run(argv, _cwd, _env, _timeout):
        name = argv[1].split("=", 1)[1]
        return {**good, "stdout": base64.b64decode(
            authority["tools"][name]["locatorStdoutBase64"], validate=True)}
    try:
        module.pinned_target = fake_pin
        module.shutil.which = lambda name, **_kwargs: (
            authority["tools"]["g++"]["realpath"] if name == "g++" else
            authority["tools"][name]["selectedPath"])
        module.run_bounded = fake_run
        rows = []
        roster = module.identity_roster(authority, root, env, lambda kind, row: rows.append((kind, row)))
        assert len(roster) == 5 and sum(kind == "identity" for kind, _ in rows) == 5
        assert sum(kind == "locator" for kind, _ in rows) == 4
        module.recheck_roster(authority, roster)
        post, failures = module.postcompile_observations(authority, roster)
        assert set(post) == set(module.TOOLS) and not failures
        assert all(row["matched"] and row["error"] is None for row in post.values())
        assert module.compile_or_post_failure(good, failures) is None
        for name in module.TOOLS:
            before = copy.deepcopy(mock_identity[authority["tools"][name]["selectedPath"]])
            mock_identity[authority["tools"][name]["selectedPath"]]["sha256"] = "0" * 64
            refuse(lambda: module.recheck_roster(authority, roster))
            post, failures = module.postcompile_observations(authority, roster)
            assert len(post) == 5 and [item["role"] for item in failures] == [name]
            assert post[name]["observed"]["sha256"] == "0" * 64
            assert post[name]["matched"] is False
            assert str(module.compile_or_post_failure(good, failures)) == \
                "postcompile-tool-" + name + "-refusal"
            for refused in ({"exitCode": 7}, {"stderr": b"diagnostic"},
                            {"timedOut": True}, {"outputBound": True}):
                reason = str(module.compile_or_post_failure({**good, **refused}, failures))
                assert reason.startswith("compiler-") and name not in reason
            mock_identity[authority["tools"][name]["selectedPath"]] = before
        attempted = []
        def refuse_first_post(value, *_args):
            attempted.append(str(value))
            if str(value) == authority["tools"]["g++"]["selectedPath"]:
                raise ValueError("post pin refused")
            return fake_pin(value)
        module.pinned_target = refuse_first_post
        post, failures = module.postcompile_observations(authority, roster)
        assert len(attempted) == 5 and list(post) == list(module.TOOLS)
        assert [item["role"] for item in failures] == ["g++"]
        assert post["g++"]["observed"] is None and post["ld"]["matched"]
        module.pinned_target = fake_pin
        report_failure = {"firstFailure": None, "secondaryFailures": []}
        compile_failure = module.compile_or_post_failure({**good, "timedOut": True}, failures)
        module.latch_failure(report_failure, compile_failure, "compile-returned")
        module.latch_failure(report_failure, ValueError("post pin refused"),
                             "compile-and-posttools-retained")
        assert report_failure["firstFailure"]["reason"] == "compiler-timeout"
        assert len(report_failure["secondaryFailures"]) == 1
        module.latch_failure(report_failure, compile_failure, "later-duplicate")
        assert len(report_failure["secondaryFailures"]) == 1
        module.run_bounded = lambda *_args: {**good, "stdout": b"/other/tool\n"}
        refuse(lambda: module.identity_roster(authority, root, env, lambda *_: None))
        module.run_bounded = fake_run
        module.shutil.which = lambda *_args, **_kwargs: "/other/g++"
        refuse(lambda: module.identity_roster(authority, root, env, lambda *_: None))
    finally:
        module.pinned_target = original_pin
        module.run_bounded = original_run
        module.shutil.which = original_which

    report = root / "first-build.json"
    module.write_receipt(report, {"status": "INCOMPLETE_UNQUALIFIED"})
    assert json.loads(report.read_text())["status"] == "INCOMPLETE_UNQUALIFIED"
    refuse(lambda: module.write_receipt(report, {"padding": "x" * module.MAX_REPORT}))
    assert json.loads(report.read_text())["status"] == "INCOMPLETE_UNQUALIFIED"

print("direct V8 first-build CPU-free controls PASS")
