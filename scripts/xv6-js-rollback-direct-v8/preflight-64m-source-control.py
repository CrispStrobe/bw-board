#!/usr/bin/env python3
"""CPU-free exact source-delta refusal controls for the 64 MiB profile."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("preflight-64m-source.py")
spec = importlib.util.spec_from_file_location("direct_v8_preflight_64m_source", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

assert module.BASE == "90c4de590325f59c8d164cefc37fa036740f189a"
assert len(module.HELD) == 18 and len(module.CHANGED) == 2 and len(module.NEW) == 6
assert len(module.HELD | module.CHANGED | module.NEW) == 26
accepted = sorted(module.CHANGED | module.NEW)
module.validate_changed(accepted)
for changed in (module.NEW,
                module.CHANGED,
                module.CHANGED | module.NEW | {"src/experimental/i80386.js"},
                module.CHANGED | module.NEW | {"scripts/xv6-js-rollback-direct-v8/addon.node"},
                accepted + [accepted[0]]):
    try: module.validate_changed(changed)
    except ValueError: pass
    else: raise AssertionError("unreviewed 64 MiB source role accepted")
print("direct V8 64 MiB source roster controls PASS")
