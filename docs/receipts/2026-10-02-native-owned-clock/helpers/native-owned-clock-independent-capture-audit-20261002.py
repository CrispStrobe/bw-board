"""Audit completed captures only; never starts a guest or loads the addon."""
import pathlib,json,hashlib,sys,itertools,subprocess
label=sys.argv[1];assert label in ['smoke-off','fulltrace-on']
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-'+label+'-r2-20261002');H=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001');W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002');checks=0
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
def ck(ok,why):
 global checks
 assert ok,why;checks+=1
j=lambda p:json.loads(p.read_bytes())
def projection(v):
 if isinstance(v,list):return [projection(x) for x in v]
 if not isinstance(v,dict):return v
 out={}
 for k,x in v.items():
  if k=='clockTransfers':ck('nativeTicks' in v and 'successfulQuanta' in v,'physical metadata confined to native snapshots');continue
  if k=='sliceBytes':
   if isinstance(x,dict):ck(set(x)=={str(i) for i in range(160)},'indexed bytes exact domain');x=[x[str(i)] for i in range(160)]
   ck(isinstance(x,list) and len(x)==160 and all(type(b)is int and 0<=b<=255 for b in x),'exact160 byte bijection')
  out[k]=projection(x)
 return out
def same(a,b,path):
 ck(type(a)is type(b),path+' type')
 if isinstance(a,dict):
  ck(a.keys()==b.keys(),path+' keys')
  for k in a:same(a[k],b[k],path+'.'+k)
 elif isinstance(a,list):
  ck(len(a)==len(b),path+' length')
  for i,(x,y) in enumerate(zip(a,b)):same(x,y,path+'.'+str(i))
 else:ck(a==b,path+' exact value')
ck(sha(H/'fulltrace/capture.json')=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649','held H4 capture')
a=j(H/'fulltrace/capture.json');b=j(R/'guest/capture.json');before=j(R/'auth-before.json');after=j(R/'auth-after.json');inp=j(R/'input.json');exit=j(R/'exit.json')
ck(before==after,'actual before after auth');ck(exit['exitCode']==0 and not exit['timedOut'],'actual completion')
for stream,v in exit['streams'].items():ck(v['bytes']==(R/stream).stat().st_size and v['sha256']==sha(R/stream),'actual process stream')
ck(before['inputSha256']==sha(R/'input.json'),'input pin');ck(before['configSourceSha256']==sha(pathlib.Path(inp['configuration'])),'actual source configuration')
for key in ['preparedManifest','buildReceipt']:
 ck(inp[key+'Sha256']==sha(pathlib.Path(inp[key]))==before[key+'Sha256'],'actual '+key)
ck(before['addonSha256']==inp['sha256']==sha(pathlib.Path(inp['addon']))==b['addon']['sha256'],'actual addon')
ck(before['sourceRevision']==b['source']['revision']=='7df84bc2c367aff1cadec7cecdde69cf0e904ace','exact source')
ck(before['sourceFiles']==len(b['source']['hashes'])==86,'actual closure')
for p,h in b['source']['hashes'].items():ck(sha(W/p)==h,'current source '+p);ck(hashlib.sha256(subprocess.check_output(['git','show',before['sourceRevision']+':'+p],cwd=W)).hexdigest()==h,'git source '+p)
for field in ['reset','final','checkpoints','settled','ramSha256','resumes']:same(projection(a[field]),projection(b[field]),field)
ck(b['closed']=={'native':True,'board':True,'worker':True},'all owners closed');ck(b['terminal'] is True and b['resumes']==439,'terminal439')
ck(b['ramSha256']=='7aecf019a32f109760267d6ac1c60ef3d8793661910226cca3bcf5661189c38d','whole RAM')
ck(b['final']['clockTransfers']=={'transfers':'9204','commits':'8738','words':'201366'},'actual physical counts')
ck(int(b['final']['nativeTicks'])==100684 and int(b['final']['successfulQuanta'])==100682,'independent native N/Q')
rows=0
if label=='smoke-off':
 ck(inp['hostJournal'] is False and inp['nativeTrace'] is False,'capture off input');ck((R/'guest/callbacks.jsonl').stat().st_size==0 and b['journal']=={'rows':0,'bytes':0,'sha256':hashlib.sha256(b'').hexdigest()},'capture off actual empty journal')
else:
 ck(inp['hostJournal'] is True and inp['nativeTrace'] is True,'capture on input');ck(sha(H/'fulltrace.stderr')=='1df0b89f1b99a25729adbf193bf86f0fb2b8618ab22b13915d2f050e7e668a51','held H4 canonical origin')
 def canonical(p):
  with p.open('rb') as f:
   for line in f:
    if line.startswith(b'BWSD1\t'):yield line
    else:ck(b'BWSD1' not in line,'no malformed canonical fragment')
 for x,y in itertools.zip_longest(canonical(H/'fulltrace.stderr'),canonical(R/'stderr')):ck(x==y,'every canonical row');rows+=1
 ck(rows==1649067,'canonical census');ck(b['journal']==a['journal'],'exact expanded journal metadata');ck(sha(R/'guest/callbacks.jsonl')==a['journal']['sha256'],'expanded bf12 actual SHA')
 with (H/'fulltrace/callbacks.jsonl').open('rb') as f,(R/'guest/callbacks.jsonl').open('rb') as g:
  journalrows=0
  for x,y in itertools.zip_longest(f,g):ck(x==y,'each chronological bf12 row');journalrows+=1
 ck(journalrows==209839,'expanded bf12 census')
out={'status':'PASS_ACTUAL_CAPTURE_PARITY_NOT_PERFORMANCE_QUALIFICATION','scope':label,'checks':checks,'canonicalRows':rows,'sourceRevision':before['sourceRevision'],'captureSha256':sha(R/'guest/capture.json'),'clockTransfers':b['final']['clockTransfers'],'resumes':439,'snapshotProjection':'physical metadata only at native snapshot objects; strict160byte indexed-object/array bijection; every original field equal','scriptSha256':sha(pathlib.Path(__file__))}
(R/'independent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
