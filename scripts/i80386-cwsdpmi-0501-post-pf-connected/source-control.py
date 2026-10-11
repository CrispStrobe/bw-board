#!/usr/bin/env python3
"""Stdlib synthetic admission predicates and static held Git byte checks only."""
import importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('post_source',Path(__file__).with_name('source.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert len(m.HELD_HASHES)==278 and len(m.NEW_ROLES)==12
names=set(m.HELD_HASHES)|m.NEW_ROLES
m.check_scope(m.NEW_ROLES,names)
for changed,available in [(m.NEW_ROLES|{'src/experimental/i80386.js'},names),
                           (m.NEW_ROLES-{'scripts/i80386-cwsdpmi-0501-post-pf-connected/driver.mjs'},names),
                           (m.NEW_ROLES,names|{m.NEW+'extra.mjs'})]:
    try:m.check_scope(changed,available)
    except ValueError:pass
    else:raise AssertionError('broad or incomplete source admitted')
for role in m.HELD_HASHES:
    raw=m.git('show',m.BASE+':'+role);m.check_held(role,raw)
    try:m.check_held(role,raw+b'x')
    except ValueError:pass
    else:raise AssertionError('held source mutation admitted')
assert m.imports(m.NEW+'driver.mjs',b"import {x} from './grade.mjs'; import fs from 'node:fs';",names)==[m.NEW+'grade.mjs']
for raw in [b"import('node:fs')",b"import x from 'unbound'",b"import x from './missing.mjs'"]:
    try:m.imports(m.NEW+'driver.mjs',raw,names)
    except ValueError:pass
    else:raise AssertionError('unbound import admitted')
assert set(m.HELD_GRAPH)=={r for r in m.HELD_HASHES if r.endswith(('.js','.mjs'))}
base_names=set(m.git('ls-tree','-r','--name-only',m.BASE).decode().splitlines())
for role,edges in m.HELD_GRAPH.items():
    assert m.imports(role,m.git('show',m.BASE+':'+role),base_names)==edges
    assert set(edges)<=set(m.HELD_HASHES)
for raw in [b"import {x} from './grade.mjs'; import y from './unreviewed.mjs';",
            b"import {x} from './grade.mjs';\nimport y\nfrom './unreviewed.mjs';",
            b"import {x} from './grade.mjs'; export * from './unreviewed.mjs';",
            b"import x; import y from './grade.mjs';",
            b"import x from './gr\\x61de.mjs';",
            b"const t=`${import/* gap */('./grade.mjs')}`;"]:
    try:m.imports(m.NEW+'driver.mjs',raw,names)
    except ValueError:pass
    else:raise AssertionError('hidden/unparsed module edge admitted')
assert m.imports(m.NEW+'driver.mjs',b"const r=/\\bimport\\s+from/; import x from './grade.mjs';",names)==[m.NEW+'grade.mjs']
assert m.imports(m.NEW+'driver.mjs',b"import {x}\nfrom './grade.mjs'; export *\nfrom './orchestration.mjs';",names)==[m.NEW+'grade.mjs',m.NEW+'orchestration.mjs']
existing='src/z80.js'
assert existing in base_names and existing not in m.HELD_HASHES
hidden=m.imports(m.NEW+'driver.mjs',b"import x from './grade.mjs'; import y from '../../src/z80.js';",names|{existing})
try:m.check_bound_edges(hidden)
except ValueError:pass
else:raise AssertionError('existing unreviewed second import admitted')
print('PASS post-PF source predicates and 278 held Git roles; no runtime')
