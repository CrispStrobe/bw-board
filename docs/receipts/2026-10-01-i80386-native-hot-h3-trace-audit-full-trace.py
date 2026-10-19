#!/usr/bin/env python3
import json,pathlib,hashlib,subprocess,collections
b=pathlib.Path('/mnt/volume1/tmp-astra');out=b/'native-hot-h3-fulltrace-20261001';pair=out;trace=pair/'on.stderr';n=json.loads((pair/'on/capture.json').read_text());j=json.loads((b/'js-hot-formal-final-20261001/capture.json').read_text());wt=pathlib.Path('/tmp/bw-board-386-native-hot-property-keys-20261001')
seed="import {assembleCombinedHotRom} from './scripts/i80386-free-combined-hot.mjs';import {HotDirectBoardFacade} from './scripts/bochs-cpu3-native-hot-direct/board.mjs';process.stdout.write(new HotDirectBoardFacade(assembleCombinedHotRom().rom).machine.mem);"
mem=bytearray(subprocess.check_output(['node','--max-old-space-size=512','--input-type=module'],input=seed.encode(),cwd=wt));assert len(mem)==16777216
steps={};prev=0
for l in (b/'js-hot-formal-final-20261001/events.jsonl').open():
 r=json.loads(l)
 if r[0]=='STEP' and r[2]>prev:steps[r[2]]=r;prev=r[2]
indices={'ATTEMPT':4,'PREFETCH':3,'COMMIT':8,'ALIAS_UPDATE':9,'STAMP':6,'PREFETCH_INVALIDATE':7,'TLB_INVALIDATE':4,'TLB_OBSERVED':7,'MAP_COMMIT':6,'COHERENCE':6,'BOUNDARY':5,'FAULT_BEGIN':7,'FAULT_DELIVERED':8,'IRQ_ACK':5,'IRQ_DELIVERED':6,'IRQ_LINE':3,'QUANTUM':9,'NATIVE_TICK':4,'MEM':7,'EXEC':4,'PORT':5,'HALT_IDLE':6,'POST_STATE':22,'POST_EXTRA':22,'POST_SEG':17,'POST_SYS':17,'POST_DR':8}
counts=collections.Counter();boundaries=collections.Counter();groups=0;ordinal=0;N=Q=0;group=None;kind=None;attempt=None;reads=writes=0;traceHash=hashlib.sha256();repStaging=[];successCompared=0;deliveriesCompared=0;postKinds=collections.Counter();a20=True;ports=[];eaxCarry=None;eaxCarryRows=[];lineAsserted=0;lastFull=None;callbackSummary=None;fallbackSummary=None;closeRows=0
sequence=['POST_STATE','POST_EXTRA']+['POST_SEG']*6+['POST_SYS']*2+['POST_DR'];lengths={'POST_STATE':23,'POST_EXTRA':23,'POST_SEG':18,'POST_SYS':18,'POST_DR':9}
for lineno,line in enumerate(trace.open('rb'),1):
 traceHash.update(line)
 if not line.startswith(b'BWSD1\t'):
  assert b'BWSD1' not in line,(lineno,'broken prefix');continue
 assert line.endswith(b'\n') and line.count(b'BWSD1\t')==1,(lineno,'malformed merged row')
 parts=line.rstrip(b'\n').decode().split('\t');tag=parts[1];p=parts[2:];counts[tag]+=1
 if tag in indices:
  idx=indices[tag];assert len(p)>idx and p[idx].isdigit(),(lineno,tag,'ordinal field');actual=int(p[idx]);assert actual==ordinal+1,(lineno,tag,ordinal,actual);ordinal=actual
 if tag.startswith('POST_'):
  if tag=='POST_STATE':assert group is None;group={'fields':p,'rows':[],'kind':kind,'attempt':attempt};assert kind is not None
  assert group is not None and tag==sequence[len(group['rows'])],(lineno,'post group ordering');assert len(p)==lengths[tag];assert int(p[-3])==N and int(p[-2])==Q,(lineno,'POST N/Q');group['rows'].append((tag,p))
  if tag=='POST_SEG':assert int(p[0])==len(group['rows'])-3
  if tag=='POST_SYS':assert int(p[0])==len(group['rows'])-3
  if tag=='POST_DR':
   groups+=1;postKinds[group['kind']]+=1;state=[int(x,16) for x in group['fields'][:20]]
   extraHex={0,1,2,3,4,8,13,14,18,19};segmentHex={1,5,10,11}
   extra=[int(v,16 if i in extraHex else 10) for i,v in enumerate(group['rows'][1][1][:20])]
   segs=[[int(v,16 if i in segmentHex else 10) for i,v in enumerate(row[1][:15])] for row in group['rows'][2:8]]
   systems=[[int(v,16 if i in segmentHex else 10) for i,v in enumerate(row[1][:15])] for row in group['rows'][8:10]]
   debug=[int(v,16) for v in group['rows'][10][1][:6]]
   assert [x[1] for x in segs]==[extra[2],state[13],state[15],state[14],extra[3],extra[4]],'all raw selector mirrors'
   assert extra[5:8]==segs[1][2:5] and extra[8:18]==segs[1][5:15],'full CS attribute mirror'
   assert debug[4:6]==extra[:2] and debug==n['reset']['debug'],'raw debug mirror and unchanged source scope'
   assert sum(systems,[])==n['reset']['system'],'unchanged raw LDTR/TR full caches'
   assert extra[18]==(0x400 if lineAsserted else 0),'native staged INTR pending bit'
   assert extra[19]==(0x100 if state[9]&0x200 else 0xf40),'native IF event mask'
   lastFull={'state':state,'extra':extra,'segments':sum(segs,[]),'system':sum(systems,[]),'debug':debug}
   if group['kind'] in ['ordinary','rep-element']:
    s=steps[Q];observed=[state[13],state[8],state[0],state[3],state[1]];expected=[s[3],s[4],s[5],s[6],s[7]]
    if observed[2]!=expected[2] and eaxCarry is not None:
     assert (observed[2],expected[2])==eaxCarry,(lineno,'source MOV CR0 EAX carry',Q,observed,expected)
     eaxCarryRows.append({'Q':Q,'nativeEax':observed[2],'javascriptEax':expected[2]});expected[2]=observed[2]
    if observed!=expected:
     at=group['attempt'];assert group['kind']=='rep-element' and state[1]&65535 and at is not None and at[7]=='66f3ab',(lineno,'unexpected CPU mismatch',Q,observed,expected)
     assert observed[0]==expected[0] and observed[2:]==expected[2:] and expected[1]==int(at[1],16) and observed[1]==int(at[1],16)+int(at[6]),(lineno,'REP staging only',Q,observed,expected)
     repStaging.append({'Q':Q,'N':N,'nativeEip':observed[1],'javascriptEip':expected[1],'instructionBytes':at[7],'actualLength':int(at[6]),'postCX':state[1]&65535})
    successCompared+=1
   elif group['kind'] in ['fault-delivery','irq-delivery']:
    ds=[d for d in j['deliveries'] if d['q']==Q and d['kind']==('fault' if group['kind']=='fault-delivery' else 'irq')];assert len(ds)==1;d=ds[0]['cpu']
    for key,index in [('eax',0),('ecx',1),('ebx',3),('esp',4),('eip',8),('cr2',11),('cr3',12),('cs',13)]:assert state[index]==d[key],(lineno,key,'delivery CPU')
    assert state[2]==n['reset']['state'][2]==0 and d['edx']==j['reset']['cpu']['edx']==0x300,'retained raw reset EDX; guest never writes EDX'
    assert state[10]==0xfffffff1 and d['cr0']==0x80000011,'named CPU3 CR0 reserved-bit difference';deliveriesCompared+=1
   else:assert group['kind']=='prefetch-pagewalk'
   group=None;kind=None
 elif group is not None:assert False,(lineno,'record interleaved in full POST group',tag)
 if tag=='IRQ_LINE':
  lineAsserted=int(p[0]);assert lineAsserted in [0,1] and int(p[1])==N and int(p[2])==Q
 elif tag=='CALLBACKS':callbackSummary=[int(x) for x in p]
 elif tag=='FALLBACK':fallbackSummary=[int(x) for x in p]
 elif tag=='DEACTIVATE':assert p==['direct-close'];closeRows+=1
 elif tag=='STATE':assert [int(x,16) for x in p]==n['final']['state'],'terminal raw STATE mirror'
 elif tag=='NATIVE_TICK':assert len(p)==5 and int(p[0])==1 and int(p[1])==N and int(p[2])==N+1 and int(p[3])==Q;N+=1
 elif tag=='QUANTUM':assert len(p)==10 and int(p[6])==Q and int(p[7])==Q+1 and int(p[8])==N;Q+=1
 elif tag=='ATTEMPT':
  attempt=p
  if p[7]=='0f20c0' and Q<50:eaxCarry=(0x7ffffff0,0)
  elif eaxCarry is not None and p[7]=='b8ffff':eaxCarry=(0x7fffffff,0xffff)
  elif eaxCarry is not None and p[7]=='66b811000000':eaxCarry=None
 elif tag=='BOUNDARY':assert kind is None;kind=p[0];boundaries[kind]+=1;assert int(p[3])==N and int(p[4])==Q
 elif tag=='MEM':
  assert len(p)==11;raw=int(p[1],16);decoded=int(p[2],16);value=int(p[4],16);assert int(p[6])==N;assert decoded==((raw&0xffffff) if raw>=0xffff0000 else raw)&(0xffffffff if a20 else 0xffefffff),(lineno,'actual provider decode')
  if p[0]=='R':assert value==(mem[decoded] if p[3] in ['ram','rom'] else 255),(lineno,'actual native read byte',hex(raw),hex(decoded),value);reads+=1
  else:
   assert p[0]=='W';writes+=1
   if p[5]=='ram-commit':assert p[3]=='ram';mem[decoded]=value
   else:assert p[5] in ['rom-ignored','open-ignored']
 elif tag=='PORT':
  assert p[0]=='out';port=int(p[1],16);value=int(p[3],16);ports.append([Q,4+6*Q,port,value]);assert int(p[4])==N
  if port==0x60:a20=bool(value&2)
assert group is None and kind is None;assert N==int(n['final']['nativeTicks'])==100684 and Q==int(n['final']['successfulQuanta'])==100682
assert counts['QUANTUM']==Q and counts['NATIVE_TICK']==N;assert successCompared==Q and deliveriesCompared==3
assert closeRows==1 and n['closed']=={'native':True,'board':True}
for key,value in lastFull.items():assert value==n['final'][key],('full terminal NAPI mirror',key)
assert callbackSummary==[int(n['final']['callbacks'][key]) for key in ['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks']]
assert fallbackSummary==[int(n['final']['fallback'][key]) for key in ['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer']]==[0]*5
assert counts['POST_STATE']==counts['POST_EXTRA']==counts['POST_DR']==groups and counts['POST_SEG']==6*groups and counts['POST_SYS']==2*groups
nativeRam=hashlib.sha256(mem).hexdigest();assert nativeRam==n['ramSha256'];mem[0x510:0x518]=bytes([0,3,0,0,0,0,0,0]);normalized=hashlib.sha256(mem).hexdigest();assert normalized==j['final']['memorySha256']
jports=[[x['q'],x['cycles'],x['port'],x['value']] for x in j['ports']];assert ports==jports
report={'status':'PASS_FULL_REGULAR_FILE_TRACE_AND_BACKING_NOT_FULL_ARCHITECTURAL_JS_PARITY','tracePath':str(trace),'traceSha256':traceHash.hexdigest(),'traceBytes':trace.stat().st_size,'exactContiguousOrdinals':ordinal,'nativeTicks':N,'successfulQuanta':Q,'tagCounts':dict(counts),'boundaryKinds':dict(boundaries),'completePostGroups':groups,'fullNativeGroupSelectorCsCacheDebugSystemPendingIfMirrors':True,'fullTerminalNativeSnapshotCounterCloseBindings':True,'postGroupKinds':dict(postKinds),'selectedSuccessCpuComparisons':successCompared,'exactDeliveryCpuComparisons':deliveriesCompared,'sourceNamedPersistentEdxResetDifference':{'native':0,'javascript':0x300,'scope':'fixed guest only stores EDX, never modifies it'},'sourceNamedInitialMovCr0EaxCarry':eaxCarryRows,'sourceNamedNonfinalRepRipStaging':repStaging,'actualReadBytes':reads,'actualWriteBytes':writes,'nativeActualRamSha256':nativeRam,'auditCopyNamedResetWordTransformationSha256':normalized,'all26PioExact':True,'limitations':['JS STEP records contain CS/EIP/EAX/EBX/ECX only; additional native full-cache/system/debug fields are complete but cannot be asserted equal to unrecorded JS fields.','Three deliveries compare separately authenticated JS delivery snapshots, not same-number STEP rows.','Prefetch pagewalk POST groups are retained separately, never relabeled successful instructions.','Raw reset witness transformation applies only audit memory copy; actual capture remains unchanged.']}
p=out/'independent-regular-trace-audit.json';p.write_text(json.dumps(report,indent=2)+'\n');print(p);print(hashlib.sha256(p.read_bytes()).hexdigest())
