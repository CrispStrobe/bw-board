#!/usr/bin/env python3
"""Bounded source-admission adversaries; no archive, compiler or guest execution."""

import hashlib
from pathlib import Path
from unittest.mock import patch

import source


ACQUIRE = "scripts/i80386-cwsdpmi-owned/acquire.py"


def refuses(action, expected):
    try:
        action()
    except ValueError as error:
        assert expected in str(error), (expected, str(error))
    else:
        raise AssertionError("source admission accepted " + expected)


def main():
    source.admit_diff({source.NEW + "client.c", source.WORKFLOW})
    refuses(lambda: source.admit_diff({"src/experimental/i80386.js"}),
            "outside owned gate")

    names = {"scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs"}
    raw = (b"// import './comment.mjs';\n"
           b"import {one,\n two}\nfrom './b.mjs';\n"
           b"export {three} from './c.mjs';\n")
    assert source.imported("scripts/a.mjs", raw, names) == {
        "scripts/b.mjs", "scripts/c.mjs"}
    refuses(lambda: source.imported("scripts/a.mjs", b"import x from 'unbound';", names),
            "unbound external")
    refuses(lambda: source.imported("scripts/a.mjs", b"import('./b.mjs')", names),
            "dynamic JS import")
    refuses(lambda: source.imported("scripts/a.mjs", b"import x from './missing.mjs';", names),
            "missing relative JS role")
    graph = source.graph({"scripts/a.mjs"}, names,
                         lambda role: raw if role == "scripts/a.mjs" else b"export const x=1;")
    assert graph["scripts/a.mjs"] == ["scripts/b.mjs", "scripts/c.mjs"]
    assert set(graph) == names

    head = source.git("rev-parse", "HEAD").decode().strip()
    receipt = source.identity(head)
    assert receipt["roles"][ACQUIRE] == hashlib.sha256(Path(ACQUIRE).read_bytes()).hexdigest()
    original = Path.read_bytes

    def altered(path):
        raw_bytes = original(path)
        return raw_bytes + b"\n# changed archive admission\n" if str(path) == ACQUIRE else raw_bytes

    with patch.object(Path, "read_bytes", altered):
        refuses(lambda: source.identity(head), "role differs from Git")
    print("high-memory/timer source closure controls PASS")


if __name__ == "__main__":
    main()
