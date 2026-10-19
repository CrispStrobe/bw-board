from pathlib import Path
import json,hashlib,subprocess
D=Path(__file__).resolve().parent;P=D/'files/owned-baseline-profile';W=Path('/tmp/bw-board-386-native-owned-in8-r3-20261002');GW=Path('/tmp/bw-board-386-baseline-profile-publication-20261002');j=lambda p:json.loads(p.read_bytes());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();digest=lambda b:hashlib.sha256(b).hexdigest();checks=0
def ck(v):
 global checks
 assert v;checks+=1
run=j(D/'run.json');meta=j(D/'artifact-metadata.json');ck(run['head_sha']=='6ccb89042c601bdd9c6598adf642a8b06a1cfcd1' and run['conclusion']=='success');ck(meta['id']==11237781906 and meta['workflow_run']['id']==37031895458);ck(sha(D/'official-build.zip')=='09ceafcd30f8deae85df8cf96ac10fca9e98fc4362ed8ab12049ee1ad4c0c544')
a=j(P/'auth-before.json');ck(a==j(P/'auth-after.json'));ck(len(a)==1124)
for name,h in a.items():
 if '/baseline/'in name:ck(sha(W/name.split('/baseline/',1)[1])==h)
 elif '/publication/'in name:ck(digest(subprocess.check_output(['git','show',run['head_sha']+':'+name.split('/publication/',1)[1]],cwd=GW))==h)
 elif '/owned-baseline-profile/'in name:ck(sha(P/name.split('/owned-baseline-profile/',1)[1])==h)
 elif '/owned-bulk-context/'in name:ck(sha(D/'files/owned-bulk-context'/name.split('/owned-bulk-context/',1)[1])==h)
 elif name.endswith('/original-build.zip'):ck(h=='0335f4c5088280cfcdf00186f5e0ca59ff431442edc3a978dd26b7dc2341a0e0')
 else:raise AssertionError(name)
c=j(P/'profile/guest/capture.json');ref=json.loads(subprocess.check_output(['git','show',run['head_sha']+':scripts/owned-clock-bulk-ci/reference.json'],cwd=GW));ck(c['source']==ref['source']);ck(len(c['source']['hashes'])==103);ck(c['provenance']==j(P/'restored/source-admission.stdout')['provenance'])
for key in ['reset','final','checkpoints','settled','ramSha256','resetWitness','ramCanonicalSha256','in8Witness','resumes','terminal','closed']:ck(c[key]==ref[key])
ck((P/'profile/guest/callbacks.jsonl').stat().st_size==0)
for n in [c['reset'],c['final']]+[v['native']for v in c['checkpoints']]:
 for key,count in [('state',20),('extra',20),('segments',90),('system',30),('debug',6)]:ck(len(n[key])==count and all(type(v)is int and 0<=v<=0xffffffff for v in n[key]))
s=j(P/'summary.json');raw=j(P/'profile/guest/profile.cpuprofile');ph=j(P/'profile/guest/profile-phases.json');al=j(P/'alignment.json');der=j(P/'profile/derivation.json');manifest=j(P/'diagnostic-manifest.json');ck(s['captureSha256']==sha(P/'profile/guest/capture.json'));ck(s['profileSha256']==sha(P/'profile/guest/profile.cpuprofile'));ck(s['alignmentSha256']==sha(P/'alignment.json'));ck(s['derivationSha256']==sha(P/'profile/derivation.json'));ck(c['profiling']['phases']==ph and c['profiling']['derivative']==der['identity']);ck(der['identity']['diagnosticManifest']==manifest and der['identity']['diagnosticManifestSha256']==sha(P/'diagnostic-manifest.json'))
text=(P/'profile/profile-runner.mjs').read_text()
for seam in reversed(der['seams']):ck(text.count(seam['after'])==1);text=text.replace(seam['after'],seam['before'])
ck(digest(text.encode())==der['originalSha256']==c['source']['hashes']['scripts/run-i80386-native-owned-in8.mjs'])
text=(P/'profile/profile-admission.mjs').read_text()
for before,after in reversed(der['admission']['seams']):ck(text.count(after)==1);text=text.replace(after,before)
ck(digest(text.encode())==der['admission']['originalSha256']==c['source']['hashes']['scripts/bochs-cpu3-native-owned-in8/admission.mjs'])
ck(al['status']=='NONGUEST_INSPECTOR_HRTIME_DOMAIN_PASS' and al['node']=='v22.23.3');ck(al['beforeStart']<=al['afterStart']<=al['beforeStop']<=al['afterStop']);ck(al['beforeStart']-1000<=al['profile']['startTime']<=al['afterStart']+1000);ck(al['beforeStop']-1000<=al['profile']['endTime']<=al['afterStop']+1000)
keys=['setupBeginUs','startCallBeginUs','startCallEndUs','executionBeginUs','executionEndUs','stopCallBeginUs','stopCallEndUs'];values=[ph[k]for k in keys];ck(all(type(v)is int and 0<=v<=2**53-1 for v in values));ck(values==sorted(values));ck(raw['startTime']<=ph['executionBeginUs']<ph['executionEndUs']<=raw['endTime']);ck(len(raw['samples'])==len(raw['timeDeltas']));ids=[n['id']for n in raw['nodes']];ck(len(ids)==len(set(ids)));stamp=raw['startTime'];selected=[]
for i,(sample,delta)in enumerate(zip(raw['samples'],raw['timeDeltas'])):
 ck(type(delta)is int and delta>=0 and sample in ids);stamp+=delta;ck(stamp<=raw['endTime'] and stamp<=2**53-1)
 if ph['executionBeginUs']<=stamp<=ph['executionEndUs']:selected.append(i)
ck(selected==s['executionSampleIndices'] and len(selected)==s['executionSampleCount']==111);ck(len(raw['samples'])==s['sampleCount']==112)
for label in ['alignment','derive','restore','profile-child-parent']:
 x=j(P/(label+'.exit.json'));ck(x['returncode']==0)
ex=j(P/'profile/child.exit.json');ck(ex['returncode']==0 and not ex['timedOut'] and not ex['fileLimitReached']);ck(ex['stderrSha256']==sha(P/'profile/child.stderr'))
out={'status':'PASS_ACTUAL_BASELINE_INSPECTOR_DIAGNOSTIC_BINDINGS_FULL_STATE_AND_SAMPLE_WINDOW','checks':checks,'artifactId':11237781906,'runId':37031895458,'authPins':1124,'rawSamples':112,'executionSamples':111,'captureSha256':s['captureSha256'],'profileSha256':s['profileSha256'],'scope':'Official fixed-head artifact and unchanged source/artifact pins, frozen103 native provenance, exact inverse derivative, whole reference reset/final/six checkpoints/boards/rawcanonicalRAM/physical state, actual nonguest alignment and raw profile sample-domain/window independently verified. Qualitative isolate samples only, no all-thread CPU shares, native core/NAPI split or speed proof. No additional guest/profile executed.'};q=D/'independent-actual-profile-audit.json';assert not q.exists();q.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
