import pathlib,json,hashlib,zipfile
R=pathlib.Path(__file__).parent; Z=R/'official-artifact.zip'; checks=0
def ck(v,msg):
 global checks
 assert v,msg
 checks+=1
sha=lambda b:hashlib.sha256(b).hexdigest()
ck(Z.stat().st_size==10438346,'ZIP size');ck(sha(Z.read_bytes())=='702c9eafeb7dbfd95d6d49b0df9b1d293491d8276d8a8857a543a80ce8abb1f2','ZIP digest')
z=zipfile.ZipFile(Z); names=z.namelist();ck(len(names)==len(set(names)),'unique members');member={}
for i in z.infolist():
 ck(not i.filename.startswith('/') and '..' not in pathlib.PurePosixPath(i.filename).parts,'member path')
 h=hashlib.sha256();size=0
 with z.open(i) as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b);size+=len(b)
 ck(size==i.file_size,'member size');member[i.filename]={'bytes':size,'sha256':h.hexdigest()}
 p=R/'selected'/i.filename
 if p.is_file():ck(sha(p.read_bytes())==h.hexdigest(),'selected member')
base='_temp/cold-native-diagnostic/'
def load(f):return json.loads(z.read(base+f))
for a,b in [('before.json','after.json'),('immutable-inputs-before-restore.json','immutable-inputs-after.json'),('artifacts-before-native.json','artifacts-after-native.json')]:ck(load(a)==load(b),a+' equality')
b=load('before.json');ck(b['compiledHead']=='7632e6a0995ceaab88bc8cede91506a5330d2e1c','compiled head');ck(b['driverHead']=='11c0bdcade020117fc682e97db284c6ff8797842','driver head');ck(len(b['compiledFiles'])==125 and len(b['driverFiles'])==54,'source sizes')
c=load('guest/capture.json');e=load('native.exit.json');ck(e['returncode']==0 and not e['timedOut'],'child exit');ck(c['closed'] and c['progress']['n']==316562 and c['progress']['q']==316562 and c['progress']['resumes']==316562,'extent');ck(len(c['cuts'])==15 and len(c['reps'])==4,'cut REP sizes');ck(sum(len(x['elements']) for x in c['reps'])==400,'REP elements')
ck(c['nativeFinal']['ramSha256']==c['javascriptFinal']['ramSha256']=='af0c07fc87959f6481ab7611967ac40a2c8d3d5fa14beac0979cc99e95913f02','raw RAM');ck(c['nativeFinal']['state']['board']==c['javascriptFinal']['board'],'final full board');ck(c['javascriptFinal']['cpu']['eip']==0xe16 and c['javascriptFinal']['cpu']['cs']==0xf000 and not c['javascriptFinal']['cpu']['halted'],'ordinary E16 pause')
for a,j in zip(c['nativePorts'],c['javascriptPorts']):
 ck(all(a[k]==j[k] for k in ['ordinal','dir','port','value','cycles']),'PIO value/order/cycles');ck(a['nativeTicks']==a['successfulQuanta']==j['q']-1 and j['width']==8,'PIO phase')
ck(len(c['nativePorts'])==len(c['javascriptPorts'])==16475,'complete PIO length')
for x in c['cuts']:
 n=x['native'];j=x['javascript']['cpu'];ck(sum(len(n[k]) for k in ['state','extra','segments','system','debug'])==166,'native words')
 ck(n['state'][:8]==[j[k] for k in ['eax','ecx','edx','ebx','esp','ebp','esi','edi']],'GPR cut');ck(n['state'][8]==j['eip'],'EIP cut');mask=0x800 if 4709<=x['q']<4836 else 0;ck(((n['state'][9]^j['eflags'])&~mask)==0,'defined flags cut');ck(n['state'][10:13]==[j[k] for k in ['cr0','cr2','cr3']],'control cut');ck(x['board']['board']==x['javascript']['board'],'whole board cut')
o=c['undefinedFlagOwnership'];ck(o['started'] and o['repElements']==120 and o['mask']==0,'OF completed');ck(o['events'][-1]['q']==4836 and o['events'][-1]['undefinedMask']==0,'OF expiry')
records=c['retainedProgress']['records'];ck(len(records)==34,'progress count'); qs=[]
for r in records:
 raw=z.read(base+'guest/progress-'+r['name']+'.json');ck(len(raw)==r['bytes'] and sha(raw)==r['sha256'],'progress authenticity');v=json.loads(raw);ck(v['name']==r['name'] and v['n']==r['n'] and v['q']==r['q'],'progress tuples');ck(sum(len(v['native'][k]) for k in ['state','extra','segments','system','debug'])==166,'progress166');qs.append(r['q'])
ck(qs==sorted(qs) and qs[-1]==316562,'progress ordering/endpoint')
ck(e['wait4']['userSeconds']>0 and e['wait4']['systemSeconds']>=0,'wait4');ck(all(v==0 for v in e['memoryEventDelta']['events'].values()),'aggregate memory deltas')
out={'status':'PASS_INDEPENDENT_EIGHTH_COLD_E16_AUDIT','checks':checks,'zipSha256':sha(Z.read_bytes()),'members':len(names),'extent':c['progress'],'cuts':15,'repElements':400,'ports':16475,'progressRecords':34,'ramSha256':c['nativeFinal']['ramSha256'],'wait4':e['wait4'],'wallSeconds':e['wallSeconds'],'limits':'Source-attested intermediate comparisons/digests are not independently reconstructible from retained cuts. Raw RAM equality is attested hashes, not retained full bytes. One OFF diagnostic; no OFF/ON or speed qualification. Cgroup deltas aggregate; no inference about prior SIGKILL cause.'}
(R/'independent-eighth-attempt-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
