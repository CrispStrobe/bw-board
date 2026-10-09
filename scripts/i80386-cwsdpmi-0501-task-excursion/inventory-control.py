#!/usr/bin/env python3
"""Pure report allowlist and notice controls; no guest or binary input."""
import importlib.util
import tempfile
from pathlib import Path

spec=importlib.util.spec_from_file_location('task_inventory',Path(__file__).with_name('inventory.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert 'task-excursion.json' in module.ALLOWED
assert 'progress.json.pending.json' in module.ALLOWED
assert 'package/COPYING.CWS' in module.ALLOWED
assert not module.role_allowed('memory.bin')
assert not module.role_allowed('task-state-segment.jsonl')
assert not module.role_allowed('unexpected.json')
with tempfile.TemporaryDirectory(prefix='task-inventory-') as root_name:
    root=Path(root_name)
    (root/'task-excursion.json').write_text('{"passed":false}\n')
    result=module.inventory(root)
    assert result['files']['task-excursion.json']['bytes']>0
with tempfile.TemporaryDirectory(prefix='task-inventory-negative-') as root_name:
    root=Path(root_name)
    (root/'raw.exe').write_bytes(b'MZ')
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError('binary role admitted')
with tempfile.TemporaryDirectory(prefix='task-inventory-notice-') as root_name:
    root=Path(root_name)
    (root/'package').mkdir()
    (root/'package'/'input.json').write_text('{}\n')
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError('package without notice admitted')
print('task excursion inventory controls PASS')
