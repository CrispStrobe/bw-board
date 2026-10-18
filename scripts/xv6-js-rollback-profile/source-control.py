"""CPU-free exact support-only follow-up delta and import controls."""
from source import DELTA, NEW, admit_delta, relative_js_edges

approved = [('M', role) for role in sorted(DELTA)]
admit_delta(approved)
for changes in (
    approved[:-1],
    approved + [('M', 'src/experimental/i80386.js')],
    [('A', role) if role == approved[0][1] else (kind, role)
     for kind, role in approved],
    approved[:-1] + [('M', '.github/workflows/unreviewed.yml')],
    approved + [('M', next(iter(NEW - DELTA)))],
):
    try:
        admit_delta(changes)
    except ValueError as error:
        assert 'exact modified' in str(error)
    else:
        raise AssertionError('unreviewed source delta admitted')
role = 'scripts/xv6-js-rollback-profile/support-control.mjs'
assert relative_js_edges(role, "import {sampleIncludesCollected} from './support.mjs';") == [
    [role, 'scripts/xv6-js-rollback-profile/support.mjs']]
for bad in ("import x from '../unreviewed.mjs';",
            "import x from 'outside-package';"):
    try:
        relative_js_edges(role, bad)
    except ValueError:
        pass
    else:
        raise AssertionError('unreviewed JS import admitted')
print('rollback source-delta/import controls PASS')
