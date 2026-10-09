#!/usr/bin/env python3
"""CPU-free tool-probe census controls; no compiler or archive is executed."""
import copy
import importlib.util
import os
from pathlib import Path
import tempfile

path = Path(__file__).with_name("run.py")
spec = importlib.util.spec_from_file_location("direct_v8_tool_census", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def result(raw=b"version\n", *, code=0, stderr=b"", timeout=False,
           output_bound=False, complete=True):
    return {"stdout": raw, "stderr": stderr, "exitCode": code,
            "timedOut": timeout, "outputBound": output_bound,
            "complete": complete}


def exercise(name, version_result, *, mutate=False):
    originals = module.run_bounded, module.pinned_file
    compiler = "/owned/g++"
    target = compiler if name == "g++" else "/owned/" + name
    identities = {value: {"realpath": value, "bytes": 17,
                          "sha256": "a" * 64, "device": 1, "inode": 2}
                  for value in (compiler, target)}
    reads = []
    calls = []
    published = []

    def fake_pin(value, _limit=module.MAX_TOOL):
        reads.append(value)
        identity = copy.deepcopy(identities[value])
        if mutate and value == target and calls and len(reads) >= 4:
            identity["sha256"] = "b" * 64
        return identity

    def fake_run(argv, _cwd, _timeout):
        calls.append(tuple(argv))
        if argv[1].startswith("-print-prog-name="):
            return result((target + "\n").encode())
        assert argv == [target, "--version"]
        return version_result

    def publish(_name, record):
        published.append(copy.deepcopy(record))

    try:
        module.pinned_file = fake_pin
        module.run_bounded = fake_run
        try:
            record = module.resolved_tool(name, compiler, identities[compiler],
                                          Path("/unused"), publish)
        except Exception as error:
            return None, error, published, reads, calls
        return record, None, published, reads, calls
    finally:
        module.run_bounded, module.pinned_file = originals


record, error, published, reads, calls = exercise("cc1plus", result(b""))
assert error is None and record["versionStatus"] == "VERSION_UNAVAILABLE_EMPTY"
assert record["versionProbe"]["stdout"]["bytes"] == 0
assert record["identity"] == record["postProbeIdentity"]
assert len(calls) == 2 and calls[0][1] == "-print-prog-name=cc1plus"
assert published[0]["identity"] and published[0]["locator"]
assert published[0]["versionStatus"] == "PENDING_UNQUALIFIED"
assert published[-1]["versionStatus"] == "VERSION_UNAVAILABLE_EMPTY"
assert reads[-2:] == ["/owned/cc1plus", "/owned/g++"]

for name in ("g++", "collect2", "as", "ld"):
    record, error, published, reads, calls = exercise(name, result(b""))
    assert record is None and isinstance(error, module.ProbeFailure)
    assert published[0]["identity"] and published[-1]["postProbeIdentity"]
    assert published[-1]["versionStatus"] == "REFUSED_UNQUALIFIED"

for refused in (result(b"", code=1), result(b"", stderr=b"warning"),
                result(b"", timeout=True), result(b"", output_bound=True),
                result(b"", complete=False), result(b"x" * 4097)):
    record, error, published, reads, calls = exercise("cc1plus", refused)
    assert record is None and isinstance(error, module.ProbeFailure)
    assert published[0]["identity"] and published[-1]["postProbeIdentity"]
    assert published[-1]["versionStatus"] == "REFUSED_UNQUALIFIED"
    assert error.receipt["stdout"]["bytes"] == len(refused["stdout"])

record, error, published, reads, calls = exercise("cc1plus", result(b""),
                                                   mutate=True)
assert record is None and isinstance(error, ValueError)
assert published[0]["identity"] and published[-1]["postProbeError"]
assert published[-1]["postProbeIdentity"] is None

record, error, published, reads, calls = exercise("cc1plus", result(b"v\n"))
assert error is None and record["versionStatus"] == "VERSION_OBSERVED"
assert record["versionProbe"]["stdoutText"] == "v\n"

with tempfile.TemporaryDirectory(prefix="direct-v8-tool-census-read-") as temp:
    target = Path(temp) / "receipt"
    original_open = module.os.open
    for reader in (lambda: module.read_bounded(target, 100),
                   lambda: module.pinned_file(target, 100)):
        target.write_bytes(b"ordinary")
        swapped = False
        def swap_to_fifo(path, flags, *args, **kwargs):
            global swapped
            if Path(path) == target and not swapped:
                swapped = True
                assert flags & os.O_NONBLOCK
                target.unlink()
                os.mkfifo(target)
            return original_open(path, flags, *args, **kwargs)
        module.os.open = swap_to_fifo
        try:
            try: reader()
            except ValueError: pass
            else: raise AssertionError("raced FIFO admitted")
            assert swapped
        finally:
            module.os.open = original_open
            target.unlink()

print("direct V8 tool census probe controls PASS")
