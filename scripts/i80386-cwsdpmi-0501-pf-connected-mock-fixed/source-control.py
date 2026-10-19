#!/usr/bin/env python3
"""CPU-free source admission controls for the PF mock-corrected profile."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

SOURCE = Path(__file__).with_name('source.py')
spec = importlib.util.spec_from_file_location('pf_mock_fixed_source', SOURCE)
source = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source)


def refuse(call):
    try:
        call()
    except (ValueError, OSError, UnicodeError):
        return
    raise AssertionError('unreviewed source was admitted')


def main():
    baseline = source.baseline_receipt()
    assert len(baseline['roles']) == 238
    assert len(baseline['recursiveImports']) == 71
    assert set(baseline['roles']) == source.BASELINE_ROLES
    assert len(source.NEW_ROLES) == 4
    assert source.MOCK_WORKFLOW not in source.BASELINE_ROLES
    assert set(source.CORRECTED) == {source.MOCK_CONTROL, source.MOCK_WORKFLOW}
    for role, digest in source.CORRECTED.items():
        assert source.sha(source.blob(source.FIXED_BASE, role)) == digest
    changed = set(source.git('diff', '--name-only', source.HELD_BASE, source.FIXED_BASE)
                  .decode().splitlines())
    assert changed == set(source.CORRECTED)
    assert source.git('merge-base', '--is-ancestor', source.HELD_BASE, source.FIXED_BASE) == b''
    # The old graph is a closed, pinned static graph, not a claim that all
    # runtime dependencies have been discovered by this small parser.
    names = {'unit/entry.mjs', 'unit/dep.mjs'}
    assert source.imported('unit/entry.mjs', b"import {x} from './dep.mjs';\n", names) == {'unit/dep.mjs'}
    refuse(lambda: source.imported('unit/entry.mjs', b"import('./dep.mjs')", names))
    refuse(lambda: source.imported('unit/entry.mjs', b"import {x} from './missing.mjs';", names))
    refuse(lambda: source.imported('unit/entry.mjs', b"import {x} from 'foreign';", names))
    with tempfile.TemporaryDirectory() as directory:
        parent = Path(directory)
        ordinary = parent / 'ordinary'
        ordinary.write_bytes(b'bounded')
        assert source.live_role(str(ordinary)) == b'bounded'
        link = parent / 'link'
        link.symlink_to(ordinary)
        refuse(lambda: source.live_role(str(link)))
        fifo = parent / 'fifo'
        os.mkfifo(fifo)
        refuse(lambda: source.live_role(str(fifo)))
        refuse(lambda: source.live_role(str(ordinary), maximum=2))
        empty = parent / 'empty'
        empty.write_bytes(b'')
        refuse(lambda: source.live_role(str(empty)))
    print('PF mock-corrected source controls PASS')


if __name__ == '__main__':
    main()
