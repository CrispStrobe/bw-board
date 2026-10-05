"""Pure binding/role checks shared by restore orchestration and source controls."""
from pathlib import Path
from archive import require

def disjoint_roles(values):
    paths=[Path(v) for v in values]
    for p in paths:
        require(p.is_absolute() and p.parent.resolve()==p.parent and p.parent.is_dir(), 'canonical role parent')
        require(not p.is_symlink(), 'role symlink')
    for i,p in enumerate(paths):
        for q in paths[i+1:]:
            require(p!=q and p not in q.parents and q not in p.parents, 'overlapping roles')

def driver_identity(actual, revision, files):
    require(set(actual)=={'revision','hashes'}, 'driver identity schema')
    require(actual['revision']==revision, 'driver revision')
    require(actual['hashes']=={n:r['sha256'] for n,r in files.items()}, 'complete driver closure')

def evidence_equal(actual, expected):
    require(actual==expected, 'original evidence changed')
