"""Synthetic artifact allowlist and bound controls; no guest inputs."""
import tempfile
from pathlib import Path

from inventory import MAX_FILE, allowed, inventory

assert allowed('results/sample-1/heap-profile.json')
assert allowed('results/reference/stdout.json')
assert allowed('gc-support.json')
assert allowed('gc-minor-enabled.heap.json')
assert allowed('gc-major-baseline.heap.json')
assert allowed('gc-minor-baseline.facts.json')
assert allowed('gc-major-enabled.facts.json')
for forbidden in (
    'xv6.img', 'kernel', 'client.exe', 'results/sample-1/code.bin',
    'results/other/stdout.json', 'results/sample-1/../../xv6.img',
    'results/sample-1/heap-profile.json/evil'):
    assert not allowed(forbidden)
with tempfile.TemporaryDirectory(prefix='rollback-inventory-control-') as directory:
    root = Path(directory)
    (root / 'results/sample-1').mkdir(parents=True)
    (root / 'results/sample-1/heap-profile.json').write_bytes(b'{}')
    receipt = inventory(root)
    assert receipt['totalBytes'] == 2 and len(receipt['files']) == 1
    bad = root / 'results/sample-1/code.bin'
    bad.write_bytes(b'binary')
    try:
        inventory(root)
    except ValueError as error:
        assert 'forbidden evidence role' in str(error)
    else:
        raise AssertionError('binary artifact admitted')
    bad.unlink()
    link = root / 'results/sample-1/stderr.txt'
    link.symlink_to(root / 'results/sample-1/heap-profile.json')
    try:
        inventory(root)
    except ValueError as error:
        assert 'forbidden evidence role' in str(error)
    else:
        raise AssertionError('artifact symlink admitted')
    link.unlink()
    huge = root / 'results/sample-1/stderr.txt'
    with huge.open('wb') as stream:
        stream.truncate(MAX_FILE + 1)
    try:
        inventory(root)
    except ValueError as error:
        assert 'unbounded evidence file' in str(error)
    else:
        raise AssertionError('oversize artifact admitted')
print('rollback evidence inventory controls PASS')
