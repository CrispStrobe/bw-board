"""Read completed actual18 captures only; no native load/guest/benchmark."""
import pathlib,json,hashlib
p=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-main-cpu-gate-r2-20261002');r=p/'results';j=lambda p:json.loads(p.read_bytes());h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();n=0
def ck(v):
 global n
 assert v;n+=1
s=j(r/'summary.json');b=j(p/'approved-bindings.json');plan=j(p/'plan.json');before=j(r/'auth-before.json');ck(before==j(r/'auth-after.json'));ck(before['approvedBindingsSha256']==h(p/'approved-bindings.json'));ck(before['helperSha256']==h(p/'run.py'));ck(before['planSha256']==s['planSha256']==h(p/'plan.json'))
for k,v in b['artifactHashes'].items():ck(h(pathlib.Path(k))==v)
for arm,root,key in [('MAIN','/tmp/bw-board-386-native-owned-main-20261002','candidateSource'),('H4','/tmp/bw-board-386-native-hot-packed-scalar-20261001','baselineSource')]:
 for k,v in b[key]['hashes'].items():ck(h(pathlib.Path(root)/k)==v)
ref=j(pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json'))
def proj(v):
 if isinstance(v,list):return [proj(x)for x in v]
 if not isinstance(v,dict):return v
 out={}
 for k,x in v.items():
  if k=='clockTransfers':ck('nativeTicks'in v and 'successfulQuanta'in v);continue
  if k=='sliceBytes':
   if isinstance(x,dict):ck(set(x)=={str(i)for i in range(160)});x=[x[str(i)]for i in range(160)]
   ck(isinstance(x,list)and len(x)==160 and all(type(t)is int and 0<=t<=255 for t in x))
  out[k]=proj(x)
 return out
def same(x,y):
 ck(type(x)==type(y))
 if isinstance(x,dict):
  ck(x.keys()==y.keys())
  for k in x:same(x[k],y[k])
 elif isinstance(x,list):
  ck(len(x)==len(y))
  for a,b in zip(x,y):same(a,b)
 else:ck(x==y)
order=[(i,a)for i,o in enumerate(plan['samples']['pairOrder'])for a in o.split(',')];ck([(x['pair'],x['arm'])for x in s['records']]==order);ck(len(order)==18);series={'H4':[],'MAIN':[]}
for rec in s['records']:
 i,a=rec['pair'],rec['arm'];stem=r/(str(i)+'-'+a);cap=j(stem/'capture.json');inp=j(r/(str(i)+'-'+a+'.input.json'));e=j(r/(str(i)+'-'+a+'.exit.json'));ck(h(stem/'capture.json')==rec['captureSha256']);ck(h(r/(str(i)+'-'+a+'.input.json'))==rec['inputSha256']);ck(e==rec['exit']and e['exitCode']==0 and not e['timedOut']);ck(rec['warmup']==(i<2));ck(inp['hostJournal']is False and inp['nativeTrace']is False);ck(cap['source']==b['candidateSource'if a=='MAIN'else'baselineSource']);ck(all(v==''for v in e['blankEnvironment'].values()))
 for k,v in e['streams'].items():f=r/(str(i)+'-'+a+'.'+k);ck(h(f)==v['sha256']and f.stat().st_size==v['bytes']and v['bytes']<256*1024*1024)
 for k in ['reset','final','checkpoints','settled','ramSha256','resumes']:same(proj(cap[k]),proj(ref[k]))
 ck(cap['resumes']==439 and len(cap['checkpoints'])==6 and cap['terminal']is True);ck(cap['journal']=={'rows':0,'bytes':0,'sha256':hashlib.sha256(b'').hexdigest()});ck((stem/'callbacks.jsonl').read_bytes()==b'')
 t=cap['timing'];u=t['executionCPU']if a=='MAIN'else{'user':t['executionCpuUserUs'],'system':t['executionCpuSystemUs'],'total':t['executionCpuTotalUs']};ck(all(type(u[k])is int and u[k]>=0 for k in ['user','system','total']));ck(u['user']+u['system']==u['total']==rec['executionCpuTotalUs']);ck(t['executionNs']==rec['executionNs']);ck(rec['fullLogicalParity']is True)
 if a=='MAIN':
  for native in [cap['reset'],cap['final']]+[x['native']for x in cap['checkpoints']]:
   c=native['clockTransfers'];ck(int(c['words'])==int(native['nativeTicks'])+int(native['successfulQuanta']));ck(0<=int(c['commits'])<=int(c['transfers']))
  ck(cap['final']['clockTransfers']=={'transfers':'9204','commits':'8738','words':'201366'})
 if i>=2:series[a].append(u['total'])
means={k:sum(v)/7 for k,v in series.items()};reduction=100*(1-means['MAIN']/means['H4']);favorable=[a<b for a,b in zip(series['MAIN'],series['H4'])];ck(series['H4']==s['h4SamplesUs']and series['MAIN']==s['ownedSamplesUs']);ck(means['H4']==s['h4MeanUs']and means['MAIN']==s['ownedMeanUs']);ck(reduction==s['meanReductionPercent']);ck(all(favorable)==s['allSevenFavorable']);ck(s['gatePassed']==(reduction>=10 and all(favorable)));ck(s['status']=='ACTUAL_ABI3_MAIN_PROCESS_CPU_GATE_PASS')
out={'status':'PASS_ACTUAL18_AUDIT_FIXED_GATE_PASS','checks':n,'summarySha256':h(r/'summary.json'),'scriptSha256':h(pathlib.Path(__file__)),'h4MeanUs':means['H4'],'mainMeanUs':means['MAIN'],'meanReductionPercent':reduction,'favorablePairs':sum(favorable),'sampleCount':18,'warmupChildrenDiscarded':4,'scope':'Matched whole-process all-thread execution CPU; startup/settlement/final serialization excluded; synthetic fixed-ROM only, shared-load/JIT variability; no physical RTx or broader guest claim. Attempt1 pre-child binding failure preserved separately, zero samples.'};(r/'independent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
