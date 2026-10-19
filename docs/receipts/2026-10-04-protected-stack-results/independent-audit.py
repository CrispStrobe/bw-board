import pathlib,json,zipfile,hashlib,subprocess
p=pathlib.Path(__file__).parent;z=zipfile.ZipFile(p/'official-artifact.zip');h=lambda b:hashlib.sha256(b).hexdigest();j=lambda n:json.loads(z.read(n));prefix='_temp/protected-stack-execution/'
assert h((p/'official-artifact.zip').read_bytes())=='103f392ae223ebe5590f9611fc7f5c3cca1813e594c0bebd7d58faa3407ed1ed';assert len(z.infolist())==97
for i in z.infolist():
 b=z.read(i);q=p/'selected'/i.filename
 if q.exists():assert q.read_bytes()==b
c=j(prefix+'guest/capture.json');assert c['status']=='PASS' and c['cleanup']=={'native':'closed','provider':'closed','javascript':'closed'}
for x,y in [('driverBefore','driverAfter'),('compiledBefore','compiledAfter'),('nodeBefore','nodeAfter'),('build','buildAfter'),('configuration','configurationAfter'),('inputSha256Before','inputSha256After')]:assert c[x]==c[y]
for n in ['fixed','restored']:assert j(prefix+n+'-before.json')==j(prefix+n+'-after.json')
assert len(c['boundaries'])==32 and len(c['cuts'])==13
for x in c['boundaries']:
 n=x['native'];s=x['javascript'];cpu=s['cpu'];assert [len(n[k])for k in ['state','extra','segments','system','debug']]==[20,20,90,30,6]
 for k in ['state','extra','segments','system','debug']:assert all(type(v)is int and 0<=v<=0xffffffff for v in n[k])
 fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'];assert n['state'][:16]==[cpu[k]for k in fields];assert n['state'][16:]==[cpu['gdtr']['base'],cpu['gdtr']['limit'],cpu['idtr']['base'],cpu['idtr']['limit']];assert n['extra'][2:5]==[cpu[k]for k in ['es','fs','gs']]
 for i,key in enumerate(['es','cs','ss','ds','fs','gs']):
  v=n['segments'][15*i:15*i+15];cache=cpu['segmentCaches'][str(i)];assert [v[0],v[1],v[10],v[11],v[13],v[6]]==[i,cpu[key],cache['base'],cache['limit'],int(cache['default32']),int(cache['present'])]
 assert n['debug']==cpu['debugRegisters'][:4]+cpu['debugRegisters'][6:8];assert n['extra'][:2]==cpu['debugRegisters'][6:8];assert x['board']['board']==s['board']
 for key in ['gdt','code','stack']:assert len(x['nativeHostPages'][key])==4096 and x['nativeHostPages'][key]==s['pages'][key]
 assert not cpu['halted'] and not cpu['shutdown'] and cpu['eflags']&0x200==0;assert [cpu['interruptShadow'],cpu['nmiShadow'],cpu['debugShadow']]==([1,1,0]if cpu['cs']==24 and cpu['eip']==0x7007 else[0,0,0])
 for seg,selector,typ,index in [('cs',24,11,1),('ds',16,3,3),('ss',16,3,2)]:
  if cpu[seg]==selector:
   valid=7 if seg=='ss'and len(s['stores'])>11 else 1;assert n['segments'][index*15:index*15+15]==[index,selector,selector>>3,0,0,valid,1,0,1,typ,0,65535,0,0,0]
 assert x['board']['ram']['storeCount']==len(s['stores']);assert x['board']['ram']['bootStores']==min(11,len(s['stores']));assert x['board']['ram']['admitted']==(cpu['cs']==24 and cpu['eip']!=0x7000)
assert [x['q']for x in c['cuts']]==[0,16,18,19,21,22,23,25,26,27,28,29,30];assert c['progress']['n']==c['progress']['q']==c['progress']['resumes']==30 and c['progress']['zeroQ']==0
assert c['nativeFinal']['ramSha256']==c['javascriptFinal']['ramSha256']=='45d6115ea87c30d9e4fa0c2a4a484451e1bd2ac34b3667e76db231b4abee2cdd';assert c['nativeFinal']['state']['board']==c['javascriptFinal']['board'];assert c['nativeFinal']['pages']==c['javascriptFinal']['pages'];assert c['finalNative']['state']==c['lastReturnedNative']['state']
e=j(prefix+'worker.exit.json');assert e['exitCode']==0 and not e['timeout'];assert j(prefix+'final-status.json')['status']=='PASS'
r={'status':'PASS_INDEPENDENT_PROTECTED_STACK_CORRECTNESS_AUDIT','runId':37196612572,'artifactId':11301206742,'officialMembers':97,'nativeTicks':30,'quanta':30,'resumes':30,'boundaries':32,'rawWordsPerBoundary':166,'wholePagesPerBoundary':3,'pageBytes':4096,'cuts':13,'ssValidPhase':'1 before first PUSH write,7 thereafter','cleanup':'All three closed','ramSha256':c['nativeFinal']['ramSha256'],'scope':'Fixed same-ring code16 DS/SS/PUSH/POP/CALL/RET. Strict representedCPU plus source-backed exact native CS/DS/SS rows; full board and three host-provider pages, settled RAM hash. Native inhibit/cache coherence remains source-attested; no paging/IRQ/fullboot/performance claim.'};(p/'independent-audit.json').write_text(json.dumps(r,indent=2)+'\n');print('PASS32boundaries13cuts')
