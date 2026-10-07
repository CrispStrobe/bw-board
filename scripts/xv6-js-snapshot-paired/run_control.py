"""Bounded source-identity and paired-arm adversaries, without a guest."""

import importlib.util
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from run import CPU_PATH, CPU_ROLE, validate_changed_paths, validate_inventory_delta


def rejected(call) -> None:
    try:
        call()
    except ValueError:
        return
    raise AssertionError("invalid source binding was accepted")


validate_changed_paths({CPU_PATH, "scripts/xv6-js-snapshot-paired/run.py"})
rejected(lambda: validate_changed_paths({"scripts/xv6-js-snapshot-paired/run.py"}))
rejected(lambda: validate_changed_paths({CPU_PATH, "src/experimental/i80386-at-machine.js"}))
rejected(lambda: validate_changed_paths({CPU_PATH, "scripts/probe-xv6-stock.mjs"}))
prior = {CPU_ROLE: "a" * 64, "./probe-xv6-stock.mjs": "b" * 64}
candidate = {CPU_ROLE: "c" * 64, "./probe-xv6-stock.mjs": "b" * 64}
validate_inventory_delta(prior, candidate)
rejected(lambda: validate_inventory_delta(prior, prior))
rejected(lambda: validate_inventory_delta(prior, {**candidate, "./probe-xv6-stock.mjs": "d" * 64}))
rejected(lambda: validate_inventory_delta(prior, {CPU_ROLE: "c" * 64}))
qualified = Path(__file__).resolve().parents[1] / "xv6-js-acceptance" / "run.py"
sys.path.insert(0, str(qualified.parent))
spec = importlib.util.spec_from_file_location("qualified_xv6_run_control", qualified)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert callable(module.validate_report) and callable(module.sha256_json)
with tempfile.TemporaryDirectory() as directory:
    source = Path(__file__).resolve().parents[2]
    output = Path(directory) / "admission-failure"
    process = subprocess.run([sys.executable, str(Path(__file__).with_name("run.py")),
                              "--before", str(source), "--after", str(source),
                              "--head", "0" * 40, "--image-dir", str(source),
                              "--output", str(output)], capture_output=True, text=True)
    assert process.returncode != 0
    failure = (output / "failure.json").read_bytes()
    inventory = json.loads((output / "file-inventory.json").read_text())
    assert json.loads(failure)["completedPairs"] == 0
    assert inventory["files"]["failure.json"] == {
        "bytes": len(failure), "sha256": hashlib.sha256(failure).hexdigest()}
print("snapshot paired source controls PASS")
