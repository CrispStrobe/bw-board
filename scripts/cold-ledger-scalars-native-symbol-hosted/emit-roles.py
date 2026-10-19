from policy import contract
from admission import HERE,read
c=contract(read(HERE/'contract.json'))
for name,r in c['roles'].items():
 print(name+'='+r['revision']);print(name+'Files<<FIXED_'+name);print('\n'.join(r['files']));print('FIXED_'+name)
