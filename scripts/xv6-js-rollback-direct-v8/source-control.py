#!/usr/bin/env python3
"""CPU-free adversaries for the closed source-only first-slice roster."""
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
print("direct V8 source roster controls PASS")
