from pathlib import Path
import json,hashlib,zipfile,subprocess
D=Path(__file__).resolve().parent;A=D/'artifact/owned-span-source-controls-pr-256-37047476650-1';R=A/'_temp/owned-span-source-controls/result';C=A/'_temp/owned-span-source-controls/context';P=A/'bw-board/bw-board/publication';packet=P/'docs/receipts/2026-10-02-owned-span-source-preparation';W='/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-source-ghci-20261002';checks=0
h=lambda b:hashlib.sha256(b).hexdigest();j=lambda p:json.loads(p.read_bytes())
def ck(x,n):
 global checks
 checks+=1
 assert x,n
run=j(D/'first-valid-source-run.json');head=run['head_sha'];ck(run['id']==37047476650 and run['conclusion']=='success' and run['event']=='pull_request' and run['run_attempt']==1,'official run')
meta=j(D/'first-valid-source-artifact.json');ck(meta['id']==11244763075 and meta['workflow_run']['head_sha']==head,'official artifact')
zp=D/'official-artifact-11244763075.zip';ck(zp.stat().st_size==73038 and h(zp.read_bytes())=='594ed08e363f556ba933df22c5778380d0371ac113917108b95f3c697eac85d7','official ZIP')
with zipfile.ZipFile(zp)as z:
 for m in z.infolist():
  ck(not m.filename.startswith('/') and '..' not in Path(m.filename).parts,'safe ZIP')
  if not m.is_dir():ck((D/'artifact'/m.filename).read_bytes()==z.read(m),'extracted exact')
e=j(R/'exit.json');out=j(R/'stdout.json');binding=j(packet/'source-binding.json');ctx=j(C/'context.json');expected={**binding['baselineSourceHashes'],**binding['newFiles']}
ck(len(expected)==110 and len(binding['baselineSourceHashes'])==103 and len(binding['newFiles'])==7,'110 source')
ck(e['sourceBefore']==e['sourceAfter']==e['sourceExpected']==expected,'parent full beforeafter')
ck(e['baselineGitHashes']==binding['baselineSourceHashes'],'parent actual103git')
for p,sha in binding['baselineSourceHashes'].items():ck(h(subprocess.check_output(['git','show','fe1eff2039520536350922a2164c8bbe29404c68:'+p],cwd=W))==sha,'independent103Git '+p)
for p,sha in binding['newFiles'].items():ck(h((packet/'payload'/(Path(p).name+'.payload')).read_bytes())==sha,'payload '+p)
for p,sha in ctx['helpers'].items():
 b=subprocess.check_output(['git','show',head+':'+p],cwd=W);ck(h(b)==sha,'actualhead helper '+p)
 if (P/p).exists():ck((P/p).read_bytes()==b,'uploaded helper exact')
ck(e['wrapperSha256']==e['wrapperSha256After']==binding['wrapper']['sha256'],'wrapper unchanged')
ck(e['bindingSha256Before']==e['bindingSha256After']==h((packet/'source-binding.json').read_bytes()),'binding unchanged')
ck(e['nodeSha256Before']==e['nodeSha256After']==binding['node']['sha256']==ctx['node']['sha256'],'Node unchanged')
ck(e['exitCode']==0 and not e['timedOut'] and e['childLaunched'] and e['status']=='SOURCE_ONLY_AUTHENTICATED_CONTROL_CHILD_AND_RESULT_PASS','actual child pass')
ck(e['limits']=={'cpuSeconds':120,'wallSeconds':120,'fileBytes':268435456,'coreBytes':0,'niceIncrement':10,'heapMiB':512} and all(v=='' for v in e['blankEnvironment'].values()),'bounds sixblank')
for n in ['stdout.json','stderr.txt']:ck(h((R/n).read_bytes())==e[n+'Sha256'],'stream '+n)
ck((R/'stderr.txt').stat().st_size==0,'empty stderr')
ck(out['sourceInputs']==out['sourceAfter']==expected and out['originalSourceCount']==103,'child full source maps')
ck(out['checks']==e['checks']==232337 and len(out['cases'])==e['caseCount']==10 and sum(c['checks'] for c in out['cases'])+1==out['checks'],'actual case accounting')
ck(out['providerSha256']==expected['scripts/bochs-cpu3-native-owned-span/provider.mjs'],'actual derived provider')
for n,s in out['testSeams'].items():ck(s['scope'].startswith('Test-only') and len(s['generatedSha256'])==64,'test-only capture inverse receipt')
r={'status':'PASS_INDEPENDENT_ACTUAL_SOURCE_ONLY_SPAN_CONTROLS','auditChecks':checks,'actualChecks':232337,'actualCases':out['cases'],'head':head,'runId':37047476650,'artifactId':11244763075,'sourceCount':110,'gitBaselineCount':103,'nodeWrapperBindingUnchanged':True,'elapsedWallResourceOnly':e['elapsedWallSecondsForResourceBoundOnly'],'scope':'Actual source-only board differential controls; no addon, native CPU guest, profile, performance or adoption qualification. Hidden workflow omitted from upload authenticated exact actualhead Git/context hash.'};p=D/'independent-actual-source-audit.json';assert not p.exists();p.write_text(json.dumps(r,indent=2)+'\n');print('PASS',checks,h(p.read_bytes()))
