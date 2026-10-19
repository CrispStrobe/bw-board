"""No setup: reviewed contract must be READY before any role is checked out."""
import sys
sys.dont_write_bytecode=True
from qualify import contract,read_json,HERE,tooling
import os
c=contract(read_json(HERE/'contract.json'))
assert tooling()['revision']==os.environ['GITHUB_SHA']
for role,revision,files in [('compiled',c['compiledRevision'],c['compiledFiles']),('driver',c['driver']['revision'],c['driver']['files']),('worker',c['worker']['revision'],c['worker']['files'])]:
 print(role+'='+revision)
 print(role+'Files<<EXACT_FILES')
 for p in sorted(files):print('/'+p)
 print('EXACT_FILES')
