import pathlib,json,hashlib
P=pathlib.Path(__file__).parent;R=P/'native-actual';O=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-in8-terminal-diagnostic-20261002/native-actual');J=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-in8-source-r3-20261002/js-reference');n=0
H=lambda b:hashlib.sha256(b).hexdigest()
def ck(x):
 global n
 assert x;n+=1
a=json.loads((R/'guest/diagnostic-terminal.json').read_bytes());o=json.loads((O/'guest/diagnostic-terminal.json').read_bytes());js=json.loads((J/'capture.json').read_bytes());e=json.loads((R/'diagnostic-exit.json').read_bytes());ck(e['returncode']==1 and not e['timedOut']and not e['fileLimitReached']);ck(json.loads((R/'auth-before.json').read_bytes())==json.loads((R/'auth-after.json').read_bytes()))
for k in ['source','provenance','reset','final','resumes','terminal','checkpoints','expected']:ck(a[k]==o[k])
for k in ['state','in8Witness','ramSha256']:ck(a['settled'][k]==o['settled'][k])
ck((R/'guest/diagnostic-ram.bin').read_bytes()==(O/'guest/diagnostic-ram.bin').read_bytes());ck(a['settled']['in8Witness']==[50,18]);ck(a['resumes']>0)
expected=[];prev=0
for l in (J/'events.jsonl').open():
 x=json.loads(l)
 if x[0]=='STEP':ck(x[2]-prev in [0,1]);expected.extend(['Q']*(x[2]-prev));expected.append('N');prev=x[2]
clocks=[];ins=[];N=Q=ordinal=0;jb=(R/'guest/callbacks.jsonl').read_bytes();ck(H(jb)==a['settled']['journal']['sha256']);ck(len(jb)==a['settled']['journal']['bytes'])
for l in jb.splitlines():
 x=json.loads(l);ck(x[0]==ordinal+1);ordinal=x[0]
 if x[1]=='nativeTick':N+=1;clocks.append(('N',N,Q))
 elif x[1]=='quantum':Q+=1;clocks.append(('Q',x[2][0],N,Q))
 elif x[1]=='inPort':ins.append(x)
 ck(x[4]==N and x[5]==Q and x[6]==4+6*Q)
ck([x[0]for x in clocks]==expected);ck(N==100696 and Q==100694);ck(len(ins)==2)
canonical=[];ports=[];rows=0
with (R/'child.stderr').open('rb')as f:
 for l in f:
  if not l.startswith(b'BWSD1\t'):continue
  rows+=1;x=l.rstrip(b'\n').split(b'\t')
  if x[1]==b'NATIVE_TICK':canonical.append(('N',int(x[4]),int(x[5])))
  elif x[1]==b'QUANTUM':canonical.append(('Q',int(x[2]),int(x[10]),int(x[9])))
  elif x[1]==b'PORT':ports.append(x)
ck(canonical==clocks);ck(len(ports)==len(js['ports'])==32)
for x,y in zip(ports,js['ports']):ck(x[2].decode()==y['dir']);ck(int(x[3],16)==y['port']);ck(int(x[4])==1);ck(int(x[5],16)==y['value']);ck(int(x[6])==y['attempts']-1)
for x,y in zip(ins,[x for x in js['ports']if x['dir']=='in']):ck(x[2]==[y['port'],1]);ck(x[3]['value']==y['value']);ck(x[4:7]==[y['attempts']-1,y['q'],y['cycles']])
A=json.loads((P/'approved-bindings.json').read_bytes())
for f,h in A['artifactHashes'].items():ck(H(pathlib.Path(f).read_bytes())==h)
for f,h in A['helperHashes'].items():ck(H((P/f).read_bytes())==h)
out={'status':'PASS_IN8_CAPON_DIAGNOSTIC_FULL_STATE_AND_LOGICAL_CHRONOLOGY_NOT_PRODUCTION_QUALIFICATION','checks':n,'canonicalRows':rows,'journalRows':ordinal,'clockRows':len(clocks),'rawTraceSha256':H((R/'child.stderr').read_bytes()),'sourceRevision':a['source']['revision'],'scope':'Whole stored166-native-word snapshots/descriptors/physicalcounts andRAM exact vsCAPOFF diagnostic; nativecanonical↔journal ordered clock/kind tuples exact; source-boundQthenN outcomes and32PIO currentattempt-minus1 exactJS. OriginalRAMassertionexit1 preserved; explicitresetprofile95check separate. No rerun.'};(P/'independent-actual-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
