#!/usr/bin/env python3
"""CPU-free full-roster and split-output controls; no tool is executed."""
import copy
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("run.py")
spec = importlib.util.spec_from_file_location("direct_v8_tool_roster", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

COMPILER = "/owned/g++"
LD_STDOUT = b"GNU ld 2.42\nCopyright (C) source-owned synthetic\n"


def result(raw=b"version\n", *, code=0, stderr=b"", timeout=False,
           cap=False, complete=True):
    return {"stdout": raw, "stderr": stderr, "exitCode": code,
            "timedOut": timeout, "outputBound": cap, "complete": complete}


def simulate(*, versions=None, locators=None, target_refusal=None,
             changed_after_collect2=None):
    versions = versions or {}
    locators = locators or {}
    original_pin, original_run = module.pinned_file, module.run_bounded
    identities = {"/owned/" + name: {"realpath": "/owned/" + name,
                  "bytes": 17, "sha256": (name.encode().hex() + "0" * 64)[:64],
                  "device": 1, "inode": index + 2}
                  for index, name in enumerate(module.TOOLS)}
    calls, published, roster = [], [], {}

    def fake_pin(value, _limit=module.MAX_TOOL):
        name = Path(value).name
        if name == target_refusal and ("locator", name) in calls:
            raise ValueError("target pin refused")
        identity = copy.deepcopy(identities[value])
        if name == changed_after_collect2 and ("version", "collect2") in calls:
            identity["sha256"] = "f" * 64
        return identity

    def fake_run(argv, _cwd, _timeout):
        if argv[1].startswith("-print-prog-name="):
            name = argv[1].split("=", 1)[1]
            calls.append(("locator", name))
            return locators.get(name, result(("/owned/" + name + "\n").encode()))
        name = Path(argv[0]).name
        assert argv == ["/owned/" + name, "--version"]
        calls.append(("version", name))
        default = (result(b"") if name == "cc1plus" else
                   result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                          b"/owned/ld --version\n") if name == "collect2" else
                   result(LD_STDOUT) if name == "ld" else result())
        return versions.get(name, default)

    def publish(name, row):
        roster[name] = row
        published.append((name, copy.deepcopy(row),
                          any(kind == "version" for kind, _ in calls)))

    try:
        module.pinned_file = fake_pin
        module.run_bounded = fake_run
        try:
            for name in module.TOOLS:
                module.locate_tool(name, COMPILER, identities[COMPILER],
                                   Path("/unused"), publish)
            module.recheck_tools(roster)
            for name in module.TOOLS:
                module.version_tool(name, roster[name], COMPILER,
                                    identities[COMPILER], Path("/unused"),
                                    publish, roster,
                                    roster["ld"] if name == "collect2" else None)
            module.recheck_tools(roster)
            module.complete_profile(roster, publish)
        except Exception as error:
            return error, roster, published, calls
        return None, roster, published, calls
    finally:
        module.pinned_file, module.run_bounded = original_pin, original_run


error, roster, published, calls = simulate()
assert error is None and set(roster) == set(module.TOOLS)
assert all(row["identity"] and row["postProbeIdentity"] == row["identity"]
           for row in roster.values())
assert roster["cc1plus"]["versionStatus"] == "VERSION_UNAVAILABLE_EMPTY"
assert roster["collect2"]["versionStatus"] == "SPLIT_OUTPUT_DELEGATION_UNVERIFIED"
assert roster["collect2"]["delegation"]["stdoutEqualsDirectLd"] is True
assert calls[:4] == [("locator", name) for name in module.TOOLS[1:]]
assert calls[4:] == [("version", name) for name in module.TOOLS]
assert all(row["versionStatus"] == "PENDING_UNQUALIFIED"
           for _, row, version_started in published if not version_started)
# The first version call follows the complete identity roster.
first_version = calls.index(("version", "g++"))
assert first_version == 4 and all(name in roster for name in module.TOOLS)

# A missing or refused fifth locator leaves earlier identities, but no version call.
for bad in (result(b"", code=7), result(b"", timeout=True),
            result(b"", cap=True), result(b"", stderr=b"error")):
    error, roster, published, calls = simulate(locators={"ld": bad})
    assert isinstance(error, module.ProbeFailure)
    assert set(roster) == set(module.TOOLS) and not any(k == "version" for k, _ in calls)
    assert roster["ld"]["locatorStatus"] == "REFUSED_UNQUALIFIED"
    assert roster["ld"]["locator"]["exitCode"] == bad["exitCode"]
error, roster, published, calls = simulate(target_refusal="ld")
assert isinstance(error, ValueError) and not any(k == "version" for k, _ in calls)
assert roster["ld"]["selectedPath"] == "/owned/ld" and roster["ld"]["identity"] is None

# Only exact cc1plus silence and narrowly bound collect2 split output qualify.
for bad in (result(b"", code=7), result(b"", stderr=b"noise"),
            result(b"", timeout=True), result(b"", cap=True),
            result(b"", complete=False), result(b"x" * 4097)):
    error, roster, published, calls = simulate(versions={"cc1plus": bad})
    assert isinstance(error, module.ProbeFailure)
    assert roster["cc1plus"]["versionStatus"] == "REFUSED_UNQUALIFIED"
    assert set(roster) == set(module.TOOLS)
for bad in (result(LD_STDOUT, stderr=b"noise"),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\nextra\n"),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\nnoise"),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/different/ld --version\n"),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\n\xff"),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\n", code=1),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\n", timeout=True),
            result(LD_STDOUT, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\n", complete=False),
            result(b"x" * 4097, stderr=module.COLLECT2_BANNER +
                   b"/owned/ld --version\n")):
    error, roster, published, calls = simulate(versions={"collect2": bad})
    assert isinstance(error, module.ProbeFailure)
    assert roster["collect2"]["versionStatus"] == "REFUSED_UNQUALIFIED"
    assert roster["collect2"]["versionProbe"]["stderr"]["bytes"] == len(bad["stderr"])

error, roster, published, calls = simulate(versions={"ld": result(b"GNU ld other\n")})
assert isinstance(error, ValueError)
assert roster["collect2"]["delegation"]["stdoutEqualsDirectLd"] is False
error, roster, published, calls = simulate(changed_after_collect2="ld")
assert isinstance(error, ValueError)
assert roster["collect2"]["delegation"]["ldBefore"]
assert roster["collect2"]["delegation"]["ldAfter"]
assert roster["collect2"]["postProbeError"]

# The first refused probe remains the first failure even if a post-probe
# identity check also fails. A different complete cc1plus output is no longer
# the separately named unavailable-version observation.
error, roster, published, calls = simulate(
    versions={"collect2": result(b"bad", stderr=b"noise")},
    changed_after_collect2="collect2")
assert isinstance(error, module.ProbeFailure)
assert roster["collect2"]["postProbeError"]
error, roster, published, calls = simulate(versions={"cc1plus": result(b"version\n")})
assert isinstance(error, ValueError)
assert roster["cc1plus"]["versionStatus"] == "VERSION_OBSERVED"

# A complete record must rehash all five selected targets; missing roles and
# same-path changed bytes are refused for every role, including the compiler.
original_pin = module.pinned_file
try:
    module.pinned_file = lambda path, *_: copy.deepcopy(
        roster[Path(path).name]["identity"])
    module.recheck_tools(roster)
    for name in module.TOOLS:
        partial = {key: value for key, value in roster.items() if key != name}
        try: module.recheck_tools(partial)
        except ValueError: pass
        else: raise AssertionError("missing final tool role admitted")
        def changed(path, *_args, _name=name):
            result_identity = copy.deepcopy(roster[Path(path).name]["identity"])
            if Path(path).name == _name:
                result_identity["sha256"] = "f" * 64
            return result_identity
        module.pinned_file = changed
        try: module.recheck_tools(roster)
        except ValueError: pass
        else: raise AssertionError("changed final tool role admitted")
        module.pinned_file = lambda path, *_: copy.deepcopy(
            roster[Path(path).name]["identity"])
finally:
    module.pinned_file = original_pin

# A direct version attempt before the complete roster is refused without a child call.
original_run = module.run_bounded
module.run_bounded = lambda *_args: (_ for _ in ()).throw(
    AssertionError("version child must not run"))
try:
    try: module.version_tool("g++", {"identity": {"realpath": COMPILER},
                                 "versionStatus": "PENDING_UNQUALIFIED"},
                             COMPILER, {}, Path("/unused"), lambda *_: None,
                             {"g++": {"identity": {"realpath": COMPILER}}})
    except ValueError: pass
    else: raise AssertionError("partial roster admitted")
finally:
    module.run_bounded = original_run

print("direct V8 full tool roster controls PASS")
