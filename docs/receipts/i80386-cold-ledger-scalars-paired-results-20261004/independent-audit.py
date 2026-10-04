import pathlib,json,zipfile,hashlib,math,statistics
R=pathlib.Path(__file__).parent;Z=R/'official-artifact.zip';h=lambda b:hashlib.sha256(b).hexdigest();assert Z.stat().st_size==42577961 and h(Z.read_bytes())=='0edf476f7c835a253c299f4e0f7e3bc73c4a7d0438470659003b5458e37b7075';z=zipfile.ZipFile(Z)
for i in z.infolist():
 assert not i.filename.startswith('/') and '..' not in pathlib.PurePosixPath(i.filename).parts
 s=hashlib.sha256();size=0
 with z.open(i) as f:
  for b in iter(lambda:f.read(1<<20),b''):s.update(b);size+=len(b)
 assert size==i.file_size;p=R/'selected'/i.filename
 if p.is_file():assert h(p.read_bytes())==s.hexdigest()
prefix='cold-ledger-scalars-paired/';j=lambda p:json.loads(z.read(prefix+p));rawbytes=lambda p:z.read(prefix+p);d=j('pairs/result.json');c=j('setup/capture.json');assert d['status']=='PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_FAIL_KEEP_BASELINE';assert d['finalAuthentication']==j('pairs/initial-authentication.json') and d['bindingPinAfter']==d['bindingPinBefore'] and d['requestPinAfter']==d['requestPinBefore'];assert len(d['pairs'])==9;values=[]
for i,p in enumerate(d['pairs']):
 assert p['pair']==i and p['phase']==('warmup' if i<2 else 'measured');expected=['plain-JS','ledger-scalars-batched'] if i%2==0 else ['ledger-scalars-batched','plain-JS'];assert p['order']==expected and set(p['arms'])==set(expected)
 for arm in expected:
  ns=f'pairs/pair-{i:02d}-{arm}';f=j(ns+'/receipt/receipt.json');e=j(ns+'/exit.json');a=p['arms'][arm];assert e['exitCode']==0 and not e['timedOut'];assert (f['status']=='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS' if arm=='plain-JS' else f['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS');assert f['inputSha256Before']==f['inputSha256After']==h(rawbytes(f'pairs/pair-{i:02d}-{arm}-input.json'));assert j(ns+'/after-authentication.json')==j(f'pairs/pair-{i:02d}-{arm}-before.json');
  if arm=='plain-JS':
   assert f['sourceBefore']==f['sourceAfter'];assert f['result']['final']==c['javascriptFinal'] and f['result']['beforeSettle']['cpu']==c['cuts'][-1]['javascript']['cpu'] and f['result']['ports']==c['javascriptPorts']
  else:
   n=f['finalNative'];last=f['lastReturnedNative']
   for k in ['state','extra','segments','system','debug']:assert n[k]==last[k]==c['cuts'][-1]['native'][k]
   assert int(n['nativeTicks'])==int(n['successfulQuanta'])==316562 and last['activityState']==0 and len(last['sliceBytes'])==160;assert f['finalBoard']['state']['board']==c['javascriptFinal']['board'] and f['finalBoard']['ramSha256']==c['javascriptFinal']['ramSha256'];assert len(f['ports'])==16475
   for x,y in zip(f['ports'],c['javascriptPorts']):assert all(x[k]==y[k] for k in ['ordinal','dir','port','value','cycles']) and x['nativeTicks']==x['successfulQuanta']==y['q']-1
  raw=f['result']['timing'] if arm=='plain-JS' else f['executionTiming'];cpu=sum(raw['cpuMicroseconds'].values())/1e6;wall=int(raw['wallNanoseconds'])/1e9;assert a['execution']['cpuSeconds']==cpu and a['execution']['wallSeconds']==wall;assert math.isclose(a['wholeChild']['cpuSeconds'],sum(e['rusage'][k] for k in ['ru_utime','ru_stime']));assert a['wholeChild']==e
 if i>=2:values.append((p['arms']['plain-JS']['execution']['cpuSeconds'],p['arms']['ledger-scalars-batched']['execution']['cpuSeconds']))
b=statistics.mean(x[0] for x in values);v=statistics.mean(x[1] for x in values);reduction=1-v/b;s=d['summary'];assert math.isclose(b,s['baselineMeanExecutionCpuSeconds'],rel_tol=1e-14) and math.isclose(v,s['candidateMeanExecutionCpuSeconds'],rel_tol=1e-14) and math.isclose(reduction,s['meanCpuReduction']);assert all(y>x for x,y in values) and reduction<0 and not s['quantitativeGatePass'];
for p,t in zip(d['pairs'][2:],s['rawRatios']):
 a=p['arms']['plain-JS'];v1=p['arms']['ledger-scalars-batched'];
 for key,section,metric in [('executionCpuCandidateOverBaseline','execution','cpuSeconds'),('executionWallCandidateOverBaseline','execution','wallSeconds'),('wholeChildCpuCandidateOverBaseline','wholeChild','cpuSeconds'),('wholeChildWallCandidateOverBaseline','wholeChild','wallSeconds')]:assert math.isclose(t[key],v1[section][metric]/a[section][metric])
import subprocess,sys
sys.dont_write_bytecode=True
source='/tmp/bw-cold-ledger-scalars-paired-source-20261004'
sys.path.insert(0,source+'/scripts/cold-ledger-scalars-paired')
import policy
binding=j('setup/derived-paired-binding.json');setup=j('setup/setup-result.json');assert setup['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED'
assert setup['sourceAfter']==j('setup/before.json') and setup['roleSourcesAfter']==setup['sourceBeforeSetup'] and setup['originalInputsAfter']==setup['inputsBeforeRestore'] and setup['restoredAfter']==j('setup/restored-before.json')
assert policy.summarize_pairs(d['comparison'],d['pairs'])==d['summary']
initial=j('pairs/initial-authentication.json');rolepaths=0
for identity in [initial['parent'],initial['compiled'],*initial['workers'].values(),setup['sourceBeforeSetup']['driver'],setup['sourceBeforeSetup']['tooling']]:
 for path,digest in identity['hashes'].items():assert h(subprocess.check_output(['git','show',identity['revision']+':'+path],cwd=source))==digest;rolepaths+=1
assert rolepaths==364
for i,pair in enumerate(d['pairs']):
 for arm in pair['order']:
  f=j(f'pairs/pair-{i:02d}-{arm}/receipt/receipt.json');inp=j(f'pairs/pair-{i:02d}-{arm}-input.json');policy.validate_worker_receipt(f,arm,inp,binding,c)
  if arm!='plain-JS':policy.validate_bridge_evidence(f)
out={'status':'PASS_INDEPENDENT_PLAIN_JS_V_BATCHED_NEGATIVE_PAIRED_AUDIT','officialMembers':len(z.infolist()),'children':18,'sourceRolePaths':364,'host':'AMD EPYC 7763, four logical CPUs','discardedWarmupPairs':2,'measuredPairs':7,'baselineMeanExecutionCpuSeconds':b,'candidateMeanExecutionCpuSeconds':v,'meanReduction':reduction,'executionCpuSpeedRatio':b/v,'favorablePairs':0,'gatePassed':False,'baselineMeanExecutionWallSeconds':statistics.mean(p['arms']['plain-JS']['execution']['wallSeconds'] for p in d['pairs'][2:]),'candidateMeanExecutionWallSeconds':statistics.mean(p['arms']['ledger-scalars-batched']['execution']['wallSeconds'] for p in d['pairs'][2:]),'candidateOverBaselineCpu':v/b,'semanticProof':'Nine native children reset/final/last-return166 and N/Q; nine JS representedCPU/Q; all18 fullboard/RAMhash/16475PIO/source-input-finalmaps exact','scope':'PlainJS beats nativebatched in all7 measured pairs. No old-versus-scalar or cross-host gain inference. No physical386/fullboot/adoption.'};(R/'independent-scalar-paired-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
