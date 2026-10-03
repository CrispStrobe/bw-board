import pathlib,json,zipfile,hashlib,math,statistics
R=pathlib.Path(__file__).parent;Z=R/'official-artifact.zip';h=lambda b:hashlib.sha256(b).hexdigest();assert Z.stat().st_size==44302763 and h(Z.read_bytes())=='1b048847be0708fcc9bd1baf40690c8ce16a35059277d40e620ac073940f2ad7';z=zipfile.ZipFile(Z)
for i in z.infolist():
 assert not i.filename.startswith('/') and '..' not in pathlib.PurePosixPath(i.filename).parts
 s=hashlib.sha256();size=0
 with z.open(i) as f:
  for b in iter(lambda:f.read(1<<20),b''):s.update(b);size+=len(b)
 assert size==i.file_size;p=R/'selected'/i.filename
 if p.is_file():assert h(p.read_bytes())==s.hexdigest()
r=R/'selected/_temp/cold-paired-performance';j=lambda p:json.loads((r/p).read_text());d=j('pairs/result.json');c=j('setup/capture.json');assert d['status']=='PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_PASS';assert d['finalAuthentication']==j('pairs/initial-authentication.json') and d['bindingPinAfter']==d['bindingPinBefore'] and d['requestPinAfter']==d['requestPinBefore'];assert len(d['pairs'])==9;values=[]
for i,p in enumerate(d['pairs']):
 assert p['pair']==i and p['phase']==('warmup' if i<2 else 'measured');expected=['native-oneQ','native-batched'] if i%2==0 else ['native-batched','native-oneQ'];assert p['order']==expected and set(p['arms'])==set(expected)
 for arm in expected:
  ns=f'pairs/pair-{i:02d}-{arm}';f=j(ns+'/receipt/receipt.json');e=j(ns+'/exit.json');a=p['arms'][arm];assert e['exitCode']==0 and not e['timedOut'];assert f['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS';assert f['progress']['n']==f['progress']['q']==316562;assert f['workerBefore']==f['workerAfter'] and f['compiledBefore']==f['compiledAfter'] and f['buildBefore']==f['buildAfter'];assert f['inputSha256Before']==f['inputSha256After']==h((r/f'pairs/pair-{i:02d}-{arm}-input.json').read_bytes());assert j(ns+'/after-authentication.json')==j(f'pairs/pair-{i:02d}-{arm}-before.json');n=f['finalNative'];last=f['lastReturnedNative']
  for k in ['state','extra','segments','system','debug']:assert n[k]==last[k]==c['cuts'][-1]['native'][k]
  assert int(n['nativeTicks'])==int(n['successfulQuanta'])==316562 and last['activityState']==0 and len(last['sliceBytes'])==160;assert f['finalBoard']['state']['board']==c['javascriptFinal']['board'] and f['finalBoard']['ramSha256']==c['javascriptFinal']['ramSha256'];assert len(f['ports'])==16475
  for x,y in zip(f['ports'],c['javascriptPorts']):assert all(x[k]==y[k] for k in ['ordinal','dir','port','value','cycles']) and x['nativeTicks']==x['successfulQuanta']==y['q']-1
  raw=f['executionTiming'];cpu=sum(raw['cpuMicroseconds'].values())/1e6;wall=int(raw['wallNanoseconds'])/1e9;assert a['execution']['cpuSeconds']==cpu and a['execution']['wallSeconds']==wall;assert math.isclose(a['wholeChild']['cpuSeconds'],sum(e['rusage'][k] for k in ['ru_utime','ru_stime']));assert a['wholeChild']==e
 if i>=2:values.append((p['arms']['native-oneQ']['execution']['cpuSeconds'],p['arms']['native-batched']['execution']['cpuSeconds']))
b=statistics.mean(x[0] for x in values);v=statistics.mean(x[1] for x in values);reduction=1-v/b;s=d['summary'];assert b==s['baselineMeanExecutionCpuSeconds'] and v==s['candidateMeanExecutionCpuSeconds'] and math.isclose(reduction,s['meanCpuReduction']);assert all(y<x for x,y in values) and reduction>=.1 and s['quantitativeGatePass'];
for p,t in zip(d['pairs'][2:],s['rawRatios']):
 a=p['arms']['native-oneQ'];v1=p['arms']['native-batched'];
 for key,section,metric in [('executionCpuCandidateOverBaseline','execution','cpuSeconds'),('executionWallCandidateOverBaseline','execution','wallSeconds'),('wholeChildCpuCandidateOverBaseline','wholeChild','cpuSeconds'),('wholeChildWallCandidateOverBaseline','wholeChild','wallSeconds')]:assert math.isclose(t[key],v1[section][metric]/a[section][metric])
out={'status':'PASS_INDEPENDENT_NATIVE_ONEQ_V_BATCHED_PAIRED_AUDIT','officialMembers':len(z.infolist()),'children':18,'discardedWarmupPairs':2,'measuredPairs':7,'baselineMeanExecutionCpuSeconds':b,'candidateMeanExecutionCpuSeconds':v,'meanReduction':reduction,'executionCpuSpeedRatio':b/v,'favorablePairs':7,'gatePassed':True,'semanticProof':'All18 fullterminal166/NQ/wholeboard/rawRAMhash/full16475PIO/source-input-finalmaps exact','scope':'Native batching versus nativeoneQ only, configuredcold slice. No plainJS competitiveness, physical386 calibration/fullboot/adoption.'};(R/'independent-native-paired-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
