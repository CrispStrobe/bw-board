#!/usr/bin/env python3
"""Bounded admission checks for the compiler adapter; never invoke a compiler."""

import hashlib
import importlib.util
from pathlib import Path
from unittest.mock import patch


ADAPTER = Path("scripts/i80386-cwsdpmi-highmem-timer/compile-adapter.py")
spec = importlib.util.spec_from_file_location("highmem_compile_adapter", ADAPTER)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def refuses(action, pattern):
    try:
        action()
    except ValueError as error:
        assert pattern in str(error), (pattern, str(error))
    else:
        raise AssertionError("compiler adapter accepted " + pattern)


def main():
    original = adapter.original_bytes()
    assert hashlib.sha256(original).hexdigest() == adapter.sha(original)
    assert adapter.CLIENT != adapter.OLD_CLIENT
    refuses(lambda: adapter.run(("tool", "djcrx", "djdev", "djlsr",
                                 str(adapter.OLD_CLIENT), "report", "work")),
            "exact client invocation")
    # The actual gate compares the helper bytes with Git before importing it.
    helper = adapter.ORIGINAL
    real = Path.read_bytes

    def altered(path):
        raw = real(path)
        return raw + b"\n# changed\n" if str(path) == str(helper) else raw

    with patch.object(Path, "read_bytes", altered):
        refuses(lambda: adapter.original_bytes(), "inherited compiler helper changed")
    print("high-memory/timer compile adapter admission controls PASS")


if __name__ == "__main__":
    main()
