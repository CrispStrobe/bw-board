import pathlib,json,hashlib,subprocess,collections
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-owned-clock-replay-20261002');T=P.parent;checks=0
read=lambda p:json.loads(pathlib.Path(p).read_bytes())
def sha(p):
 with pathlib.Path(p).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def check(v,l):
 global checks
 assert v,l;checks+=1
r=read(P/'replay.stdout');e=read(P/'exit.json');a=read(P/'auth-before.json');freeze=read(T/'owned-clock-replay-source-20261002/source-freeze.json');check((P/'auth-before.json').read_bytes()==(P/'auth-after.json').read_bytes(),'auth bytes');check(e['exitCode']==0 and e['timedOut'] is False,'normal replay completion');check((P/'replay.stderr').read_bytes()==b'','empty stderr')
for n,v in e['streams'].items():check((P/n).stat().st_size==v['bytes'] and sha(P/n)==v['sha256'],'actual process '+n)
check(sha(P/'replay.stdout')=='6e3ca34a556644f48dd726f24892ff357e491e84cce4e002292d8659838544d5','approved stdout');check(sha(T/'owned-clock-root-replay-run-20261002.py')==a['helperSha256'],'root helper')
rev='a46083c0e7792aa4e9ee1923bcaf6a2eb5870e0d';check(r['source']['revision']==e['sourceRevision']==a['revision']==freeze['revision']==rev,'frozen replay identity');check(r['source']['files']==len(r['source']['hashes'])==51,'actual51');check(r['source']['hashes']==freeze['sourceClosureHashes'],'freeze closure');check(subprocess.check_output(['git','rev-parse','HEAD'],cwd=W,text=True).strip()==rev,'currenthead');check(not subprocess.check_output(['git','status','--porcelain'],cwd=W).strip(),'clean')
for n,h in r['source']['hashes'].items():check(sha(W/n)==h,'source '+n);check(hashlib.sha256(subprocess.check_output(['git','show',rev+':'+n],cwd=W)).hexdigest()==h,'historical '+n)
for n,h in freeze['newPaths'].items():check(r['source']['hashes'][n]==h,'six frozen newpaths '+n)
inputs=r['inputs'];check(sha('/mnt/volume1/tmp-astra/native-hot-clock-fenced-capture-20261002/offline-inputs.json')==a['inputsSha256']==e['command'][-1],'input manifest binding')
for k,v in inputs.items():check(v['path']==a['inputs'][k]['path'] and v['sha256']==a['inputs'][k]['sha256']==sha(v['path']) and pathlib.Path(v['path']).stat().st_size==a['inputs'][k]['bytes'],'input '+k)
c=read(inputs['capture']['path']);f=[json.loads(l) for l in pathlib.Path(inputs['fences']['path']).read_text().splitlines()];h=[json.loads(l) for l in pathlib.Path(inputs['journal']['path']).read_text().splitlines()]
check(r['referenceNativeEvidence']['addon']==c['addon'] and r['referenceNativeEvidence']['driverSource']==c['source'],'prior native evidence separated');check(c['source']['revision']=='2d1cf651d7d7d0dfda55b9df482cf0ec70d9187c' and len(c['source']['hashes'])==67,'prior67diagnostic');check(c['addon']['sha256']=='5257a116734fb813b3ef9df31666eea0b41753d344f5c928b312765c0c497cd4','held native artifact reference')
check(r['status']=='SOURCE_ONLY_OWNED_REAL_BOARD_HISTORICAL_REPLAY_PASS','honest status');check('No native addon or CPU execution' in r['scope'],'no CPU claim');check(r['resumes']==c['resumes']==439,'439');check(r['logicalRows']==len(h)==c['journal']['rows']==209839,'209839');check(r['journalSha256']==c['journal']['sha256']==inputs['journal']['sha256']=='bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1','bf12');check(r['ramSha256']==c['ramSha256']=='7aecf019a32f109760267d6ac1c60ef3d8793661910226cca3bcf5661189c38d','entire RAM')
check(r['checkpoints']==[x['name'] for x in c['checkpoints']] and len(r['checkpoints'])==6,'six exact named checkpoints');check(len(f)==1326 and hashlib.sha256(pathlib.Path(inputs['fences']['path']).read_bytes()).hexdigest()==c['fenceCapture']['sha256'],'actual fences')
groups=0;clockRows=0;n=0;q=0;entries=[x for x in f if x['phase']=='entry'];returns=[x for x in f if x['phase']=='return'];check(len(entries)==len(returns)==439,'all resume slices');ordinal=0
for entry,exit in zip(entries,returns):
 check(entry['hostOrdinal']==ordinal and entry['resume']==exit['resume'],'contiguous replay slices');isClock=False
 for row in h[entry['hostOrdinal']:exit['hostOrdinal']]:
  ordinal+=1;check(row[0]==ordinal,'exact row ordinal');op=row[1];clock=op in ['quantum','nativeTick']
  if clock and not isClock:groups+=1
  if clock:clockRows+=1
  if op=='quantum':q+=1
  if op=='nativeTick':n+=1
  check(row[4]==n and row[5]==q and row[6]==4+6*q,'independentNQ/clockchronology');isClock=clock
 check(exit['n']==n and exit['q']==q,'resumeledger mirror')
check(groups==r['orderedClockGroups']==8738,'derived ordered replay groups');check(clockRows==201366 and n==100684 and q==100682,'independent totals');check(ordinal==209839,'complete replay slicing')
focused=(T/'owned-clock-replay-source-20261002/focused-109.stdout').read_text();check('# tests 109' in focused and '# pass 109' in focused and '# skipped 0' in focused and '# fail 0' in focused,'109 focused source controls')
out={'status':'INDEPENDENT_ACTUAL_OWNED_WORKER_HISTORICAL_REPLAY_RECEIPT_AND_SOURCE_AUDIT_PASS','checks':checks,'auditScriptSha256':sha(pathlib.Path(__file__)),'sourceRevision':rev,'sourceClosureCount':51,'resumes':439,'logicalRows':209839,'independentNativeTicks':n,'independentSuccessfulQuanta':q,'orderedReplayClockGroups':groups,'checkpoints':r['checkpoints'],'stdoutSha256':sha(P/'replay.stdout'),'journalSha256':r['journalSha256'],'ramSha256':r['ramSha256'],'referenceTraceBytes':pathlib.Path(inputs['trace']['path']).stat().st_size,'scope':'Read-only artifact/source/calculation audit of ONE prior root real-board replay; no replay repeat, native addon/CPU/guest/build/benchmark. Source-owned real host effects, not legal native span/crossing/CPU/performance evidence.'};(P/'independent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
