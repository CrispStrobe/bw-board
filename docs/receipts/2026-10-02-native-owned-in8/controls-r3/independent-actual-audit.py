import pathlib,json,hashlib,subprocess
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-owned-in8-r2-20261002');n=0
H=lambda b:hashlib.sha256(b).hexdigest()
def ck(x):
 global n
 assert x;n+=1
s=json.loads((P/'summary.json').read_bytes());a=json.loads((P/'approved-bindings.json').read_bytes());before=json.loads((P/'auth-before.json').read_bytes());after=json.loads((P/'auth-after.json').read_bytes());ck(before==after);ck(len(s['records'])==24);ck(s['status']=='IN8_NATIVE_GUARD_CONTROLS_PASS_NOT_FULL_QUALIFICATION')
for f,h in a['sourceHashes'].items():ck(H((W/f).read_bytes())==h);ck(H(subprocess.check_output(['git','show',a['revision']+':'+f],cwd=W))==h)
for f,h in a['artifactHashes'].items():ck(H(pathlib.Path(f).read_bytes())==h)
for f,h in a['helperHashes'].items():ck(H((P/f).read_bytes())==h)
for r in s['records']:
 name=r['control'];e=json.loads((P/(name+'-child.exit.json')).read_bytes());events=[json.loads(x)for x in (P/name/'events.jsonl').read_text().splitlines()];raw=(P/(name+'-child.stderr')).read_bytes();names=[x['name']for x in events]
 ck(e==r['exit']);ck(events==r['events']);ck(H(raw)==e['stderrSha256']==r['stderrSha256']);ck(not e['timedOut'] and not e['fileLimitReached']);ck([x['ordinal']for x in events]==list(range(1,len(events)+1)))
 if name.startswith(('clock-','memory-','in-reply-')):
  ck(e['signal']==6);ck(not set(names)&{'observer-after-attack','unexpected-nested-success','unexpected-resume-return','done'})
  if name.startswith('in-reply-'):
   effect=next(x for x in events if x['name']=='actual-IN-read-effect');mutation=next(x for x in events if x['name']=='mutation-after-IN-effect');ck(effect['value']==50 and effect['n']==17 and effect['q']==17);ck(effect['ordinal']<mutation['ordinal']);ck(mutation['logicalAfter']==mutation['logicalBefore']+1);ck(b'BWSD1\tPORT\tin\t'not in raw);tag=b'owned-IN8-reply'if name in ['in-reply-byte','in-reply-epoch','in-reply-a20']else b'owned-IN8-callback';ck(b'BWSD1\tFAIL\t'+tag+b'\n'in raw)
   rows=[x.split(b'\t')for x in raw.splitlines()if x.startswith(b'BWSD1\t')];qs=[x for x in rows if len(x)==12 and x[1]==b'QUANTUM'];ck(bool(qs));ck(max(int(x[9])for x in qs)==17);ck(not any(int(x[10])>=17 for x in qs));ck(any(x[1:6]==[b'ATTEMPT',b'f000',b'00000122',b'17',b'17']and x[9]==b'e440'for x in rows if len(x)>9))
  else:
   tag=b'owned-transfer-callback'if name.startswith('clock-')else b'direct-memory-callback';ck(b'BWSD1\tFAIL\t'+tag+b'\n'in raw);effect=next(x for x in events if x['name']=='attack-before-effect');denial=next(x for x in events if x['name']=='nested-denied');ck(effect['logical']==denial['logical']);ck(effect['ordinal']<denial['ordinal'])
 else:ck(e['returncode']==0);ck(names[-1]=='done')
out={'status':'PASS_IN8_R3_24_ACTUAL_GUARD_CONTROLS_NOT_FULL_GUEST_QUALIFICATION','checks':n,'sourceRevision':a['revision'],'summarySha256':H((P/'summary.json').read_bytes()),'controls':24,'scope':'Actual fresh children,19 expected SIGABRT denials and5 normal denials; all9 corrupted replies follow real PIT byte50 completedN17/Q17 before noPORT/noQ fatal. No rollback/native guest or speed claim.'};(P/'independent-actual-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
