import pathlib,json,zipfile,hashlib,math,statistics
R=pathlib.Path(__file__).parent;Z=R/'official-artifact.zip';h=lambda b:hashlib.sha256(b).hexdigest();assert Z.stat().st_size==42490189 and h(Z.read_bytes())=='b56b9dabb5ac6849f2532f37ddf1bf9807164cdfbb9888813ad232053d45d546';z=zipfile.ZipFile(Z)
for i in z.infolist():
 assert not i.filename.startswith('/') and '..' not in pathlib.PurePosixPath(i.filename).parts
 s=hashlib.sha256();size=0
 with z.open(i) as f:
  for b in iter(lambda:f.read(1<<20),b''):s.update(b);size+=len(b)
 assert size==i.file_size;p=R/'selected'/i.filename
 if p.is_file():assert h(p.read_bytes())==s.hexdigest()
prefix='cold-memory-fusion-paired/';j=lambda p:json.loads(z.read(prefix+p));rawbytes=lambda p:z.read(prefix+p);d=j('pairs/result.json');c=j('setup/capture.json');assert d['status']=='PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_FAIL_KEEP_BASELINE';assert d['finalAuthentication']==j('pairs/initial-authentication.json') and d['bindingPinAfter']==d['bindingPinBefore'] and d['requestPinAfter']==d['requestPinBefore'];assert len(d['pairs'])==9;values=[]
for i,p in enumerate(d['pairs']):
 assert p['pair']==i and p['phase']==('warmup' if i<2 else 'measured');expected=['plain-JS','fusion-batched'] if i%2==0 else ['fusion-batched','plain-JS'];assert p['order']==expected and set(p['arms'])==set(expected)
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
 if i>=2:values.append((p['arms']['plain-JS']['execution']['cpuSeconds'],p['arms']['fusion-batched']['execution']['cpuSeconds']))
b=statistics.mean(x[0] for x in values);v=statistics.mean(x[1] for x in values);reduction=1-v/b;s=d['summary'];assert math.isclose(b,s['baselineMeanExecutionCpuSeconds'],rel_tol=1e-14) and math.isclose(v,s['candidateMeanExecutionCpuSeconds'],rel_tol=1e-14) and math.isclose(reduction,s['meanCpuReduction']);assert all(y>x for x,y in values) and reduction<0 and not s['quantitativeGatePass'];
for p,t in zip(d['pairs'][2:],s['rawRatios']):
 a=p['arms']['plain-JS'];v1=p['arms']['fusion-batched'];
 for key,section,metric in [('executionCpuCandidateOverBaseline','execution','cpuSeconds'),('executionWallCandidateOverBaseline','execution','wallSeconds'),('wholeChildCpuCandidateOverBaseline','wholeChild','cpuSeconds'),('wholeChildWallCandidateOverBaseline','wholeChild','wallSeconds')]:assert math.isclose(t[key],v1[section][metric]/a[section][metric])
out={'status':'PASS_INDEPENDENT_PLAIN_JS_V_BATCHED_NEGATIVE_PAIRED_AUDIT','officialMembers':len(z.infolist()),'children':18,'discardedWarmupPairs':2,'measuredPairs':7,'baselineMeanExecutionCpuSeconds':b,'candidateMeanExecutionCpuSeconds':v,'meanReduction':reduction,'executionCpuSpeedRatio':b/v,'favorablePairs':0,'gatePassed':False,'semanticProof':'Nine native children reset/final/last-return166 and N/Q; nine JS representedCPU/Q; all18 fullboard/RAMhash/16475PIO/source-input-finalmaps exact','scope':'PlainJS beats nativebatched in all7 measured pairs. Separate nativeoneQ batchinggain unchanged. No physical386/fullboot/adoption.'};(R/'independent-fusion-paired-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
