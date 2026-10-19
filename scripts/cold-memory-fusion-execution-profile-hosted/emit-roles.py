"""Admission precedes all downstream checkout/setup effects."""
import json
from policy import contract,HERE
c=contract(json.loads((HERE/'contract.json').read_bytes()))
for name,key in [('qualifier','qualifier'),('compiled','compiled'),('driver','metadataDriver'),('heldWorker','heldWorker'),('diagnostic','diagnosticWorker')]:
 r=c[key];print(name+'='+r['revision']);print(name+'Files<<BOUND_ROLES');print('\n'.join('/'+p for p in sorted(r['files'])));print('BOUND_ROLES')
