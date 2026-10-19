# Read-only audit after root-authorized cells. Full snapshots never projected away.
import pathlib,json,hashlib,sys
P=pathlib.Path(__file__).parent;label=sys.argv[1];assert label in ['smoke-off','fulltrace-on'];R=P/label
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();approved=json.loads((P/'approved-bindings.json').read_bytes());ref=pathlib.Path(approved['baseline']);assert sha(ref)=='bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e';js=json.loads(ref.read_bytes());a=json.loads((R/'guest/capture.json').read_bytes());assert a['source']=={'revision':approved['revision'],'hashes':approved['sourceHashes']}
# PIO occurs within current JS attempt before native postinstruction tick: completedN=attempts-1.
mapping={'eax':0,'ecx':1,'edx':2,'ebx':3,'esp':4,'eip':8,'cr0':10,'cr2':11,'cr3':12,'cs':13};checks=0
def cpu(actual,expected,reset=False):
 global checks
 for k,index in mapping.items():
  if k not in ['edx','cr0']:assert actual['state'][index]==expected[k],k
  checks+=1
 assert actual['state'][2]==0 and expected['edx']==0x300
 assert actual['state'][10]==(0x7ffffff0 if reset else 0xfffffff1) and expected['cr0']==(0 if reset else 0x80000011)
 assert actual['state'][10]==((expected['cr0']|0x7ffffff0)&0xffffffff)
 for k,n in [('state',20),('extra',20),('segments',90),('system',30),('debug',6)]:assert len(actual[k])==n;assert all(type(v)is int and 0<=v<=0xffffffff for v in actual[k]);checks+=n
 assert all(int(v)==0 for v in actual['fallback'].values())
cpu(a['reset'],js['reset']['cpu'],reset=True);assert a['terminal'] and a['resumes']>0 and len(a['checkpoints'])==6
assert [cut['name'] for cut in a['checkpoints']]==['hot_profile_start','hot_register_loop','hot_register_end','hot_memory_loop','hot_memory_end','terminal_hlt']
# The production capture exports reset native state only, not a reset board snapshot.
for cut in a['checkpoints']:
 expected=js['boundaries'][cut['name']];assert cut['q']==expected['q'];cpu(cut['native'],expected['cpu']);assert int(cut['native']['nativeTicks'])==expected['attempts'];assert int(cut['native']['successfulQuanta'])==expected['q'];assert cut['board']['board']==expected['board'];assert cut['board']['javascriptCpuCycles']==0
cpu(a['final'],js['final']['cpu']);assert int(a['final']['nativeTicks'])==js['attempts'] and int(a['final']['successfulQuanta'])==js['q'];assert a['ramSha256']=='ecb57a4b83090fcf232c4bd2f7019cdfde992bdc8ecf708e04bdc1de9272733a';assert js['final']['memorySha256']=='8bbabd33892728f64bae9b9a558ba106112aef5024196e10aa037e45d0ca7344';assert a['resetWitness']==[0,0,0,0,240,255,255,127];assert int.from_bytes(bytes(a['resetWitness'][:4]),'little')==a['reset']['state'][2];assert int.from_bytes(bytes(a['resetWitness'][4:]),'little')==a['reset']['state'][10];assert a['ramCanonicalSha256']=='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f';assert a['in8Witness']==js['final']['in8Witness'];assert a['settled']['board']==js['final']['board'];assert a['settled']['board']['debt']==0;assert int(a['final']['execution']['faults'])==2 and int(a['final']['execution']['irqDeliveries'])==1
physical=a['final']['clockTransfers'];assert int(physical['words'])==js['attempts']+js['q'];assert int(physical['transfers'])==int(physical['commits'])+1+a['resumes']+len(js['ports']);assert 0<int(physical['commits'])<=int(physical['words']);canonicalRows=0;clockRows=0;portIns=[];allPorts=[];canonicalClocks=[]
if label=='smoke-off':assert (R/'guest/callbacks.jsonl').stat().st_size==0
else:
 off=json.loads((P/'smoke-off/guest/capture.json').read_bytes())
 for field in ['reset','final','checkpoints','settled','in8Witness','ramSha256','resetWitness','ramCanonicalSha256','resumes','terminal','closed']:assert a[field]==off[field],field
 # Source-bound reconstruction, not observed JS N callback order: generated cpu.cc executes
 # successful ordinary/REP quantum before postinstruction/intermediate native tick; fault charges N only.
 # JS STEP records attempted-count and completion delta, bounded here to zero or one.
 expected=[];previousQ=0;previousN=0
 with (ref.parent/'events.jsonl').open()as f:
  for line in f:
   row=json.loads(line)
   if row[0]=='STEP':assert row[1]==previousN+1;previousN=row[1];assert row[2]-previousQ in [0,1];expected.extend(['Q']*(row[2]-previousQ));expected.append('N');previousQ=row[2]
 actual=[];ins=[];journalClocks=[];lastOrdinal=0;n=0;q=0
 with (R/'guest/callbacks.jsonl').open()as f:
  for line in f:
   row=json.loads(line);assert row[0]==lastOrdinal+1;lastOrdinal=row[0]
   if row[1]=='nativeTick':assert row[2]==[] and row[3]==0;n+=1;actual.append('N');journalClocks.append(('N',n,q))
   elif row[1]=='quantum':assert row[2]in [[0],[1]] and row[3]in [0,1];q+=1;actual.append('Q');journalClocks.append(('Q',row[2][0],n,q))
   elif row[1]=='inPort':ins.append(row)
   assert row[4]==n and row[5]==q and row[6]==4+6*q;assert type(row[7])is int and 0<=row[7]<=6005
 assert actual==expected;clockRows=len(actual);assert len(ins)==2
 for row,event in zip(ins,[e for e in js['ports']if e['dir']=='in']):assert row[2]==[event['port'],1];assert row[3]['value']==event['value'];assert row[4:7]==[event['attempts']-1,event['q'],event['cycles']]
 with (R/'child.stderr').open('rb')as f:
  for line in f:
   if line.startswith(b'BWSD1\t'):
    canonicalRows+=1;parts=line.rstrip(b'\n').split(b'\t')
    if parts[1:3]==[b'PORT',b'in']:portIns.append(parts)
    if parts[1]==b'PORT':allPorts.append(parts)
    if parts[1]==b'NATIVE_TICK':assert len(parts)==7 and int(parts[2])==1;canonicalClocks.append(('N',int(parts[4]),int(parts[5])))
    if parts[1]==b'QUANTUM':assert len(parts)==12;canonicalClocks.append(('Q',int(parts[2]),int(parts[10]),int(parts[9])))
   elif b'BWSD1'in line:raise AssertionError('malformed canonical fragment')
 assert canonicalClocks==journalClocks
 assert len(allPorts)==len(js['ports'])
 for parts,event in zip(allPorts,js['ports']):assert len(parts)==8 and parts[2].decode()==event['dir'] and int(parts[3],16)==event['port'] and int(parts[4])==1 and int(parts[5],16)==event['value'] and int(parts[6])==event['attempts']-1
 assert len(portIns)==2
 for parts,event in zip(portIns,[e for e in js['ports']if e['dir']=='in']):assert int(parts[3],16)==event['port'] and int(parts[4])==1 and int(parts[5],16)==event['value'] and int(parts[6])==event['attempts']-1
result={'status':'IN8_FULL_NATIVE_CAPTURE_PARITY_PASS'if label=='fulltrace-on'else'IN8_JS_REFERENCE_CAPTURE_OFF_PARITY_PASS_NOT_SPEED_GATE','checks':checks,'canonicalRows':canonicalRows,'logicalClockRows':clockRows,'PORTinRows':len(portIns),'captureSha256':sha(R/'guest/capture.json'),'journalSha256':sha(R/'guest/callbacks.jsonl'),'sourceRevision':approved['revision'],'referenceRevision':js['source']['revision'],'scope':'All166 native words and complete native snapshot fields exact between CAP modes; Eight recorded JS CPU fields exact; EDX/CR0 exact documented per-core profile rule, raw RAM hashes preserved with exact eight-byte reset witness verified and canonicalRAM anchor. Fullboard/IN witness checked. No invented unrecorded JS CPU state, no historical439/trace-row assumptions, no performance or broadAT claim.'};(R/'parity.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
