from pathlib import Path
import json,hashlib,ast
P=Path(__file__).resolve().parent;R=P/'fulltrace-on';j=lambda p:json.loads(p.read_bytes());h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();b=j(P/'approved-bindings.json');e=j(R/'execution.json');x=j(R/'child.exit.json');c=j(R/'guest/capture.json');ref=j(Path(b['baselineNativeCapture']));checks=0

def ck(a,label):
 global checks
 checks+=1
 assert a,label
ck(e['before']==e['after']==j(R/'auth-before.json')==j(R/'auth-after.json'),'recorded complete beforeafter')
tree=ast.parse((P/'run.py').read_text());tree.body=[n for n in tree.body if not isinstance(n,ast.If)];ns={'__file__':str(P/'run.py'),'__name__':'readonly_audit'};exec(compile(tree,str(P/'run.py'),'exec'),ns);ns['authenticate'](e['before'],b);ck(ns['snapshot'](b)==e['after'],'current complete auth exact')
ck(e['status']=='ONE_CELL_CHILD_PASS_INPUTS_UNCHANGED_AWAITING_FULL_PARITY_AUDIT' and x==e['childResult'],'actual exit record')
ck(x['returncode']==0 and x['signal'] is None and not x['timedOut'] and not x['fileLimitReached'] and x['error'] is None,'child exit bounds')
ck(x['RLIMIT_CPU']==120 and x['RLIMIT_FSIZE']==268435456 and x['heapMiB']==512 and x['niceIncrement']==10,'resource limits')
ck(all(v=='' for v in e['blankEnvironment'].values()),'six blank env')
ck(h(R/'child.stderr')==x['stderrSha256'] and (R/'child.stderr').stat().st_size==x['stderrBytes'],'stderr exact')
ck(h(R/'input.json')==e['inputSha256'],'input exact');inp=j(R/'input.json');ck(inp['nativeTrace'] is True and inp['hostJournal'] is True and len(inp)==12,'OFF only')
ck(c['source']=={'revision':b['revision'],'hashes':b['sourceHashes']},'runtime116 identity');ck(c['provenance']==b['expectedProvenance'],'full dual proof')
for k in ['reset','final','checkpoints','settled','in8Witness','ramSha256','resetWitness','ramCanonicalSha256','resumes','terminal','closed']:ck(c[k]==ref[k],'complete semantic '+k)
ck(c['resumes']==445 and len(c['checkpoints'])==6 and c['terminal'] and c['closed'],'445/six/terminal')
for snapshot in [c['reset'],c['final']]+[q['native'] for q in c['checkpoints']]:
 for k,n in [('state',20),('extra',20),('segments',90),('system',30),('debug',6)]:ck(len(snapshot[k])==n and all(type(v)is int and 0<=v<=0xffffffff for v in snapshot[k]),'all166 shape/domain')
ck((R/'guest/callbacks.jsonl').read_bytes()==Path(b['baselineNativeJournal']).read_bytes(),'whole journal exact')
ck(c['resetWitness']==[0,0,0,0,240,255,255,127] and int.from_bytes(bytes(c['resetWitness'][:4]),'little')==c['reset']['state'][2] and int.from_bytes(bytes(c['resetWitness'][4:]),'little')==c['reset']['state'][10],'exact own reset witness')
ck(c['ramCanonicalSha256']=='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f','canonical RAM')
proof=j(R/'parity.json');ck(proof['captureSha256']==h(R/'guest/capture.json') and proof['canonicalRows']==1649271,'OFF proof only')
from itertools import zip_longest
def canonical(path):
 with Path(path).open('rb') as f:
  for line in f:
   if line.startswith(b'BWSD1\t'):yield line
   elif b'BWSD1' in line:raise AssertionError('malformed canonical fragment')
rows=0
for x,y in zip_longest(canonical(R/'child.stderr'),canonical(b['baselineNativeTrace'])):
 ck(x is not None and x==y,'every canonical row exact');rows+=1
ck(rows==1649271,'canonical count')
clocks=[];n=q=ordinal=0
for line in (R/'guest/callbacks.jsonl').open():
 z=json.loads(line);ck(z[0]==ordinal+1,'journal ordinal');ordinal=z[0]
 if z[1]=='nativeTick':n+=1;clocks.append(('N',n,q))
 elif z[1]=='quantum':q+=1;clocks.append(('Q',z[2][0],n,q))
 ck(z[4:7]==[n,q,4+6*q],'journal ledgers')
rawclocks=[];ports=[]
for line in canonical(R/'child.stderr'):
 z=line.rstrip(b'\n').split(b'\t')
 if z[1]==b'NATIVE_TICK':rawclocks.append(('N',int(z[4]),int(z[5])))
 elif z[1]==b'QUANTUM':rawclocks.append(('Q',int(z[2]),int(z[10]),int(z[9])))
 elif z[1]==b'PORT':ports.append(z)
ck(rawclocks==clocks and len(clocks)==201390,'ordered kinds/NQ exact')
js=j(Path(b['baseline']));ck(len(ports)==len(js['ports'])==32,'PIO count')
for z,event in zip(ports,js['ports']):ck(z[2].decode()==event['dir'] and int(z[3],16)==event['port'] and int(z[4])==1 and int(z[5],16)==event['value'] and int(z[6])==event['attempts']-1,'each PIO exact')
out={'status':'PASS_INDEPENDENT_ACTUAL_SPAN_CAPTURE_ON_CANONICAL_AND_STATE_NOT_SPEED','checks':checks,'sourceRevision':b['revision'],'runtimeSourceCount':116,'compiledSourceCount':103,'artifactCount':len(b['artifactHashes']),'captureSha256':h(R/'guest/capture.json'),'bindingSha256':h(P/'approved-bindings.json'),'scope':'ActualON: entire retained166/native descriptors/counters, six fullboards, RAM/resetwitness/physicalcounts exact qualifiedfe1; fullsnapshot produced445resumes but eight retained. Tracefast not run; no speed/adoption qualification.'};p=R/'independent-audit.json';assert not p.exists();p.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out));print(h(p))
