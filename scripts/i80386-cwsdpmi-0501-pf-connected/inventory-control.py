#!/usr/bin/env python3
"""Pure report allowlist and notice controls; no guest or binary input."""
import importlib.util
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('pf_inventory',Path(__file__).with_name('inventory.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert 'pf-connected.json' in module.ALLOWED
assert 'progress.json.pending.json' in module.ALLOWED
assert 'package/COPYING.CWS' in module.ALLOWED
assert not module.role_allowed('memory.bin')
assert not module.role_allowed('task-state-segment.jsonl')
assert not module.role_allowed('unexpected.json')
with tempfile.TemporaryDirectory(prefix='pf-inventory-') as root_name:
    root=Path(root_name)
    (root/'pf-connected.json').write_text('{"passed":false}\n')
    result=module.inventory(root)
    assert result['files']['pf-connected.json']['bytes']>0
with tempfile.TemporaryDirectory(prefix='pf-inventory-negative-') as root_name:
    root=Path(root_name)
    (root/'raw.exe').write_bytes(b'MZ')
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError('binary role admitted')
with tempfile.TemporaryDirectory(prefix='pf-inventory-notice-') as root_name:
    root=Path(root_name)
    (root/'package').mkdir()
    (root/'package'/'input.json').write_text('{}\n')
    try: module.inventory(root)
    except ValueError: pass
    else: raise AssertionError('package without notice admitted')
with tempfile.TemporaryDirectory(prefix='pf-inventory-race-') as root_name:
    root=Path(root_name)
    path=root/'pf-connected.json'
    path.write_bytes(b'{"passed":false}\n')
    replacement=root/'replacement'
    replacement.write_bytes(path.read_bytes())
    real_open=os.open
    def swap_before_open(name, flags, *args, **kwargs):
        path.unlink()
        replacement.rename(path)
        return real_open(name, flags, *args, **kwargs)
    with patch.object(module.os,'open',side_effect=swap_before_open):
        try: module.bounded(path,1024)
        except ValueError: pass
        else: raise AssertionError('same-byte artifact inode swap accepted')
    replacement2=root/'replacement2'
    replacement2.write_bytes(path.read_bytes())
    real_fstat=os.fstat
    calls=[0]
    def swap_after_read(fd):
        calls[0]+=1
        result=real_fstat(fd)
        if calls[0]==2:
            path.unlink()
            replacement2.rename(path)
        return result
    with patch.object(module.os,'fstat',side_effect=swap_after_read):
        try: module.bounded(path,1024)
        except ValueError: pass
        else: raise AssertionError('same-byte artifact post-read swap accepted')
    real_open=os.open
    def fifo_before_open(name, flags, *args, **kwargs):
        path.unlink()
        os.mkfifo(path)
        return real_open(name, flags, *args, **kwargs)
    with patch.object(module.os,'open',side_effect=fifo_before_open):
        try: module.bounded(path,1024)
        except ValueError: pass
        else: raise AssertionError('raced artifact FIFO accepted')
    path.unlink()
    path.write_bytes(b'{"passed":false}\n')
    target=root/'target'
    target.write_bytes(path.read_bytes())
    def symlink_before_open(name, flags, *args, **kwargs):
        path.unlink()
        path.symlink_to(target)
        return real_open(name, flags, *args, **kwargs)
    with patch.object(module.os,'open',side_effect=symlink_before_open):
        try: module.bounded(path,1024)
        except (ValueError,OSError): pass
        else: raise AssertionError('raced artifact symlink accepted')
print('PF-connected inventory controls PASS')
