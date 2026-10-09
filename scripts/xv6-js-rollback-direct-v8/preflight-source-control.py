#!/usr/bin/env python3
"""CPU-free exact source roster adversaries for the preflight checkpoint."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("preflight-source.py")
spec = importlib.util.spec_from_file_location("direct_v8_preflight_source", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

module.validate_changed(sorted(module.NEW))
for changed in (module.NEW - {next(iter(module.NEW))},
                module.NEW | {"src/experimental/i80386.js"},
                module.NEW | {"scripts/xv6-js-rollback-direct-v8/extra.node"},
                list(module.NEW) + [next(iter(module.NEW))]):
    try:
        module.validate_changed(changed)
    except ValueError:
        pass
    else:
        raise AssertionError("unreviewed source role accepted")
assert module.BASE == "ff2b916e1899d6042f9b1a3e2701ea1ec4f708d7"
assert len(module.INHERITED) == 8 and len(module.NEW) == 6
print("direct V8 preflight source roster controls PASS")
