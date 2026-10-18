#!/usr/bin/env python3
"""CPU-free raw admission of four target-site case reports."""
import hashlib
import json
import re

CASES = {
    "minor-baseline": (0, 1, False),
    "minor-enabled": (4, 1, True),
    "major-baseline": (0, 4, False),
    "major-enabled": (2, 4, True),
}
ORDER = tuple(CASES)
FACTORY = "/scripts/xv6-js-rollback-direct-v8-target-site/case.mjs"
PINNED_V8 = "11.3.244.8-node.38"
ID = re.compile(r"[1-9][0-9]{0,19}\Z")


def refuse(ok, reason):
    if not ok:
        raise ValueError(reason)


def unsigned(value, maximum=2**53 - 1):
    return type(value) is int and 0 <= value <= maximum


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def unique(pairs):
    out = {}
    for key, value in pairs:
        refuse(key not in out, "duplicate JSON key")
        out[key] = value
    return out


def strict(raw, maximum):
    refuse(type(raw) is bytes and 0 < len(raw) <= maximum, "bounded case JSON")
    return json.loads(raw.decode("utf-8", "strict"), object_pairs_hook=unique,
                      parse_float=lambda _: (_ for _ in ()).throw(
                          ValueError("floating-point case JSON")),
                      parse_constant=lambda _: (_ for _ in ()).throw(
                          ValueError("nonfinite case JSON")))


def profile(raw):
    data = strict(raw, 8 * 1024 * 1024)
    refuse(type(data) is dict and set(data) == {"nodes", "samples"} and
           type(data["nodes"]) is list and 1 <= len(data["nodes"]) <= 4096 and
           type(data["samples"]) is list and len(data["samples"]) <= 65536,
           "profile shape")
    nodes = {}
    roots = 0
    for node in data["nodes"]:
        refuse(type(node) is dict and set(node) == {
            "id", "parent", "depth", "name", "script", "line"} and
            unsigned(node["id"], 0xffffffff) and
            unsigned(node["parent"], 0xffffffff) and
            unsigned(node["depth"], 64) and
            type(node["name"]) is str and len(node["name"]) <= 256 and
            type(node["script"]) is str and len(node["script"]) <= 1024 and
            type(node["line"]) is int and -1 <= node["line"] <= 1_000_000 and
            node["id"] not in nodes, "profile node")
        nodes[node["id"]] = node
        if node["depth"] == 0:
            roots += 1
            refuse(node["parent"] == 0, "root parent")
    refuse(roots == 1, "profile root count")
    for node in nodes.values():
        if node["depth"]:
            parent = nodes.get(node["parent"])
            refuse(parent is not None and parent["depth"] + 1 == node["depth"],
                   "profile node ancestry")
    ids = set()
    selected = set()
    for sample in data["samples"]:
        refuse(type(sample) is dict and set(sample) == {
            "id", "node", "size", "count"} and
            type(sample["id"]) is str and ID.fullmatch(sample["id"]) and
            int(sample["id"]) <= 2**64 - 1 and sample["id"] not in ids and
            unsigned(sample["node"], 0xffffffff) and sample["node"] in nodes and
            unsigned(sample["size"]) and
            unsigned(sample["count"], 0xffffffff) and sample["count"] > 0,
            "profile sample")
        ids.add(sample["id"])
        node = nodes[sample["node"]]
        found = False
        while True:
            if (node["name"] == "allocateTarget" and
                    node["script"].endswith(FACTORY) and node["line"] == 16):
                found = True
            if node["depth"] == 0:
                break
            node = nodes[node["parent"]]
        if found:
            selected.add(sample["id"])
    return selected


def grade_case(kind, files):
    refuse(kind in CASES and type(files) is dict and set(files) == {
        "pre.json", "post.json", "facts.json", "result.json"}, "case roles")
    flag, gc_type, retained = CASES[kind]
    pre, post = profile(files["pre.json"]), profile(files["post.json"])
    facts = strict(files["facts.json"], 65536)
    result = strict(files["result.json"], 65536)
    refuse(type(facts) is dict and set(facts) == {
        "gc", "weak", "overflow", "poison", "closed"} and
        type(facts["gc"]) is list and len(facts["gc"]) <= 256 and
        type(facts["weak"]) is list and len(facts["weak"]) == 64 and
        facts["overflow"] is False and facts["poison"] is False and
        facts["closed"] is True, "native facts shape")
    refuse(type(result) is dict and set(result) == {
        "schema", "kind", "runtime", "firstFailure", "beforeRelease",
        "afterRelease", "finalFacts", "grade", "secondaryFailures"} and
        result["schema"] == "bw.direct-v8.support-case.v1" and
        result["kind"] == kind and result["firstFailure"] is None and
        result["secondaryFailures"] == [] and result["finalFacts"] == facts,
        "retained case result")
    runtime = result["runtime"]
    refuse(type(runtime) is dict and set(runtime) == {"node", "v8", "execArgv"} and
           runtime["node"] == "v20.20.2" and
           runtime["v8"] == PINNED_V8 and
           runtime["execArgv"] == (["--expose-gc"] if gc_type == 4 else []),
           "case runtime and flags")
    before, after = result["beforeRelease"], result["afterRelease"]
    refuse(type(before) is dict and set(before) == {"gcCount"} and
           type(after) is dict and set(after) == {"gcCount"} and
           unsigned(before["gcCount"], 256) and
           unsigned(after["gcCount"], 256) and
           before["gcCount"] == after["gcCount"] and
           after["gcCount"] < len(facts["gc"]) and bool(pre),
           "release cut and presamples")
    designated = after["gcCount"]
    for event in facts["gc"]:
        refuse(type(event) is dict and set(event) == {"type", "flags", "ended"} and
               unsigned(event["type"], 31) and
               unsigned(event["flags"], 127) and event["ended"] is True,
               "GC event")
    refuse(facts["gc"][designated]["type"] == gc_type and
           len(facts["gc"]) == designated + 1 and
           all(type(index) is int and index == designated for index in facts["weak"]),
           "designated GC and weak callbacks")
    if gc_type == 1:
        refuse(all((event["type"] & 4) == 0 for event in facts["gc"]),
               "major before minor witness")
    else:
        refuse(all((event["type"] & 1) == 0 for event in facts["gc"][designated:]),
               "minor in major release window")
    refuse(all((sample in post) == retained for sample in pre),
           "sample ID lifetime predicate")
    refuse(post == pre if retained else not post,
           "extra target-site sample ID")
    expected_grade = {"kind": kind, "preCount": len(pre), "postCount": len(post),
                      "designated": designated, "callbacks": 64}
    given_grade = result["grade"]
    refuse(type(given_grade) is dict and set(given_grade) == set(expected_grade) and
           type(given_grade["preCount"]) is int and
           type(given_grade["postCount"]) is int and
           type(given_grade["designated"]) is int and
           type(given_grade["callbacks"]) is int and
           given_grade == expected_grade, "case grade crosscheck")
    return {"kind": kind, "flag": flag, "grade": expected_grade,
            "raw": {name: {"bytes": len(raw), "sha256": digest(raw)}
                    for name, raw in sorted(files.items())}}


def grade_four(cases):
    refuse(type(cases) is list and [case["kind"] for case in cases] == list(ORDER),
           "four ordered distinct support cases")
    return {"supported": True, "cases": [grade_case(c["kind"], c["files"])
                                        for c in cases]}
