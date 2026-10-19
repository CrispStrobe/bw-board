from pathlib import Path
import json,hashlib,sys,itertools
P=Path(__file__).resolve().parent;mode=sys.argv[1];assert mode in ['smoke-off','fulltrace-on','trace-fast'];R=P/mode;j=lambda p:json.loads(p.read_bytes());h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();A=j(P/'approved-bindings.json');c=j(R/'guest/capture.json');base=j(Path(A['baselineNativeCapture']));js=j(Path(A['baseline']));checks=0
def ck(v):
 global checks
 assert v;checks+=1
ck(h(P/'approved-bindings.json')=='9a2ade3a06cb974ffd451f6ac80dcc9e8d11e6078553b2ef47a88066326b1e5c');ck(j(R/'auth-before.json')==j(R/'auth-after.json'))
for n,v in A['artifactHashes'].items():ck(h(Path(n))==v)
for n,v in A['helperHashes'].items():ck(h(P/n)==v)
ck(c['source']=={'revision':A['revision'],'hashes':A['sourceHashes']});ck(c['provenance']==A['expectedProvenance']);ck(c['provenance']['compiled']['hashes']==A['compiledSourceHashes']);ck(c['addon']['sha256']==A['buildInput']['sha256']=='8d9c83fcc3c42c2c94d17782ae42c152c52fcb2e833c31decc4bfee2af5aa841')
ex=j(R/'child.exit.json');ck(ex['returncode']==0 and not ex['timedOut'] and not ex['fileLimitReached'] and ex['error']is None and ex['signal']is None);ck(h(R/'child.stderr')==ex['stderrSha256']);ck((R/'child.stderr').stat().st_size==ex['stderrBytes']);ck(ex['RLIMIT_CPU']==120 and ex['heapMiB']==512 and ex['niceIncrement']==10 and ex['RLIMIT_FSIZE']==268435456);ck(all(v==''for v in ex['blankEnvironment'].values()))
i=j(R/'input.json');ck(i['nativeTrace']==(mode!='smoke-off') and i['hostJournal']==(mode=='fulltrace-on'))
fields=['reset','final','checkpoints','settled','in8Witness','ramSha256','resetWitness','ramCanonicalSha256','resumes','terminal','closed']
for key in fields:ck(c[key]==base[key])
for n in [c['reset'],c['final']]+[v['native']for v in c['checkpoints']]:
 for key,count in [('state',20),('extra',20),('segments',90),('system',30),('debug',6)]:ck(len(n[key])==count and all(type(v)is int and 0<=v<=0xffffffff for v in n[key]))
ck(c['resetWitness']==[0,0,0,0,240,255,255,127]);ck(int.from_bytes(bytes(c['resetWitness'][:4]),'little')==c['reset']['state'][2]);ck(int.from_bytes(bytes(c['resetWitness'][4:]),'little')==c['reset']['state'][10]);ck(c['ramCanonicalSha256']=='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f');ck(c['ramSha256']=='ecb57a4b83090fcf232c4bd2f7019cdfde992bdc8ecf708e04bdc1de9272733a');ck(c['in8Witness']==[50,18]);ck(int(c['final']['nativeTicks'])==100696 and int(c['final']['successfulQuanta'])==100694)
ck([x['name']for x in c['checkpoints']]==['hot_profile_start','hot_register_loop','hot_register_end','hot_memory_loop','hot_memory_end','terminal_hlt'])
for actual,expected,reset in [(c['reset'],js['reset']['cpu'],True),(c['final'],js['final']['cpu'],False)]+[(x['native'],js['boundaries'][x['name']]['cpu'],False)for x in c['checkpoints']]:
 for k,index in {'eax':0,'ecx':1,'ebx':3,'esp':4,'eip':8,'cr2':11,'cr3':12,'cs':13}.items():ck(actual['state'][index]==expected[k])
 ck(actual['state'][2]==0 and expected['edx']==768);ck(actual['state'][10]==((expected['cr0']|0x7ffffff0)&0xffffffff));ck(expected['cr0']==(0 if reset else 0x80000011))
for x in c['checkpoints']:ck(x['board']['board']==js['boundaries'][x['name']]['board'])
ck(c['settled']['board']==js['final']['board']);words=int(c['final']['clockTransfers']['words']);ck(words==201390);ph=c['final']['clockTransfers'];ck(int(ph['transfers'])==int(ph['commits'])+1+c['resumes']+32)
rows=0
if mode!='smoke-off':
 def native(path):
  with path.open('rb')as f:
   for line in f:
    if line.startswith(b'BWSD1\t'):yield line
    elif b'BWSD1'in line:raise AssertionError('fragment')
 for actual,expected in itertools.zip_longest(native(R/'child.stderr'),native(Path(A['baselineNativeTrace']))):ck(actual is not None and actual==expected);rows+=1
 ck(rows==1649271)
if mode=='fulltrace-on':
 ck((R/'guest/callbacks.jsonl').read_bytes()==Path(A['baselineNativeJournal']).read_bytes());off=j(P/'smoke-off/guest/capture.json')
 for key in fields:ck(c[key]==off[key])
else:ck((R/'guest/callbacks.jsonl').stat().st_size==0)
out={'status':'PASS_ACTUAL_DISPATCH_'+mode.upper().replace('-','_')+'_EXACT_STATE_AND_CANONICAL_WHERE_ENABLED','checks':checks,'canonicalRows':rows,'runtimeInputs':112,'frozenDispatchInputs':106,'compiledInputs':103,'artifactPins':223,'resumes':c['resumes'],'captureSha256':h(R/'guest/capture.json'),'traceSha256':h(R/'child.stderr'),'journalSha256':h(R/'guest/callbacks.jsonl'),'scope':'All full166 native snapshot/reset/final/sixcut/boards/counters/rawcanonicalRAM/physical fields exact qualifiedfe1 reference; source/provenance/input/streams/bounds/artifact auth verified. Traced modes everycanonicalrow exact; ON wholejournal and candidateOFF snapshots exact, nullsink traced mode source-backedfalse-to-null and emptyjournal. Eight recordedJS CPU fields plus exact EDX/CR0 resetprofile only. No speed/adoption/generalAT claim; no extra native execution.'};q=R/'independent-audit.json';assert not q.exists();q.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))
