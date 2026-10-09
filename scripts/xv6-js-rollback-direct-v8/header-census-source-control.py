#!/usr/bin/env python3
"""CPU-free exact 14-held/six-new source-roster adversaries."""
import importlib.util
from pathlib import Path

path = Path(__file__).with_name("header-census-source.py")
spec = importlib.util.spec_from_file_location("direct_v8_header_source", path)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)
assert source.BASE == "869c3c72cb40b66c135621f297eb66638166b69d"
assert len(source.HELD) == 14 and len(source.NEW) == 6
source.validate_changed(sorted(source.NEW))
for changed in (source.NEW - {next(iter(source.NEW))},
                source.NEW | {"src/experimental/i80386.js"},
                source.NEW | {"scripts/xv6-js-rollback-direct-v8/addon.node"},
                list(source.NEW) + [next(iter(source.NEW))]):
    try: source.validate_changed(changed)
    except ValueError: pass
    else: raise AssertionError("unreviewed census source role admitted")
print("data-only header census source roster controls PASS")
