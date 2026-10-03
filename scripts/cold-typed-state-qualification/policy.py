"""Held terminal evidence checks, narrowed to one typed native arm. Never spawn a guest."""
import hashlib
import json
import math
from pathlib import PurePosixPath

HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
COMPILED='f4a2f2ceae48dde3e4585d84e6c759e13ebadc53'
def require(condition,message):
    if not condition:raise ValueError(message)
def sha(data):return hashlib.sha256(data).hexdigest()
def hexpin(value,n):return type(value) is str and len(value)==n and all(c in '0123456789abcdef' for c in value)
def integer(value,minimum=0,maximum=400000):
    require(type(value) is int and minimum<=value<=maximum,'bounded integer');return value
def counter(value):
    if type(value) is str:
        require(value.isascii() and value.isdecimal() and (value=='0' or not value.startswith('0')) and len(value)<=16,'counter lexical domain');value=int(value)
    return integer(value)
def identity_sha(revision,files):return sha(json.dumps({'revision':revision,'hashes':dict(sorted(files.items()))},separators=(',',':'),ensure_ascii=False).encode())
def absolute(value):return type(value) is str and value.startswith('/') and str(PurePosixPath(value))==value and '..' not in PurePosixPath(value).parts and not any(c in value for c in '\0\r\n')
def words(n):
    out=[]
    for key,size in zip(('state','extra','segments','system','debug'),(20,20,90,30,6)):
        require(type(n[key]) is list and len(n[key])==size,'full166 shape');out.extend(integer(v,0,0xffffffff) for v in n[key])
    return out
INSPECT_FIELDS={'state','extra','segments','system','debug','nativeTicks','successfulQuanta','mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution'}
RESUME_FIELDS=INSPECT_FIELDS|{'activityState','reason','chargedNativeTicks','chargedQuanta','sliceBytes'}
METADATA_COUNTER_FIELDS={'clockTransfers':{'transfers','commits','words'},'callbacks':{'physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'},'fallback':{'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'},'execution':{'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'}}
def metadata_counter(value):
    if type(value) is str:
        require(value.isascii() and value.isdecimal() and (value=='0' or not value.startswith('0')) and len(value)<=16,'metadata counter lexical domain');value=int(value)
    return integer(value,0,2**53-1)
def validate_inspect_snapshot(n):
    require(type(n) is dict and set(n)==INSPECT_FIELDS,'actual thirteen-field inspect schema');words(n);counter(n['nativeTicks']);counter(n['successfulQuanta']);require(n['mappingEpoch']==0 and n['boardA20']==1,'fixed inspect mapping/A20')
    for name,keys in METADATA_COUNTER_FIELDS.items():
        require(type(n[name]) is dict and set(n[name])==keys,'actual '+name+' counter fields')
        for value in n[name].values():metadata_counter(value)
    require(all(metadata_counter(v)==0 for v in n['fallback'].values()),'no inspect fallback');require(all(metadata_counter(n['execution'][k])==0 for k in ('faults','irqDeliveries','haltIdleCuts')),'no inspect fault/IRQ/HLT');return n
def validate_resume_snapshot(n,max_n=600,max_q=300):
    require(type(n) is dict and set(n)==RESUME_FIELDS,'actual eighteen-field resume schema');validate_inspect_snapshot({k:n[k] for k in INSPECT_FIELDS})
    require(type(n['activityState']) is int and n['activityState']==0,'actual resume active state');require(type(n['reason']) is int and n['reason'] in (1,3,7),'budget/PIO/event resume only')
    dn=integer(n['chargedNativeTicks'],0,max_n);dq=integer(n['chargedQuanta'],0,max_q);require(dn<=counter(n['nativeTicks']) and dq<=counter(n['successfulQuanta']) and (dn or dq or n['reason']==7),'bounded resume deltas and real zero-progress event')
    require(type(n['sliceBytes']) is list and len(n['sliceBytes'])==160,'actual ABI4 slice length')
    for byte in n['sliceBytes']:integer(byte,0,255)
    return n
def phase_metrics(timing):
    require(type(timing['cpuMicroseconds']) is dict and set(timing['cpuMicroseconds'])=={'user','system'},'execution process CPU fields')
    microseconds=sum(integer(v,0,10**15) for v in timing['cpuMicroseconds'].values());cpu=microseconds/1e6
    raw=timing['wallNanoseconds'];require(type(raw) is str and raw.isascii() and raw.isdecimal() and not raw.startswith('0') and len(raw)<=20,'positive execution wall ns')
    wall=int(raw)/1e9;require(cpu>0 and 0<wall<=120 and math.isfinite(cpu+wall),'phase metrics domain')
    return {'cpuSeconds':cpu,'cpuMicrosecondsSum':microseconds,'wallSeconds':wall}
def pio_projection(ports,native):
    require(type(ports) is list and len(ports)<=20000,'complete bounded tape');out=[]
    for i,e in enumerate(ports):
        q=counter(e['successfulQuanta'])+1 if native else integer(e['q'],1)
        require(integer(e['ordinal'],1,20000)==i+1,'PIO order');require(e['dir'] in ('in','out') and e.get('width',8)==8,'actual byte PIO');integer(e['port'],0,65535);integer(e['value'],0,255);require(e['cycles']==4+6*(q-1),'preQ actual clocks')
        if native:counter(e['nativeTicks'])
        out.append([e['ordinal'],e['dir'],e['port'],8,e['value'],q,e['cycles']])
    return out
def validate_worker_receipt(r,arm,expected_input,b,capture):
    require(r['input']==expected_input,'exact fresh child input')
    kind='plainJs' if arm=='plain-JS' else 'native';w=b['workers'][kind];expected_source={'revision':w['revision'],'hashes':dict(sorted(w['files'].items()))}
    before,after=('sourceBefore','sourceAfter') if kind=='plainJs' else ('workerBefore','workerAfter')
    require(r[before]==r[after]==expected_source,'actual worker before/after full currentGit identity')
    require(r['nodeSha256Before']==r['nodeSha256After']==b['node']['sha256'],'actual Node before/after')
    require(r['prerequisite']['captureSha256']==b['capture']['sha256'] and r['prerequisite']['independentAuditSha256']==b['independentAudit']['sha256'],'same bound audited capture')
    require(r['prerequisite']['bindingSha256']==w['files'][w['binding']],'actual worker lock hash')
    finalcut=capture['cuts'][-1];require(finalcut['name']=='before-F000-E16','actual pre-settle CPU cut')
    require(capture['progress']=={**capture['progress'],'n':b['targetN'],'q':b['targetQ']},'bound actual independent N/Q')
    if kind=='plainJs':
        require(r['schema']=='bw.cold-plain-js.worker.v1' and r['status']=='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS','plain JS actual parity success')
        require(r['result']['final']==capture['javascriptFinal'],'whole raw final JS CPU/board/RAM');ports=r['result']['ports'];timing=r['result']['timing'];require(r['result']['final']['cpu']['cycles']==b['targetQ'],'actual JS Q, no invented native N')
    else:
        require(r['schema']=='bw.cold-native-typed-state-performance.worker.v1' and r['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','native actual parity success');require(expected_input['mode']==('oneQ' if arm=='native-oneQ' else 'batched'),'closed native mode')
        n=r['finalNative'];require(words(n)==words(finalcut['native']),'entire raw terminal166 CPU');require(counter(n['nativeTicks'])==b['targetN'] and counter(n['successfulQuanta'])==b['targetQ'],'actual native N/Q independent')
        # inspect() retains the thirteen common fields; only resume() returns
        # activityState and charged deltas. Keep the actual final resume proof
        # separate instead of synthesizing an activity field on inspect().
        validate_inspect_snapshot(n)
        last=validate_resume_snapshot(r['lastReturnedNative'],1 if arm=='native-oneQ' else 600,1 if arm=='native-oneQ' else 300)
        require(counter(last['nativeTicks'])==b['targetN'] and counter(last['successfulQuanta'])==b['targetQ'],'final resume independent N/Q')
        require(words(last)==words(n),'actual last resume and final inspect raw166 agreement')
        require(n['mappingEpoch']==0 and n['boardA20']==1 and n['state'][13]==0xf000 and n['state'][8]==0xe16 and n['state'][10]==0x7ffffff0 and n['state'][9]&0x200==0,'normal E16 reset-model scope')
        require(set(n['fallback'])=={'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'} and all(counter(v)==0 for v in n['fallback'].values()),'no fallback')
        require(set(n['execution'])=={'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'},'actual execution counter fields');require(all(counter(n['execution'][k])==0 for k in ('faults','irqDeliveries','haltIdleCuts')),'no fault/IRQ/HLT')
        s=r['finalBoard'];require(s['state']['board']==capture['javascriptFinal']['board'] and s['ramSha256']==capture['javascriptFinal']['ramSha256'],'whole final board/rawRAM');require(s['state']['nativeTicks']==b['targetN'] and s['state']['successfulQuanta']==b['targetQ'] and s['state']['cold']['phase']=='complete','provider terminal totals/controller')
        require(r['compiledBefore']==r['compiledAfter']=={'revision':COMPILED,'hashes':b['compiledFiles']},'compiled134 before/after');require(r['buildBefore']==r['buildAfter'] and r['buildBefore']['addonSha256']==b['nativeInput']['sha256'],'same admitted actual build/addon');ports=r['ports'];timing=r['executionTiming']
    require(pio_projection(ports,kind=='native')==pio_projection(capture['javascriptPorts'],False),'complete ordered actual PIO, values and clock ownership')
    metrics=phase_metrics(timing);metrics['configuredVirtualSeconds']=6*b['targetQ']/b['configuredClockHz'];metrics['configuredVirtualRTx']=metrics['configuredVirtualSeconds']/metrics['wallSeconds'];return metrics
