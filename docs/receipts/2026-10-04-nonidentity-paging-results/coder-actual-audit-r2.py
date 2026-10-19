"""Read-only retained actual records; no import of emulator or addon."""
import pathlib,json,hashlib,subprocess,struct,collections
P=pathlib.Path('/tmp/native-nonidentity-paging-first-execution-publication-20261004');E=P/'selected/_temp/nonidentity-paging-execution';C=json.loads((E/'guest/capture.json').read_text())
R=pathlib.Path('/tmp/bw-native-nonidentity-paging-hosted-source-20261004')
def read(n):return json.loads((E/n).read_text())
def sha(b):return hashlib.sha256(b).hexdigest()
def words(n):
 out=[]
 for k,l in zip(['state','extra','segments','system','debug'],[20,20,90,30,6]):
  assert len(n[k])==l and all(type(v)is int and 0<=v<=0xffffffff for v in n[k]);out+=n[k]
 assert len(out)==166;return out
layout={'gdt':0,'directory':0x1000,'table':0x2000,'aliasCode':0x7000,'aliasData':0x9000,'code':0xa000,'data':0xb000}
def effect_pages(stores,updates=()):
 p={k:[0]*4096 for k in layout}
 for event in [*stores,*updates]:
  raw=event['raw'];b=event.get('bytes')
  if b is None:b=list(struct.pack('<I',event['after']))
  key=next(k for k,v in layout.items()if v<=raw< v+4096);offset=raw-layout[key];assert offset+len(b)<=4096;p[key][offset:offset+len(b)]=b
 return p

def cpu(n,j):
 words(n)
 for i,k in enumerate(['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss']):assert n['state'][i]==j[k],k
 assert n['state'][16:]==[j['gdtr']['base'],j['gdtr']['limit'],j['idtr']['base'],j['idtr']['limit']]
 assert n['extra'][2:5]==[j['es'],j['fs'],j['gs']];assert n['extra'][5:8]==n['segments'][17:20]
 for i,k in enumerate(['es','cs','ss','ds','fs','gs']):
  row=n['segments'][i*15:i*15+15];cache=j['segmentCaches'][str(i)];assert row[0]==i and row[1]==j[k]
  assert [row[10],row[11],row[13],row[6]]==[cache['base'],cache['limit'],int(cache['default32']),int(cache['present'])]
 assert [n['extra'][9],n['extra'][13],n['extra'][14],n['extra'][16]]==[int(j['segmentCaches']['1']['present']),j['segmentCaches']['1']['base'],j['segmentCaches']['1']['limit'],int(j['segmentCaches']['1']['default32'])]
 assert (n['segments'][25]+n['state'][8])&0xffffffff==j['pc']
 for i,k in enumerate(['ldtr','tr']):
  row=n['system'][i*15:i*15+15];cache=j[k];assert [row[0],row[1],row[10],row[11],row[6],row[9]]==[i+6,cache['selector'],cache['base'],cache['limit'],int(cache['present']),cache['type']]
 assert n['debug']==j['debugRegisters'][:4]+j['debugRegisters'][6:8] and n['extra'][:2]==j['debugRegisters'][6:8]
 assert j['cr4']==0 and not any(j[k]for k in ['halted','shutdown','interruptShadow','nmiShadow','debugShadow']) and j['eflags']&0x200==0
 assert n['mappingEpoch']==0 and n['boardA20']==1
 if 'activityState'in n:assert n['activityState']==0
 assert set(n['fallback'])=={'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'};assert set(n['execution'])=={'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'}
 for v in [*n['fallback'].values(),*n['execution'].values()]:assert type(v)is int or(type(v)is str and v.isascii() and v.isdecimal()and(v=='0'or not v.startswith('0')))
 assert all(int(v)==0 for v in n['fallback'].values());assert all(int(n['execution'][k])==0 for k in ['repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'])

assert C['status']==read('final-status.json')['status']=='PASS';assert C['progress']=={'n':34,'q':34,'dn':1,'dq':1,'resumes':34,'zeroQ':0};assert len(C['boundaries'])==36
assert C['cleanup']=={'native':'closed','provider':'closed','javascript':'closed'}
assert read('fixed-before.json')==read('fixed-after.json') and read('restored-before.json')==read('restored-after.json')
for name in ['driver','compiled','build','configuration']:assert C[name+'Before']==C[name+'After'] if name not in ['build','configuration'] else C[name]==C[name+'After']
assert C['nodeBefore']==C['nodeAfter'] and C['inputSha256Before']==C['inputSha256After']==sha((E/'input.json').read_bytes())
fixed=read('fixed-before.json');roles=[(R,fixed['tooling']['head'],fixed['tooling']['files']),(pathlib.Path('/tmp/bw-native-nonidentity-paging-build-source-20261004'),C['compiledBefore']['revision'],C['compiledBefore']['hashes']),(pathlib.Path('/tmp/bw-native-nonidentity-paging-ready-driver-20261004'),C['driverBefore']['revision'],C['driverBefore']['hashes'])]
assert [len(x[2])for x in roles]==[10,192,70]
for root,revision,records in roles:
 for path,h in records.items():assert sha((root/path).read_bytes())==h==sha(subprocess.check_output(['git','show',revision+':'+path],cwd=root)),path
matched=0;unmatched=[]
for i,b in enumerate(C['boundaries']):
 n=b['native'];j=b['javascript'];cpu(n,j['cpu']);assert n['successfulQuanta']==j['q'];assert j['pages']==effect_pages(j['stores'],j['updates']);assert b['nativeHostPages']==effect_pages(b['board']['ram']['writes'])==b['board']['ram']['pages']
 if b['comparison']['status']=='UNMATCHED_PHASE':
  assert b['kind']=='resume' and j['q']in(29,30);unmatched.append(j['q'])
 else:
  assert b['comparison']['status']=='COMPARABLE_PARITY_PASS';assert b['nativeHostPages']==j['pages'] and b['board']['board']==j['board'];matched+=1
  if j['cpu']['cs']==24:
   assert n['segments'][15:30]==[1,24,3,0,0,1,1,0,1,11,0,65535,0,0,0]
  if j['cpu']['ds']==16:
   valid=7 if j['q']>=33 else 3 if j['q']==32 else 1;assert n['segments'][45:60]==[3,16,2,0,0,valid,1,0,1,3,0,65535,0,0,0]
assert matched==34 and unmatched==[29,30]
assert [x['name']for x in C['cuts']]==['reset','after-LGDT','CR3-ready','PE-enabled','DS-ready','PG-enabled','entered-paged-code','after-code-fetch','after-data-read','after-data-write','before-HLT']
assert [x['q']for x in C['cuts']]==[0,21,23,25,27,29,30,31,32,33,34]
assert C['milestones']=={'milestones':11,'comparableCuts':9,'unmatchedCuts':2,'pageBytesPerRecordedBoundary':28672}
for stage in C['stages']:
 assert stage['comparison']=='UNMATCHED_STAGE_RECORD';assert stage['native']['ram']['pages']==effect_pages(stage['native']['ram']['writes']);j=stage['javascript'];assert j['pages']==effect_pages(j['stores'],j['updates'])
assert len(C['stages'])==34
assert words(C['finalNative'])==words(C['lastReturnedNative'])
f=C['nativeFinal'];j=C['javascriptFinal'];assert f['state']['board']==j['board'] and f['pages']==j['pages']==effect_pages(j['stores'],j['updates']);assert f['ramSha256']==j['ramSha256']=='b36573f67cf2de4454d97a8c2a04b1fa5980ad47c7207da9f42fb07b5b33cf43'
assert len(C['nativeMemoryEvents'])==39;events=C['nativeMemoryEvents']
for i,e in enumerate(events):assert e['ordinal']==i and e['direction']in ['read','write'] and e['successfulQuanta']<=34 and e['nativeTicks']<=34
for direction,key in [('write','writes'),('read','reads')]:assert [{k:v for k,v in e.items()if k not in ['ordinal','direction']}for e in events if e['direction']==direction]==f['state']['ram'][key]
for p in E.glob('*.exit.json'):d=json.loads(p.read_text());assert d['exitCode']==0 and not d['timeout'],p
result={'status':'PASS_CODER_FIXED_NONIDENTITY_PAGING_AUDIT','runId':37207113095,'artifactId':11304886677,'captureSha256':sha((E/'guest/capture.json').read_bytes()),'sourceRolePaths':272,'nativeTicks':34,'successfulQuanta':34,'resumes':34,'zeroQ':0,'boundaries':36,'nativeWords':36*166,'strictComparableBoundaries':34,'unmatchedPhases':unmatched,'namedCuts':11,'namedComparableCuts':9,'namedUnmatchedCuts':2,'physicalPagesPerBoundary':7,'bytesPerPage':4096,'nativeMemoryEvents':dict(collections.Counter(e['direction']for e in events)),'settledRamSha256':f['ramSha256'],'scope':'Fixed trace-OFF 386 paging correctness only; all166 retained, documented represented counterparts compared; copied host RAM backing/cache ownership source-attested; whole RAM bytes not retained; unmatched stages/phases never parity claims. No OS or speed/adoption claim.'}
(P/'coder-actual-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
