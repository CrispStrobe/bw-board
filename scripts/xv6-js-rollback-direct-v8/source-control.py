#!/usr/bin/env python3
"""CPU-free adversaries for the closed source-only first-slice roster."""
import sys
import tempfile
from build import MAX_OUTPUT, run_bounded
from source import HEADER_SHA, PREFIX, ROLES, validate_roles

assert HEADER_SHA == "46573741c48c20c6bcfc71450e2fc56b4d1156d72c3d6cc9917fa8b1cbc6e836"
validate_roles(sorted(ROLES))
for changed in (ROLES - {PREFIX + "addon.cc"},
                ROLES | {"src/experimental/i80386.js"},
                ROLES | {PREFIX + "addon.node"},
                list(ROLES) + [next(iter(ROLES))]):
    try:
        validate_roles(changed)
    except ValueError:
        pass
    else:
        raise AssertionError("unreviewed role accepted")
with tempfile.TemporaryDirectory(prefix="direct-v8-pure-control-") as work:
    okay = run_bounded([sys.executable, "-c", "print('ok')"], work, 5)
    assert okay["exitCode"] == 0 and okay["stdout"] == b"ok\n"
    assert not okay["timedOut"] and not okay["outputBound"]
    failed = run_bounded([sys.executable, "-c",
                          "import sys;sys.stderr.write('bad\\n');sys.exit(7)"], work, 5)
    assert failed["exitCode"] == 7 and failed["stderr"] == b"bad\n"
    timed = run_bounded([sys.executable, "-c",
                         "import time;print('first',flush=True);time.sleep(3)"], work, 1)
    assert timed["timedOut"] and timed["stdout"] == b"first\n"
    noisy = run_bounded([sys.executable, "-c",
                         "import os;os.write(1,b'x'*40000)"], work, 5)
    assert noisy["outputBound"] and len(noisy["stdout"]) <= MAX_OUTPUT
print("direct V8 source roster controls PASS")
