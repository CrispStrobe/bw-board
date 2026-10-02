"""Pure source checks, never executes run.py/parity.py mains or native code."""
import ast,json,pathlib,hashlib
P=pathlib.Path(__file__).parent;sha=lambda b:hashlib.sha256(b).hexdigest();d=json.loads((P/'derivation.json').read_text());checks=[]
for name,v in d['files'].items():
 source=(P/name).read_text();ast.parse(source);inverse=source
 for seam in reversed(v['seams']):assert inverse.count(seam['after'])==1;inverse=inverse.replace(seam['after'],seam['before'])
 assert inverse==(P/'original'/name).read_text();assert sha(source.encode())==v['derivedSha256'];assert sha((P/'original'/name).read_bytes())==v['originalSha256'];checks.append(name+' exact inverse')
A=json.loads((P/'binding-template.json').read_text());assert len(A['sourceHashes'])==122 and len(A['compiledSourceHashes'])==111;assert all(A['sourceHashes'][p]==h for p,h in A['compiledSourceHashes'].items());assert A['revision']=='3792a908d81e04903974aa7d2bdc545e0713a290'and A['compiledRevision']=='a6f605280f778b2bc409ef97ac3b40e15874530c';assert A['buildInput']is None and A['expectedProvenance']is None;checks.append('distinct real frozen122/111 maps and incomplete execution fields')
ref=pathlib.Path(A['baseline']);raw=ref.read_bytes();assert sha(raw)=='fdca8f8fa92952cd9cd5f4447e66b194a5f691025bcf925f7ddd443290143346';js=json.loads(raw);assert js['attempts']==100702 and js['q']==100700 and len(js['ports'])==35;ins=[p for p in js['ports']if p['dir']=='in'];assert [(p['port'],p['value'])for p in ins]==[(0x21,255),(0xa1,255),(0x40,50),(0x40,18)];assert js['final']['picImrWitness']==[255,255];assert len(js['boundaries'])>=6;checks.append('authentic actual four-IN and35-PIO reference')
source=(P/'parity.py').read_text();tree=ast.parse(source);function=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='cpu');mapping={'eax':0,'ecx':1,'edx':2,'ebx':3,'esp':4,'eip':8,'cr0':10,'cr2':11,'cr3':12,'cs':13};scope={'mapping':mapping,'checks':0};exec(ast.get_source_segment(source,function),scope)
# Explicit synthetic profile-validator fixture only; not native state evidence.
expected=js['reset']['cpu'];actual={k:[0]*n for k,n in [('state',20),('extra',20),('segments',90),('system',30),('debug',6)]};actual['fallback']={'synthetic':0}
for k,index in mapping.items():actual['state'][index]=expected[k]
actual['state'][2]=0;actual['state'][10]=0x7ffffff0;scope['cpu'](actual,expected,True);checks.append('synthetic exact eight-plus-two reset policy positive')
for label,index,value in [('EDX',2,0x300),('CR0',10,0x7ffffff1),('EIP',8,actual['state'][8]^1)]:
 wrong=json.loads(json.dumps(actual));wrong['state'][index]=value
 try:scope['cpu'](wrong,expected,True)
 except AssertionError:checks.append(label+' profile corruption denied')
 else:raise AssertionError(label+' corruption admitted')
assert "assert len(ins)==4"in source and "assert len(portIns)==4"in source and 'canonicalClocks==journalClocks'in source;checks.append('four-IN full canonical/journal requirements retained')
print(json.dumps({'status':'PURE_PIC_QUALIFICATION_HELPER_SOURCE_CONTROLS_PASS_NO_NATIVE_EXECUTION','checks':checks,'count':len(checks)}))
