"""Audit the single completed CPU gate. No execution, repeat, or profiling."""
import pathlib,json,hashlib,subprocess,math,fractions
R=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-cpu-benchmark-20261002');P=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-cpu-plan-20261002.json');B=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-build-20261002');H=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');W=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002');checks=0
sha=lambda p:hashlib.file_digest(p.open('rb'),'sha256').hexdigest();j=lambda p:json.loads(p.read_bytes())
def ck(ok,label):
 global checks
 assert ok,label;checks+=1
def project(v):
 if isinstance(v,list):return [project(x) for x in v]
 if not isinstance(v,dict):return v
 out={}
 for k,x in v.items():
  if k=='clockTransfers':ck('nativeTicks'in v and 'successfulQuanta'in v,'physical snapshot only');continue
  if k=='sliceBytes':
   if isinstance(x,dict):ck(set(x)=={str(i) for i in range(160)},'indexed byte bijection');x=[x[str(i)] for i in range(160)]
   ck(isinstance(x,list) and len(x)==160 and all(type(z)is int and 0<=z<=255 for z in x),'exact160bytes')
  out[k]=project(x)
 return out
def eq(a,b,path):
 ck(type(a)is type(b),path+' type')
 if isinstance(a,dict):
  ck(a.keys()==b.keys(),path+' keys')
  for k in a:eq(a[k],b[k],path+'.'+k)
 elif isinstance(a,list):
  ck(len(a)==len(b),path+' length')
  for i,(x,y)in enumerate(zip(a,b)):eq(x,y,path+'.'+str(i))
 else:ck(a==b,path+' value')
plan=j(P);S=j(R/'summary.json');before=j(R/'auth-before.json');after=j(R/'auth-after.json');ck(before==after,'all beforeafter bindings');ck(before['planSha256']==sha(P)==S['planSha256'],'predeclared plan pin');ck(before['helperSha256']==sha(pathlib.Path('/mnt/volume1/tmp-astra/native-owned-clock-root-cpu-20261002.py')),'actual root helper pin')
for key,path in [('candidateReceiptSha256',B/'build-static-preflight.json'),('candidateManifestSha256',B/'prepare.json'),('baselineManifestSha256',pathlib.Path('/mnt/volume1/tmp-astra/native-hot-build-h4-20261001/prepare.json')),('baselineHelperSha256',pathlib.Path(plan['baselineHelperPath'])),('configSha256',B/'guest-source.bochsrc')]:ck(before[key]==sha(path),'artifact pin '+key)
reference=pathlib.Path('/mnt/volume1/tmp-astra/native-hot-h4-fulltrace-20261001/fulltrace/capture.json');ck(sha(reference)=='3085b4f7ee43bb8cfcea8ce98611e0f7a567907f3b7e5a7521065c1bc91e8649','held semantic reference');a=j(reference)
ck(plan['samples']['warmups']==2 and plan['samples']['measuredPairs']==7 and plan['samples']['children']==18,'predeclared population');ck(len(S['records'])==18,'all actual18')
expected=[(i,arm)for i,order in enumerate(plan['samples']['pairOrder'])for arm in order.split(',')];ck([(r['pair'],r['arm'])for r in S['records']]==expected,'exact alternating order')
source_maps={};samples={'H4':[],'ABI3':[]}
for record in S['records']:
 i,arm=record['pair'],record['arm'];stem=R/(str(i)+'-'+arm);c=j(stem/'capture.json');inp=j(R/(str(i)+'-'+arm+'.input.json'));e=j(R/(str(i)+'-'+arm+'.exit.json'))
 ck(record['inputSha256']==sha(R/(str(i)+'-'+arm+'.input.json')),'actual input');ck(record['captureSha256']==sha(stem/'capture.json'),'actual capture');ck(record['exit']==e,'actual process receipt');ck(e['exitCode']==0 and not e['timedOut'],'bounded completion')
 for name,v in e['streams'].items():p=pathlib.Path(str(stem)+'.'+name);ck(v['bytes']==p.stat().st_size and v['sha256']==sha(p),'actual stream')
 ck(inp['hostJournal']is False and inp['nativeTrace']is False and inp['profile']is False,'capture disabled/unprofiled');ck(inp['configuration']==str(B/'guest-source.bochsrc'),'same config source');ck(c['addon']['sha256']==sha(pathlib.Path(inp['addon']))==inp['sha256'],'actual binary')
 ck(c['source']['revision']==before['candidateSource'if arm=='ABI3'else'baselineSource'],'correct frozen source');
 if arm not in source_maps:
  source_maps[arm]=c['source'];root=W if arm=='ABI3'else H
  for p,h in c['source']['hashes'].items():ck(sha(root/p)==h,'actual source '+arm+p)
 else:ck(source_maps[arm]==c['source'],'same source each arm')
 for field in ['reset','final','checkpoints','settled','ramSha256','resumes']:eq(project(c[field]),project(a[field]),str(i)+arm+field)
 ck(c['terminal']is True and all(c['closed'].values()),'actual terminal and closed');ck(c['journal']['rows']==0 and (stem/'callbacks.jsonl').stat().st_size==0,'actual capture off')
 t=c['timing'];cpu=t['executionCPU']if arm=='ABI3'else{'user':t['executionCpuUserUs'],'system':t['executionCpuSystemUs'],'total':t['executionCpuTotalUs']};ck(all(type(v)is int and v>=0 for k,v in cpu.items()if k!='unit'),'integerCPU');ck(cpu['total']==cpu['user']+cpu['system']>0,'allthread user+system');ck(record['executionCpuTotalUs']==cpu['total']and record['executionNs']==t['executionNs'],'actual metric values');ck(record['warmup']==(i<2),'exact warmup discard');ck(record['fullLogicalParity']is True,'per-child semantics flag')
 if i>=2:samples[arm].append(cpu['total'])
ck(len(samples['H4'])==len(samples['ABI3'])==7,'seven measured pairs');ck(S['h4SamplesUs']==samples['H4']and S['ownedSamplesUs']==samples['ABI3'],'both actual series')
h4=fractions.Fraction(sum(samples['H4']),7);owned=fractions.Fraction(sum(samples['ABI3']),7);reduction=100*(1-owned/h4);favorable=[b<a for a,b in zip(samples['H4'],samples['ABI3'])];passed=reduction>=plan['gate']['meanProcessCpuReductionAtLeastPercent']and all(favorable)
ck(S['h4MeanUs']==float(h4)and S['ownedMeanUs']==float(owned),'both means');ck(math.isclose(S['meanReductionPercent'],float(reduction),rel_tol=0,abs_tol=1e-12),'ratio of means');ck(S['allSevenFavorable']==all(favorable)and S['gatePassed']==passed,'AND criterion');ck(not passed and S['status']=='ACTUAL_ABI3_PROCESS_CPU_GATE_FAIL_KEEP_H4','honest negative');ck(S['physicalRTxMeasured']is False and S['broaderGuestQualification']is False,'claim limits')
out={'status':'PASS_ACTUAL_18_CHILD_AUDIT_CPU_GATE_FAIL_KEEP_H4','checks':checks,'h4SamplesUs':samples['H4'],'ownedSamplesUs':samples['ABI3'],'h4MeanUs':float(h4),'ownedMeanUs':float(owned),'meanReductionPercent':float(reduction),'favorablePairs':sum(favorable),'gatePassed':passed,'all18SemanticParity':True,'summarySha256':sha(R/'summary.json'),'scriptSha256':sha(pathlib.Path(__file__)),'sourceClosureCounts':{arm:len(s['hashes'])for arm,s in source_maps.items()},'scope':'single predeclared allthread execution CPU gate; warmup discard and exact pairing; synthetic fixed free ROM and shared system load; no adoption/retry'};(R/'independent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
