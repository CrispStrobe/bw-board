"""Pure paired protocol and raw terminal evidence checks. Never spawn a guest."""
import hashlib
import json
import math
from pathlib import PurePosixPath

COMPARISONS={
    'plain-JS-v-fusion-batched':('plain-JS','fusion-batched'),
}
PROTOCOL={'warmupPairs':2,'measuredPairs':7,'alternating':True,'firstBaseline':True}
CRITERIA={'primaryMetric':'executionProcessCpuSeconds','meanReductionAtLeast':0.10,'allSevenCandidateFaster':True}
HOOKS=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
COMPILED='85fc1599af0ee71e32208da9d36caac86daa3b8c'
def require(condition,message):
    if not condition:raise ValueError(message)
def sha(data):return hashlib.sha256(data).hexdigest()
def hexpin(value,n):return type(value) is str and len(value)==n and all(c in '0123456789abcdef' for c in value)
def integer(value,minimum=0,maximum=400000):
    require(type(value) is int and minimum<=value<=maximum,'bounded integer');return value
def counter(value,maximum=400000):
    if type(value) is str:
        require(value.isascii() and value.isdecimal() and (value=='0' or not value.startswith('0')) and len(value)<=16,'counter lexical domain');value=int(value)
    return integer(value,0,maximum)
def identity_sha(revision,files):return sha(json.dumps({'revision':revision,'hashes':dict(sorted(files.items()))},separators=(',',':'),ensure_ascii=False).encode())
def absolute(value):return type(value) is str and value.startswith('/') and str(PurePosixPath(value))==value and '..' not in PurePosixPath(value).parts and not any(c in value for c in '\0\r\n')
def validate_ready_binding(b):
    require(b.get('schema')=='bw.cold-memory-fusion.paired-binding.v1','binding schema')
    require(b.get('status')=='ROOT_REVIEWED_READY_FOR_SEPARATELY_GRANTED_PAIRS','pending binding: no child, addon or restoration')
    require(b.get('protocol')==PROTOCOL and b.get('criteria')==CRITERIA,'fixed predeclared protocol/criteria')
    integer(b['targetQ'],1);integer(b['targetN'],1)
    require(b['compiledRevision']==COMPILED,'new compiled151 identity')
    require(b['configuredClockHz']==6000000 and b['functionalCyclesPerQ']==6,'configured functional model, not physical timing')
    require(b['node']['version']=='v22.23.3' and hexpin(b['node']['sha256'],64) and absolute(b['node']['path']),'fixed Node')
    for role in ('capture','independentAudit','armQualificationAudit'):
        require(absolute(b[role]['path']) and hexpin(b[role]['sha256'],64),'approved immutable '+role)
    require(type(b['compiledFiles']) is dict and len(b['compiledFiles'])==151 and all(hexpin(h,64) for h in b['compiledFiles'].values()),'full compiled151 map')
    require(type(b['workers']) is dict and set(b['workers'])=={'native','plainJs'},'both worker roles')
    for kind,w in b['workers'].items():
        require(absolute(w['root']),'canonical worker root')
        require(hexpin(w['revision'],40) and type(w['files']) is dict and len(w['files'])>0 and all(hexpin(h,64) for h in w['files'].values()),'frozen '+kind+' full source map')
        require(w['entry'] in w['files'] and w['binding'] in w['files'],'worker entry/lock in closure')
        require(w['sourceSha256']==identity_sha(w['revision'],w['files']),'canonical worker identity')
    require(type(b['pinnedFiles']) is dict and len(b['pinnedFiles'])>0,'complete actual artifact/prepared/config/reference/helper pins')
    for pin in b['pinnedFiles'].values():require(type(pin)==dict and set(pin)=={'bytes','sha256'} and type(pin['bytes']) is int and 0<=pin['bytes']<=256<<20 and hexpin(pin['sha256'],64),'ordinary file pin')
    require(all(absolute(p) for p in b['pinnedFiles']),'absolute immutable file roles');require(absolute(b['compiledRoot']),'compiled root')
    native=b['nativeInput'];require(type(native) is dict and set(native)=={'compiledRoot','compiledRevision','addon','sha256','configuration','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256'},'exact native artifact input template');require(native['compiledRoot']==b['compiledRoot'] and native['compiledRevision']==COMPILED,'same native source role')
    for name in ('addon','configuration','preparedManifest','buildReceipt'):require(absolute(native[name]) and native[name] in b['pinnedFiles'],'complete native file pin '+name)
    for name in ('sha256','preparedManifestSha256','buildReceiptSha256'):require(hexpin(native[name],64),'native artifact hash')
    for path_key,hash_key in (('addon','sha256'),('preparedManifest','preparedManifestSha256'),('buildReceipt','buildReceiptSha256')):require(b['pinnedFiles'][native[path_key]]['sha256']==native[hash_key],'same immutable artifact role '+path_key)
    require(b['bounds']=={'cpuSeconds':60,'wallSeconds':120,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10},'closed child bounds')
    return b
def pair_schedule(comparison):
    require(comparison in COMPARISONS,'separate exact comparison');baseline,candidate=COMPARISONS[comparison]
    return [{'pair':i,'phase':'warmup' if i<2 else 'measured','measuredPair':None if i<2 else i-2,'order':[baseline,candidate] if i%2==0 else [candidate,baseline]} for i in range(9)]
def words(n):
    out=[]
    for key,size in zip(('state','extra','segments','system','debug'),(20,20,90,30,6)):
        require(type(n[key]) is list and len(n[key])==size,'full166 shape');out.extend(integer(v,0,0xffffffff) for v in n[key])
    return out
INSPECT_KEYS={'state','extra','segments','system','debug','nativeTicks','successfulQuanta','mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution'}
RESUME_KEYS=INSPECT_KEYS|{'activityState','reason','chargedNativeTicks','chargedQuanta','sliceBytes'}
def inspect_metadata(n,fusion=False):
    if fusion:
        require(set(n)==INSPECT_KEYS|{'bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'},'actual fifteen-field fusion inspect')
        for name in ('bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'):
            require(type(n[name]) is dict and set(n[name])==METADATA_COUNTER_FIELDS[name],'native bridge map shape')
            for value in n[name].values():
                require(type(value) is str,'persisted BigInt string');metadata_counter(value)
        n={k:n[k] for k in INSPECT_KEYS}
    require(set(n)==INSPECT_KEYS,'actual ABI4 inspect schema without fabricated activity');words(n);counter(n['nativeTicks']);counter(n['successfulQuanta']);integer(n['mappingEpoch'],0,0);integer(n['boardA20'],1,1);require(n['mappingEpoch']==0 and n['boardA20']==1,'inspect mapping/A20')
    groups={'clockTransfers':{'transfers','commits','words'},'callbacks':{'physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'},'fallback':{'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'},'execution':{'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'}}
    for group,keys in groups.items():
        require(set(n[group])==keys,'actual inspect counter shape '+group)
        for value in n[group].values():counter(value,9007199254740991)
    require(all(counter(v)==0 for v in n['fallback'].values()),'no inspect fallback')
    require(all(counter(n['execution'][k])==0 for k in ('faults','irqDeliveries','haltIdleCuts')),'no inspect fault/IRQ/HLT')
    return n
def terminal_return_metadata(last,final,mode,progress,fusion=False):
    if fusion:
        require(set(last)==RESUME_KEYS|{'bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'},'actual twenty-field fusion return')
        inspect_metadata({k:last[k] for k in INSPECT_KEYS|{'bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'}},True)
        for name in ('bridgeClockEntryAttempts','bridgeMemoryEntryAttempts'):require(last[name]==final[name],'last/final native bridge maps')
        last={k:last[k] for k in RESUME_KEYS}
    require(set(last)==RESUME_KEYS,'actual terminal resume schema');integer(last['activityState'],0,0);integer(last['reason'],1,7);require(last['activityState']==0 and last['reason'] in (1,3,7),'represented active terminal resume')
    require(counter(last['nativeTicks'])==counter(final['nativeTicks']) and counter(last['successfulQuanta'])==counter(final['successfulQuanta']) and words(last)==words(final),'actual last return raw166 and N/Q equal inspect')
    integer(last['chargedNativeTicks'],0,1 if mode=='oneQ' else 600);integer(last['chargedQuanta'],0,1 if mode=='oneQ' else 300)
    require(progress['n']==counter(final['nativeTicks']) and progress['q']==counter(final['successfulQuanta']) and progress['dn']==last['chargedNativeTicks'] and progress['dq']==last['chargedQuanta'],'actual last return progress/charges')
    require(type(last['sliceBytes']) is list and len(last['sliceBytes'])==160,'actual ABI4 slice metadata bytes')
    for byte in last['sliceBytes']:integer(byte,0,255)
    return last
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
        require(r['schema']=='bw.cold-native-memory-fusion-performance.worker.v1' and r['status']=='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS','native actual parity success');require(expected_input['mode']==('oneQ' if arm=='native-oneQ' else 'batched'),'closed native mode')
        require(r['requiredStateExportProfile']==r['admittedStateExportProfile']=='bw.cold-native.copied-u32-state.v1' and r['typedSnapshotOwnership']=='RESET_STABLE_AND_FINAL_LAST_RETURN_DISTINCT','actual typed profile/ownership');n=r['finalNative'];inspect_metadata(n,True);inspect_metadata(finalcut['native']);terminal_return_metadata(r['lastReturnedNative'],n,expected_input['mode'],r['progress'],True);require(r['requiredMemoryFusionProfile']==r['admittedMemoryFusionProfile']=='bw.cold-native.memory-clock-fusion.v1','actual fusion profile');reset=r['reset']['native'];inspect_metadata(reset,True);require(words(reset)==words(capture['cuts'][0]['native']),'raw reset166 equality');validate_bridge_evidence(r);require(words(n)==words(finalcut['native']),'entire raw terminal166 CPU');require(counter(n['nativeTicks'])==b['targetN'] and counter(n['successfulQuanta'])==b['targetQ'],'actual native N/Q independent')
        require(n['mappingEpoch']==0 and n['boardA20']==1 and n['state'][13]==0xf000 and n['state'][8]==0xe16 and n['state'][10]==0x7ffffff0,'normal E16 reset-model scope')
        require(set(n['fallback'])=={'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'} and all(counter(v)==0 for v in n['fallback'].values()),'no fallback')
        require(set(n['execution'])=={'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'},'actual execution counter fields');require(all(counter(n['execution'][k])==0 for k in ('faults','irqDeliveries','haltIdleCuts')),'no fault/IRQ/HLT')
        s=r['finalBoard'];require(s['state']['board']==capture['javascriptFinal']['board'] and s['ramSha256']==capture['javascriptFinal']['ramSha256'],'whole final board/rawRAM');require(s['state']['nativeTicks']==b['targetN'] and s['state']['successfulQuanta']==b['targetQ'] and s['state']['cold']['phase']=='complete','provider terminal totals/controller')
        require(r['compiledBefore']==r['compiledAfter']=={'revision':COMPILED,'hashes':b['compiledFiles']},'compiled151 before/after');require(r['buildBefore']==r['buildAfter'] and r['buildBefore']['addonSha256']==b['nativeInput']['sha256'],'same admitted actual build/addon');ports=r['ports'];timing=r['executionTiming']
    require(pio_projection(ports,kind=='native')==pio_projection(capture['javascriptPorts'],False),'complete ordered actual PIO, values and clock ownership')
    metrics=phase_metrics(timing);metrics['configuredVirtualSeconds']=6*b['targetQ']/b['configuredClockHz'];metrics['configuredVirtualRTx']=metrics['configuredVirtualSeconds']/metrics['wallSeconds'];return metrics
def summarize_pairs(comparison,pairs):
    baseline,candidate=COMPARISONS[comparison];measured=[p for p in pairs if p['phase']=='measured'];require(len(pairs)==9 and len(measured)==7,'exact2warmup7measured pairs')
    ratios=[]
    for p in measured:
        require(set(p['arms'])=={baseline,candidate},'both successful fresh children');a,c=p['arms'][baseline],p['arms'][candidate]
        ratios.append({'pair':p['measuredPair'],'executionCpuCandidateOverBaseline':c['execution']['cpuSeconds']/a['execution']['cpuSeconds'],'executionWallCandidateOverBaseline':c['execution']['wallSeconds']/a['execution']['wallSeconds'],'wholeChildCpuCandidateOverBaseline':c['wholeChild']['cpuSeconds']/a['wholeChild']['cpuSeconds'],'wholeChildWallCandidateOverBaseline':c['wholeChild']['wallSeconds']/a['wholeChild']['wallSeconds']})
    for p in measured:
        for arm in (baseline,candidate):
            e=p['arms'][arm]['execution'];integer(e['cpuMicrosecondsSum'],1,10**15);require(e['cpuSeconds']==e['cpuMicrosecondsSum']/1e6,'phase CPU units consistent')
    total_b=sum(p['arms'][baseline]['execution']['cpuMicrosecondsSum'] for p in measured);total_c=sum(p['arms'][candidate]['execution']['cpuMicrosecondsSum'] for p in measured);avg_b=total_b/7e6;avg_c=total_c/7e6;reduction=1-total_c/total_b;all_favorable=all(p['arms'][candidate]['execution']['cpuMicrosecondsSum']<p['arms'][baseline]['execution']['cpuMicrosecondsSum'] for p in measured)
    return {'comparison':comparison,'primaryMetric':CRITERIA['primaryMetric'],'criteria':CRITERIA,'baselineMeanExecutionCpuSeconds':avg_b,'candidateMeanExecutionCpuSeconds':avg_c,'meanCpuReduction':reduction,'allSevenFavorable':all_favorable,'quantitativeGatePass':10*total_c<=9*total_b and all_favorable,'rawRatios':ratios,'scope':'Cold slice only; configured virtual RTx is not physical 386 calibration; no default adoption, full AT/Windows/Doom10x claim'}

METADATA_COUNTER_FIELDS={'clockTransfers':{'transfers','commits','words'},'callbacks':{'physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'},'fallback':{'bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'},'execution':{'attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'},'bridgeClockEntryAttempts':{'unknown','INIT','ENTRY','MEMORY','PAGE','PRE_PIO','POST_PIO','ACK','FAULT','IRQ','HLT','RETURN'},'bridgeMemoryEntryAttempts':{'ordinaryRead','ordinaryWrite','fusedOuter'}}
def metadata_counter(value):
    if type(value) is str:
        require(value.isascii() and value.isdecimal() and (value=='0' or not value.startswith('0')) and len(value)<=16,'metadata counter lexical domain');value=int(value)
    return integer(value,0,2**53-1)
def validate_bridge_evidence(r):
    reset=r['reset']['native'];final=r['finalNative'];counts=r['bridgeAttemptCounts'];provider=counts['provider']
    require(set(counts)=={'provider','reset','final','scope'},'bridge evidence shape')
    require(set(provider)=={'memoryOuterEntries','replyValidations','readEffects','writeEffects'},'provider fusion counter shape')
    for v in provider.values():require(type(v) is int and 0<=v<=2**53-1,'provider counter domain')
    for field,short in [('bridgeClockEntryAttempts','clock'),('bridgeMemoryEntryAttempts','memory')]:
        require(counts['reset'][short]==reset[field] and counts['final'][short]==final[field],'raw attempt map evidence')
        for k,v in reset[field].items():require(metadata_counter(final[field][k])>=metadata_counter(v),'monotonic raw bridge attempts')
    require(reset['bridgeClockEntryAttempts']=={k:str(int(k=='INIT')) for k in METADATA_COUNTER_FIELDS['bridgeClockEntryAttempts']},'source-attested reset clock attempts')
    require(reset['bridgeMemoryEntryAttempts']=={k:'0' for k in METADATA_COUNTER_FIELDS['bridgeMemoryEntryAttempts']},'reset memory attempts')
    require(provider['memoryOuterEntries']==provider['replyValidations']==metadata_counter(final['bridgeMemoryEntryAttempts']['fusedOuter']),'native/provider fusion outer agreement')
    require(provider['readEffects']+provider['writeEffects']==provider['replyValidations'],'validated fusion effect count');return counts
