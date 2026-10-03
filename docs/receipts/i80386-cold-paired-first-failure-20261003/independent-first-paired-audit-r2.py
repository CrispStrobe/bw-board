import pathlib,json,hashlib,zipfile
R=pathlib.Path(__file__).parent;Z=R/'official-artifact.zip';h=lambda b:hashlib.sha256(b).hexdigest();assert Z.stat().st_size==38512612 and h(Z.read_bytes())=='12ae584a54d7ce2db79ae7108d87d1792b4cb3a8eaf768fe810579c2ca41d589';z=zipfile.ZipFile(Z)
for i in z.infolist():
 assert not i.filename.startswith('/') and '..' not in pathlib.PurePosixPath(i.filename).parts
 s=hashlib.sha256();size=0
 with z.open(i) as f:
  for b in iter(lambda:f.read(1<<20),b''):s.update(b);size+=len(b)
 assert size==i.file_size;p=R/'selected'/i.filename
 if p.is_file():assert h(p.read_bytes())==s.hexdigest()
r=R/'selected/_temp/cold-paired-performance';j=lambda p:json.loads((r/p).read_text());d=j('pairs/result.json');assert d['status']=='FAIL' and 'PosixPath' in d['error'] and 'finalizationError' not in d;assert d['finalAuthentication']==j('pairs/initial-authentication.json');assert d['bindingPinAfter']==d['bindingPinBefore'];assert d['requestPinAfter']==d['requestPinBefore'];assert len(d['pairs'])==1 and d['pairs'][0]['phase']=='warmup';assert list(d['pairs'][0]['arms'])==['native-oneQ'];f=j('pairs/pair-00-native-oneQ/receipt/receipt.json');c=j('setup/capture.json');e=j('pairs/pair-00-native-oneQ/exit.json');assert e['exitCode']==0 and not e['timedOut'];assert f['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS';assert f['progress']['n']==f['progress']['q']==316562;assert f['workerBefore']==f['workerAfter'] and f['compiledBefore']==f['compiledAfter'];assert f['inputSha256Before']==f['inputSha256After'];n=f['finalNative'];last=f['lastReturnedNative'];
for k in ['state','extra','segments','system','debug']:assert n[k]==last[k]==c['cuts'][-1]['native'][k]
assert last['activityState']==0 and last['chargedNativeTicks']==last['chargedQuanta']==1 and len(last['sliceBytes'])==160;assert f['finalBoard']['state']['board']==c['javascriptFinal']['board'] and f['finalBoard']['ramSha256']==c['javascriptFinal']['ramSha256'];assert len(f['ports'])==16475
for a,b in zip(f['ports'],c['javascriptPorts']):assert all(a[k]==b[k] for k in ['ordinal','dir','port','value','cycles']) and a['nativeTicks']==a['successfulQuanta']==b['q']-1
out={'status':'PASS_INDEPENDENT_INCOMPLETE_FIRST_PAIRED_AUDIT','officialMembers':len(z.infolist()),'completedChildren':1,'completedWarmupArms':['native-oneQ'],'measuredPairs':0,'cause':'Parent progress filename joins Path then adds str; fails after first warmup child terminal validation.','terminalSemanticEvidence':'FirstoneQ full166/NQ/board/RAMhash/full16475PIO exact to eighth','finalAuthenticationExact':True,'scope':'No complete warmup pair or measured speed result. No retry or secondcomparison.'};(R/'independent-first-paired-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
