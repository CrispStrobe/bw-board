import pathlib,json,hashlib
P=pathlib.Path(__file__).parent;R=P/'smoke-off';A=json.loads((P/'approved-bindings.json').read_bytes());a=json.loads((R/'guest/capture.json').read_bytes());j=json.loads(pathlib.Path(A['baseline']).read_bytes());n=0;H=lambda b:hashlib.sha256(b).hexdigest()
def ck(x):
 global n
 assert x;n+=1
ck(a['source']=={'revision':A['revision'],'hashes':A['sourceHashes']});ck(json.loads((R/'auth-before.json').read_bytes())==json.loads((R/'auth-after.json').read_bytes()));e=json.loads((R/'child.exit.json').read_bytes());ck(e['returncode']==0 and not e['timedOut']and not e['fileLimitReached']);ck((R/'guest/callbacks.jsonl').stat().st_size==0)
pairs=[('reset',a['reset'],j['reset']['cpu'])]+[(c['name'],c['native'],j['boundaries'][c['name']]['cpu'])for c in a['checkpoints']]+[('final',a['final'],j['final']['cpu'])];mp={'eax':0,'ecx':1,'ebx':3,'esp':4,'eip':8,'cr2':11,'cr3':12,'cs':13}
for name,x,y in pairs:
 for k,i in mp.items():ck(x['state'][i]==y[k])
 ck(x['state'][2]==0 and y['edx']==768);ck(y['cr0']==(0 if name=='reset'else 0x80000011));ck(x['state'][10]==((y['cr0']|0x7ffffff0)&0xffffffff))
 for key,size in [('state',20),('extra',20),('segments',90),('system',30),('debug',6)]:ck(len(x[key])==size);ck(all(type(z)is int and 0<=z<=0xffffffff for z in x[key]))
ck([c['name']for c in a['checkpoints']]==list(j['boundaries']))
for c in a['checkpoints']:ck(c['board']['board']==j['boundaries'][c['name']]['board']);ck(c['q']==j['boundaries'][c['name']]['q']);ck(int(c['native']['nativeTicks'])==j['boundaries'][c['name']]['attempts'])
ck(a['settled']['board']==j['final']['board']);ck(a['ramSha256']=='ecb57a4b83090fcf232c4bd2f7019cdfde992bdc8ecf708e04bdc1de9272733a');ck(a['ramCanonicalSha256']=='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f');ck(a['resetWitness']==list((0).to_bytes(4,'little')+(0x7ffffff0).to_bytes(4,'little')));ck(a['in8Witness']==[50,18]);ck(a['terminal']and a['resumes']==445);ck(int(a['final']['nativeTicks'])==100696 and int(a['final']['successfulQuanta'])==100694)
for f,h in A['artifactHashes'].items():ck(H(pathlib.Path(f).read_bytes())==h)
for f,h in A['helperHashes'].items():ck(H((P/f).read_bytes())==h)
r={'status':'PASS_ACTUAL_IN8_R3_CI_CAPTURE_OFF_EXPLICIT_PROFILE_NOT_SPEED_GATE','checks':n,'captureSha256':H((R/'guest/capture.json').read_bytes()),'sourceRevision':a['source']['revision'],'resumes':445,'scope':'Productionexit0/fullrecordedprofiles/boards/terminal/rawwitness+canonicalRAM/PIT match authenticateddiagnosticpolicy; rawCPU/RAMdifferences preserved. OriginalCIbindings authentic. NoCAPONclaim orspeedgate.'};(R/'independent-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
