import pathlib,json,zipfile,hashlib
p=pathlib.Path('/tmp/native-ram-bootstrap-first-execution-publication-20261003');o=p/'selected/_temp/ram-bootstrap-execution';j=lambda f:json.loads(f.read_text());h=lambda b:hashlib.sha256(b).hexdigest();z=p/'official-artifact.zip';meta=j(p/'zip-retention.json');assert h(z.read_bytes())==meta['zipSha256']=='b8fbf9f03ec36a6626c11cfcc18ecae72924873c0dd44c7bcb73613b2ad98b15'
with zipfile.ZipFile(z)as a:
 assert len(a.infolist())==96
 for f in a.infolist():
  if not f.is_dir():
   b=a.read(f);q=p/'selected'/f.filename
   assert q.read_bytes()==b
for name in ['fixed','restored']:assert j(o/(name+'-before.json'))==j(o/(name+'-after.json'))
c=j(o/'guest/capture.json');assert c['status']=='PASS' and c['cleanup']=={'native':'closed','provider':'closed','javascript':'closed'}
for a,b in [('driverBefore','driverAfter'),('compiledBefore','compiledAfter'),('nodeBefore','nodeAfter'),('build','buildAfter'),('configuration','configurationAfter'),('inputSha256Before','inputSha256After')]:assert c[a]==c[b]
assert len(c['boundaries'])==21 and len(c['cuts'])==5
for x in c['boundaries']:
 n=x['native'];s=x['javascript'];cpu=s['cpu'];assert [len(n[k])for k in ['state','extra','segments','system','debug']]==[20,20,90,30,6]
 for k in ['state','extra','segments','system','debug']:assert all(type(v)is int and 0<=v<=0xffffffff for v in n[k])
 fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'];assert n['state'][:16]==[cpu[k]for k in fields]
 assert n['state'][16:]==[cpu['gdtr']['base'],cpu['gdtr']['limit'],cpu['idtr']['base'],cpu['idtr']['limit']];assert n['extra'][2:5]==[cpu[k]for k in ['es','fs','gs']]
 for i,key in enumerate(['es','cs','ss','ds','fs','gs']):
  v=n['segments'][15*i:15*i+15];cache=cpu['segmentCaches'][str(i)];assert [v[0],v[1],v[10],v[11],v[13],v[6]]==[i,cpu[key],cache['base'],cache['limit'],int(cache['default32']),int(cache['present'])]
 assert n['debug']==cpu['debugRegisters'][:4]+cpu['debugRegisters'][6:8];assert n['extra'][:2]==cpu['debugRegisters'][6:8]
 assert x['board']['board']==s['board'];assert x['nativeRamPage']==s['ramPage'] and len(x['nativeRamPage'])==4096
 assert not cpu['halted'] and not cpu['shutdown'] and cpu['eflags']&0x200==0
for x in c['cuts']:assert any(x['native']==b['native']and x['javascript']==b['javascript']for b in c['boundaries'])
assert [(x['name'],x['q'])for x in c['cuts']]==[('reset',0),('AX1',10),('patched-from-ROM',14),('AX2',16),('before-HLT',19)]
assert c['nativeFinal']['ramPage']==c['javascriptFinal']['ramPage'];assert c['nativeFinal']['ramSha256']==c['javascriptFinal']['ramSha256'];assert c['nativeFinal']['state']['board']==c['javascriptFinal']['board'];assert c['progress']['n']==c['progress']['q']==c['progress']['resumes']==19 and c['progress']['zeroQ']==0
assert all(v=='0'for v in c['finalNative']['fallback'].values());assert c['finalNative']['execution']['physicalWrites']if 'physicalWrites'in c['finalNative']['execution']else True
assert c['finalNative']['callbacks']['physicalWrites']=='5';assert c['lastReturnedNative']['state']==c['finalNative']['state']
e=j(o/'worker.exit.json');assert e['exitCode']==0 and not e['timeout'];assert j(o/'final-status.json')['status']=='PASS'
r={'status':'PASS_INDEPENDENT_ACTUAL_RAM_CORRECTNESS_AUDIT','runId':37142542286,'artifactId':11280788469,'zipSha256':meta['zipSha256'],'officialMembers':96,'nativeTicks':19,'quanta':19,'resumes':19,'boundaries':21,'nativeWordsPerBoundary':166,'rawPageBytesPerBoundary':4096,'cuts':5,'cleanup':'All three closed','scope':'All retained native166 words and represented JS counterparts, full board and host-provider4096-byte pages verified per boundary. Native cache coherence remains source-attested; not a separate native-memory dump. One correctness run, no performance/boot-generalization claim.'};(p/'independent-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(r)
