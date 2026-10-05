"""Authority gate before any checkout/setup/download; no execution by itself."""
import sys
sys.dont_write_bytecode=True
from authority import pending_guard
c,_=pending_guard()
print('qualifier='+c['qualifierRevision'])
for name,files in [('qualifierFiles',c['qualifierFiles']),('compiledFiles',c['compiledFiles']),*[(k+'Files',w['files']) for k,w in c['workers'].items()]]:
 print(name+'<<FIXED_ROLE_FILES')
 for p in sorted(files):print('/'+p)
 print('FIXED_ROLE_FILES')
print('driver='+c['driverRevision']);print('driverFiles<<FIXED_ROLE_FILES')
for p in sorted(c['driverFiles']):print('/'+p)
print('FIXED_ROLE_FILES')
print('compiled='+c['compiledRevision'])
for k,w in c['workers'].items():print(k+'='+w['revision'])
