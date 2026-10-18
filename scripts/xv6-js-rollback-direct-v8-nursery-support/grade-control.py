#!/usr/bin/env python3
"""CPU-free raw-profile, result and lifetime refusal controls."""
import copy
import importlib.util
import json
from pathlib import Path

path = Path(__file__).with_name("grade.py")
spec = importlib.util.spec_from_file_location("direct_v8_support_grade", path)
grade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grade)


def encoded(value):
    return json.dumps(value, separators=(",", ":")).encode()


def fixture(kind):
    minor = kind.startswith("minor-")
    enabled = kind.endswith("enabled")
    pre = {"nodes": [
        {"id": 0, "parent": 0, "depth": 0, "name": "root", "script": "", "line": -1},
        {"id": 2, "parent": 0, "depth": 1, "name": "allocateTarget",
         "script": "file:///repo/scripts/xv6-js-rollback-direct-v8-target-site-nursery/case.mjs",
         "line": 17}],
        "samples": [{"id": "1", "node": 2, "size": 100, "count": 1}]}
    post = copy.deepcopy(pre)
    if not enabled:
        post["samples"] = []
    facts = {"gc": [{"type": 1 if minor else 4, "flags": 0, "ended": True}],
             "weak": [0] * 64, "overflow": False, "poison": False,
             "closed": True}
    result = {"schema": "bw.direct-v8.nursery-admission-case.v1", "kind": kind,
              "runtime": {"node": "v20.20.2", "v8": grade.PINNED_V8,
                          "execArgv": ["--expose-gc"]},
              "firstFailure": None, "beforeRelease": {"gcCount": 0},
              "afterRelease": {"gcCount": 0}, "finalFacts": facts,
              "grade": {"kind": kind, "preCount": 1,
                        "postCount": 1 if enabled else 0,
                        "designated": 0, "callbacks": 64},
              "secondaryFailures": [],
              "premise": {"fullGCCompleted": True, "afterBegin": 0, "afterSnapshot": 0},
              "admissionStatus": {"phase": "admitted", "fullGCCompleted": True, "afterBegin": 0}}
    return {"kind": kind, "files": {"pre.json": encoded(pre),
            "post.json": encoded(post), "facts.json": encoded(facts),
            "result.json": encoded(result)}}


def refuse(case, role, change):
    bad = copy.deepcopy(case)
    value = json.loads(bad["files"][role])
    change(value)
    bad["files"][role] = encoded(value)
    try:
        grade.grade_case(bad["kind"], bad["files"])
    except ValueError:
        return
    raise AssertionError("forged support case admitted")


cases = [fixture(kind) for kind in grade.ORDER]
assert grade.grade_four(cases)["supported"] is True
for case in cases:
    assert grade.grade_case(case["kind"], case["files"])["grade"]["callbacks"] == 64
refuse(cases[0], "pre.json", lambda x: x["samples"].append(x["samples"][0]))
refuse(cases[0], "pre.json", lambda x: x["samples"][0].update(id="18446744073709551616"))
refuse(cases[0], "pre.json", lambda x: x["nodes"][1].update(script="forged.mjs"))
refuse(cases[0], "pre.json", lambda x: x["nodes"][1].update(parent=19))
refuse(cases[0], "post.json", lambda x: x["samples"].append(
    {"id": "2", "node": 2, "size": 100, "count": 1}))
refuse(cases[1], "post.json", lambda x: x["samples"].append(
    {"id": "2", "node": 2, "size": 100, "count": 1}))
refuse(cases[0], "facts.json", lambda x: x["gc"][0].update(type=4))
refuse(cases[0], "facts.json", lambda x: x["gc"].insert(0, {"type": 4, "flags": 0,
                                                                "ended": True}))
refuse(cases[1], "facts.json", lambda x: x["weak"].__setitem__(17, -1))
refuse(cases[2], "facts.json", lambda x: x["gc"].append({"type": 1, "flags": 0,
                                                           "ended": True}))
refuse(cases[2], "result.json", lambda x: x["runtime"].update(execArgv=[]))
refuse(cases[2], "result.json", lambda x: x["runtime"].update(v8="forged"))
refuse(cases[0], "result.json", lambda x: x.update(firstFailure="native refusal"))
refuse(cases[0], "result.json", lambda x: x["grade"].update(callbacks=63))
try:
    grade.grade_four(cases[:3] + [cases[0]])
except ValueError:
    pass
else:
    raise AssertionError("duplicate/missing case admitted")
bad = copy.deepcopy(cases[0])
bad["files"]["pre.json"] = b'{"nodes":[],"nodes":[],"samples":[]}'
try:
    grade.grade_case(bad["kind"], bad["files"])
except ValueError:
    pass
else:
    raise AssertionError("duplicate JSON key admitted")


for kind in grade.ORDER:
    case = fixture(kind)
    for field in ("afterBegin", "afterSnapshot"):
        for value in (-1, 1, 2, None, "0", False):
            refuse(case, "result.json", lambda x, f=field, v=value: x["premise"].update({f: v}))
    for field in ("beforeRelease", "afterRelease"):
        refuse(case, "result.json", lambda x, f=field: x[f].update(gcCount=1))
    refuse(case, "result.json", lambda x: x["premise"].update(extra=0))
    refuse(case, "result.json", lambda x: x["premise"].update(fullGCCompleted=False))
    refuse(case, "result.json", lambda x: x["admissionStatus"].update(phase="begin"))
    refuse(case, "result.json", lambda x: x["admissionStatus"].update(extra=0))
    refuse(case, "result.json", lambda x: x["admissionStatus"].update(afterBegin=False))
    refuse(case, "result.json", lambda x: x["runtime"].update(node="v22.23.3"))
    refuse(case, "result.json", lambda x: x["runtime"].update(execArgv=["--expose-gc", "--trace-gc"]))
    refuse(case, "pre.json", lambda x: x["nodes"][1].update(line=16))
    refuse(case, "pre.json", lambda x: x["nodes"][1].update(script="file:///repo/scripts/xv6-js-rollback-direct-v8-target-site/case.mjs"))
for order in (list(reversed(cases)), cases[:3]):
    try: grade.grade_four(order)
    except ValueError: pass
    else: raise AssertionError("wrong finite case order admitted")
print("direct V8 nursery-support raw grade controls PASS")
