"""Independent byte-only original reader; imports no producer/helpers."""
import hashlib,json,math,os,re,stat
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PROFILE_CAP=8388608
INTERVAL=1000
NODE_BYTES=124827920
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
class Refusal(ValueError):pass
def need(v,reason):
    if not v:raise Refusal(reason)
def unique(items):
    result={}
    for k,v in items:
        need(k not in result,'duplicate key');result[k]=v
    return result
def parse(raw,cap):
    need(type(raw) is bytes and len(raw)<=cap,'original byte cap')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda v:(_ for _ in ()).throw(Refusal('nonfinite')))
def read_manifest(path,cap=65536):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
    primary=None;parts=[];count=0
    try:
        before=os.fstat(fd)
        need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and
             0<before.st_size<=cap,'bounded independent manifest')
        while True:
            piece=os.read(fd,min(65536,cap+1-count));count+=len(piece)
            need(count<=cap,'independent manifest cap')
            if not piece:break
            parts.append(piece)
        after=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        identity=lambda s:(s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_size,s.st_mtime_ns)
        need(count==before.st_size and identity(before)==identity(after)==identity(named),
             'held independent manifest identity')
    except BaseException as error:primary=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return b''.join(parts)
def profile_summary(raw,arm,source_uri,fixture_uri):
    data=parse(raw,PROFILE_CAP)
    need(type(data) is dict and set(data)=={'nodes','startTime','endTime','samples','timeDeltas'},'complete profile fields')
    for key in ('startTime','endTime'):need(type(data[key]) in (int,float) and math.isfinite(data[key]),'profile finite times')
    duration=data['endTime']-data['startTime'];need(0<duration<=60000000,'recorded profile interval')
    nodes=data['nodes'];samples=data['samples'];deltas=data['timeDeltas']
    need(type(nodes) is list and 0<len(nodes)<=20000 and type(samples) is list and 0<len(samples)<=120000 and type(deltas) is list and len(deltas)==len(samples),'profile census')
    ids={}
    for node in nodes:
        need(type(node) is dict and {'id','callFrame'}<=set(node)<= {'id','callFrame','hitCount','children','positionTicks','deoptReason'},'node fields')
        identifier=node['id'];need(type(identifier) is int and identifier>0 and identifier not in ids,'node ID')
        frame=node['callFrame'];need(type(frame) is dict and set(frame)=={'functionName','scriptId','url','lineNumber','columnNumber'},'call frame')
        for key in ('functionName','scriptId','url'):need(type(frame[key]) is str and len(frame[key])<=4096,'frame strings')
        for key in ('lineNumber','columnNumber'):need(type(frame[key]) is int and frame[key]>=-1,'frame location')
        need(type(node.get('hitCount',0)) is int and node.get('hitCount',0)>=0,'hit count')
        children=node.get('children',[]);need(type(children) is list and len(children)<=20000 and all(type(v) is int and v>0 for v in children),'child references')
        if 'deoptReason' in node:need(type(node['deoptReason']) is str and len(node['deoptReason'])<=4096,'deopt reason')
        ticks=node.get('positionTicks',[]);need(type(ticks) is list and len(ticks)<=20000,'tick bounds')
        for tick in ticks:need(type(tick) is dict and set(tick)=={'line','ticks'} and all(type(v) is int and v>=0 for v in tick.values()),'position ticks')
        ids[identifier]=node
    for node in nodes:need(all(identifier in ids for identifier in node.get('children',[])),'missing child ID')
    weights={identifier:{'sampleCount':0,'rawDeltaMicroseconds':0} for identifier in ids}
    for identifier,delta in zip(samples,deltas):
        need(type(identifier) is int and identifier in ids,'sample reference')
        need(type(delta) is int and abs(delta)<=60000000,'bounded raw delta')
        weights[identifier]['sampleCount']+=1;weights[identifier]['rawDeltaMicroseconds']+=delta
    frames=[]
    for identifier,node in ids.items():
        frame=node['callFrame'];url=frame['url'];name=frame['functionName']
        role='CPU' if url==source_uri+'/src/experimental/i80386.js' else 'AT scheduler/devices' if url==source_uri+'/src/experimental/i80386-at-machine.js' else 'runtime/devices' if url in {source_uri+'/'+path for path in SOURCE_ROWS if path.startswith('src/')} else 'fixture' if url in (fixture_uri,source_uri+'/scripts/i80386-at-profile/fixture.mjs') else 'Node builtin' if url.startswith('node:') else 'V8 GC' if name=='(garbage collector)' and url=='' else 'unresolved'
        frames.append({'nodeId':identifier,'sourceRole':role,'functionName':name,'url':url,'lineNumber':frame['lineNumber'],'columnNumber':frame['columnNumber'],'deoptReason':node.get('deoptReason'),**weights[identifier]})
    return {'schema':'bw.current-at-cost-v8-profile-summary.v1','arm':arm,'profileSha256':hashlib.sha256(raw).hexdigest(),'profileBytes':len(raw),'recordedDurationMicroseconds':duration,'requestedSamplingIntervalMicroseconds':INTERVAL,'totalSamples':len(samples),'rawDeltaSumMicroseconds':sum(deltas),'unusualNonpositiveDeltaCount':sum(v<=0 for v in deltas),'frames':frames,'sampleWeightsAreExactCPUCosts':False,'allocationCountsMeasured':False,'completeOSStartupCovered':False,'pairedPerformanceGate':False,'adoptionQualified':False}


def exact(value,wanted,reason):
    need(type(value) is type(wanted),reason+' type')
    if type(wanted) is dict:
        need(set(value)==set(wanted),reason+' keys')
        for k,v in wanted.items():exact(value[k],v,reason+'.'+k)
    elif type(wanted) is list:
        need(len(value)==len(wanted),reason+' length')
        for a,b in zip(value,wanted):exact(a,b,reason)
    else:need(value==wanted,reason)

def semantic(raw,kind):
    v=parse(raw,262144)
    need(type(v) is dict and set(v)=={'schema','kind','steps','charges','cpuCycles','state','ifEnabled','interrupts','ordinarySettings','devices','startupNanoseconds','warmupNanoseconds','setupNanoseconds','executionLoopNanoseconds','mode','requestedSteps','warmupDoesNotContributeToMeasuredState','physical386TimingCalibrated'},'semantic fields')
    exact(v['schema'],'bw.current-at-cost-child.v1','schema');exact(v['kind'],kind,'kind')
    exact(v['steps'],1000000,'steps');exact(v['requestedSteps'],1000000,'requested steps')
    need(v['mode'] in ('timing','profile') and v['warmupDoesNotContributeToMeasuredState'] is True and v['physical386TimingCalibrated'] is False,'closed warmed measurement scope');exact(v['cpuCycles'],1000000,'cpu completed')
    exact(v['charges'],1000000 if kind=='core' else 6000000,'charge')
    exact(v['state'],{'ax':65534,'bx':65535,'ip':0,'word':65535},'authored architecture')
    exact(v['ordinarySettings'],{'translationCache':kind=='at','deliverFaults':kind=='at','cpuProfile':'compatibility'},'ordinary constructor settings')
    exact(v['ifEnabled'],False,'IF clear');exact(v['interrupts'],0,'delivered IRQ')
    for field in ('startupNanoseconds','warmupNanoseconds','setupNanoseconds','executionLoopNanoseconds'):
        need(type(v[field]) is str and v[field].isdigit() and 0<int(v[field])<=60000000000,'finite distinct '+field)
    if kind=='core':exact(v['devices'],None,'core devices');return v
    d=v['devices'];need(type(d) is dict and set(d)=={'machineCycles','debt','deadline','appliedClocks','pitFraction','pitCounters','pics','rtc','cga','keyboard'},'device fields')
    for k,n in {'machineCycles':6000000,'debt':5310,'deadline':16000,'appliedClocks':5994690}.items():exact(d[k],n,k)
    need(d['appliedClocks']+d['debt']==d['machineCycles'],'debt conservation')
    f=d['pitFraction'];need(type(f) in (int,float) and math.isfinite(f) and abs(f-0.262723749965744)<=1e-9,'PIT fractional recurrence')
    counters=[{'mode':0,'rw':0,'reload':0,'ce':0,'out':0,'armed':False,'nullCount':True,'gate':gate} for gate in (1,1,0)]
    exact(d['pitCounters'],counters,'unprogrammed counters')
    exact(d['pics'],[{'irr':0,'isr':0,'imr':0,'vectorBase':0,'intActive':False}]*2,'PIC not delivered')
    exact(d['rtc'],{'cyclePhase':5994690,'periodicPhase':10562560,'registerB':2,'registerC':64},'RTC pending flag without enabled IRQ')
    exact(d['cga'],{'cycles':5994690,'frameCount':22,'lastVretrace':0},'CGA')
    exact(d['keyboard'],{'commandByte':0,'queue':[{'value':170,'keyboard':True}],'scheduled':0},'keyboard BAT without enabled IRQ')
    return v

SOURCE_ROWS_BYTES=read_manifest(ROOT/'scripts/i80386-current-at-cost/source-rows.json')
need(hashlib.sha256(SOURCE_ROWS_BYTES).hexdigest()==
     'ba3039a9866105933db4c2877e948758770c59ffc6a37d0e0a82b752b3c7180d',
     'frozen current import-closure manifest')
SOURCE_ROWS=parse(SOURCE_ROWS_BYTES,65536)

def audit(roles):
    need(type(roles) is dict and {'stdout','stderr','usage','resource','preexec','source','runtime'}<=set(roles)<=
         {'stdout','stderr','usage','resource','preexec','profile','source','runtime'},'closed child original roles')
    source=parse(roles['source'],65536);runtime=parse(roles['runtime'],8192)
    need(type(source) is dict and set(source)=={'schema','diagnosticRootURI',
         'diagnosticHead','diagnosticRoles','sourceRootURI','sourceHead',
         'sourceTree','sourceRoles','helpers'} and
         source['schema']=='bw.current-at-cost-source.v1',
         'closed current source original')
    need(type(runtime) is dict and set(runtime)=={'nodeVersion','nodePath','nodeBytes','nodeSha256','python'},
         'closed current Node runtime original')
    need(type(source['sourceHead']) is str and len(source['sourceHead'])==40 and source['sourceHead']==source['diagnosticHead'],'one current source HEAD')
    need(type(source['sourceTree']) is str and re.fullmatch('[0-9a-f]{40}',source['sourceTree']),
         'exact selected source tree')
    exact(source['sourceRoles'],SOURCE_ROWS,'complete source closure')
    need(type(source['sourceRootURI']) is str and source['sourceRootURI'].startswith('file:///'),'reported source URI')
    need(source['diagnosticRootURI']==source['sourceRootURI'] and
         type(source['diagnosticRootURI']) is str and
         source['diagnosticRootURI'].startswith('file:///'),
         'one selected current checkout URI')
    need(type(source['diagnosticHead']) is str and len(source['diagnosticHead'])==40,'publication head')
    exact(runtime['nodeVersion'],'22.23.3','runtime version')
    exact(runtime['nodeBytes'],NODE_BYTES,'selected Node extent')
    exact(runtime['nodeSha256'],NODE_SHA,'selected Node hash')
    usage=parse(roles['usage'],16384);res=parse(roles['resource'],65536);pre=parse(roles['preexec'],8192)
    kind=usage.get('kind');mode=usage.get('mode')
    need(kind in ('core','at') and mode in ('timing','profile') and
         ('profile' in roles)==(mode=='profile'),'fixed four-child mode and profile cardinality')
    fixture_uri=source['diagnosticRootURI']+'/scripts/i80386-current-at-cost/fixture.mjs'
    fixture_path=str(Path(fixture_uri.removeprefix('file://')))
    argv=usage['argv'];need(type(argv) is list and len(argv)==(9 if mode=='profile' else 5),'fixed argv extent')
    exact(usage['requestedProfileIntervalMicroseconds'],1000 if mode=='profile' else None,'requested sample interval')
    need(type(runtime['nodePath']) is str and runtime['nodePath'].startswith('/'),'runtime executable path')
    if mode=='profile':
        exact(argv[:4],[runtime['nodePath'],'--max-old-space-size=512','--cpu-prof','--cpu-prof-interval=1000'],'fixed profile options')
        need(type(argv[4]) is str and argv[4].startswith('--cpu-prof-dir=') and
             argv[4].endswith('/'+kind+'-'+mode),'owned profile directory')
        exact(argv[5:],['--cpu-prof-name=v8.cpuprofile',fixture_path,kind,mode],'fixed profile command')
    else:exact(argv,[runtime['nodePath'],'--max-old-space-size=512',fixture_path,kind,mode],'fixed unprofiled command')
    sem=semantic(roles['stdout'],kind);exact(sem['mode'],mode,'semantic child mode')
    exact(roles['stderr'],b'','empty stderr')
    exact(usage['exitCode'],0,'exit');exact(usage['reaped'],True,'owned reap');exact(usage['timedOut'],False,'timeout');exact(usage['cleanupErrors'],[],'cleanup')
    exact(usage['observedStreamBytes'],[len(roles['stdout']),0],'complete streams');exact(usage['bufferPrefixBytes'],[len(roles['stdout']),0],'prefix')
    for k in ('cpuSeconds','wholeChildWallSeconds'):
        need(type(usage[k]) in (int,float) and math.isfinite(usage[k]) and
             0<usage[k]<=65,'finite bounded child metric')
    need(sum(int(sem[key]) for key in ('startupNanoseconds','warmupNanoseconds',
             'setupNanoseconds','executionLoopNanoseconds'))<=
         int(usage['wholeChildWallSeconds']*1000000000)+1000000,
         'distinct process windows fit whole child wall observation')
    exact(res['sourceBefore'],source,'source before original');exact(res['sourceAfter'],source,'source after original')
    exact(res['runtimeBeforeSha256'],runtime['nodeSha256'],'runtime before');exact(res['runtimeAfterSha256'],runtime['nodeSha256'],'runtime after')
    for position in [res['before'],pre,res['after']]:
        exact(position['limits'],{'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0'},'resource policy')
        need(type(position['affinity']) is list and len(position['affinity'])==1 and type(position['affinity'][0]) is int,'one CPU')
        need(type(position['memoryEvents']) is dict and {'max','oom','oom_kill'}<=set(position['memoryEvents']) and all(type(x) is int and x==0 for x in position['memoryEvents'].values()),'pressure zero')
        stat=position['cgroupStat'];events=position['cgroupEvents']
        need(type(stat) is dict and all(type(stat.get(key)) is int and stat[key]==0 for key in ('nr_descendants','nr_dying_descendants')) and
             type(events) is dict and type(events.get('populated')) is int and events['populated']==1,
             'owned unit has no nested or dying cgroup')
        need(type(position['observerPid']) is int and position['observerPid']>0 and
             type(position['directProcs']) is list and
             position['directProcs']==sorted(set(position['directProcs'])) and
             all(type(pid) is int and pid>0 for pid in position['directProcs']) and
             position['observerPid'] in position['directProcs'],
             'finite direct cgroup census')
    exact(pre['profileFileLimitBytes'],PROFILE_CAP,'preexec profile write bound')
    need(set(pre)==set(res['before'])|{'profileFileLimitBytes'} and
         pre['observerPid']!=res['before']['observerPid'] and
         pre['directProcs']==sorted([res['before']['observerPid'],pre['observerPid']]),
         'preexec wrapper and child census')
    for key in res['before']:
        if key not in ('observerPid','directProcs'):
            exact(pre[key],res['before'][key],'preexec resources '+key)
    exact(res['before'],res['after'],'after resources')
    need(res['before']['directProcs']==[res['before']['observerPid']],
         'quiescent wrapper before and after child')
    summary=profile_summary(roles['profile'],kind,source['sourceRootURI'],Path(fixture_path).as_uri()) if mode=='profile' else None
    return {'kind':kind,'mode':mode,'semanticSha256':hashlib.sha256(roles['stdout']).hexdigest(),
        'cpuSeconds':usage['cpuSeconds'],'wholeChildWallSeconds':usage['wholeChildWallSeconds'],
        'profileSha256':None if summary is None else summary['profileSha256'],
        'profileSummary':summary,'syntheticCharges':sem['charges'],
        'physicalRTxQualified':False,'costSharesMeasured':False}


ORDER=('core-timing','core-profile','at-timing','at-profile')
OWN=('package.json','.github/workflows/i80386-current-at-cost.yml',
     'scripts/i80386-at-profile/fixture.mjs','scripts/i80386-current-at-cost/fixture.mjs',
     'scripts/i80386-current-at-cost/run.py','scripts/i80386-current-at-cost/reader.py',
     'scripts/i80386-current-at-cost/source-rows.json','scripts/i80386-current-at-cost/README.md',
     'test/i80386-current-at-cost.test.mjs','docs/I80386-CURRENT-AT-COST.md')
HELPERS={'run.py':'8b941d7af7ae7dfd6c0300b317bd7d2530ecf44b4e9bd6fc2e0d61b89c7f1467',
         'policy.py':'a3ec7bd0a74f38d070babfc39eedfe7afd8d1aaf2e579002749a06cd19f2d659'}


def cgroup_fields(raw):
    need(type(raw) is bytes and len(raw)<=8192,'outside cgroup original cap')
    result={}
    for line in raw.decode('ascii').splitlines():
        pair=line.split()
        need(len(pair)==2 and pair[0] not in result and pair[1].isdigit(),
             'closed outside cgroup field')
        result[pair[0]]=int(pair[1])
    return result

def packet(children,cleanup_raw,unit_after_raw,procs_after_raw,
           stat_after_raw=None,events_after_raw=None):
    need(type(children) is dict and list(children)==list(ORDER),'four serial child originals')
    cleanup=parse(cleanup_raw,16384)
    need(type(cleanup) is dict and set(cleanup)=={'schema','unit','serviceState',
        'cgroupDisposition','terminalOrAbsentObserved','emptyOrAbsentCgroupObserved','complete'} and
         cleanup['schema']=='bw.code16-owned-service-cleanup.v1' and
         type(cleanup['unit']) is str and
         re.fullmatch(r'bw-current-cost-[1-9][0-9]*-1\.service',cleanup['unit']) and
         type(unit_after_raw) is bytes and len(unit_after_raw)<=8192,
         'closed owned-service cleanup original')
    state={}
    for line in unit_after_raw.decode('utf-8').splitlines():
        need(line.count('=')==1,'fixed systemctl property line')
        key,value=line.split('=',1)
        need(key not in state,'unique terminal service property')
        state[key]=value
    need(set(state)=={'LoadState','ActiveState','SubState','Result','ExecMainCode',
        'ExecMainStatus','ExecMainPID'} and cleanup['serviceState']==state,
        'independent terminal service-state original')
    terminal=state['LoadState']=='not-found' or (state['LoadState']=='loaded' and
        state['ActiveState'] in ('inactive','failed') and
        state['SubState'] in ('dead','failed','exited') and state['ExecMainPID']=='0')
    absent=cleanup['cgroupDisposition']=='absent'
    if absent:
        need(procs_after_raw is None and stat_after_raw is None and events_after_raw is None,
             'no alleged outside cgroup originals')
    else:
        stat=cgroup_fields(stat_after_raw);events=cgroup_fields(events_after_raw)
        need(procs_after_raw==b'' and all(type(stat.get(key)) is int and stat[key]==0
             for key in ('nr_descendants','nr_dying_descendants')) and
             type(events.get('populated')) is int and events['populated']==0,
             'outside owned cgroup empty including descendants')
    need(cleanup['cgroupDisposition'] in ('absent','present-empty') and
         cleanup['terminalOrAbsentObserved'] is terminal and terminal and
         cleanup['emptyOrAbsentCgroupObserved'] is True and cleanup['complete'] is True,
         'externally retained finite owned-service cleanup')
    first=parse(children[ORDER[0]]['source'],65536);runtime=parse(children[ORDER[0]]['runtime'],8192)
    need(type(first) is dict and set(first['diagnosticRoles'])==set(OWN) and
         first['diagnosticHead']==first['sourceHead'] and first['helpers']==HELPERS,
         'exact current source and immutable bounded helper roles')
    for name,row in first['diagnosticRoles'].items():
        need(type(row) is dict and set(row)=={'bytes','sha256'} and
             type(row['bytes']) is int and 0<row['bytes']<=65536 and
             type(row['sha256']) is str and len(row['sha256'])==64 and
             all(c in '0123456789abcdef' for c in row['sha256']),
             'finite source-role byte identity')
    results=[];semantics={}
    for name in ORDER:
        kind,mode=name.split('-')
        roles=children[name]
        exact(parse(roles['source'],65536),first,'same current source graph')
        exact(parse(roles['runtime'],8192),runtime,'same Node runtime')
        usage=parse(roles['usage'],16384)
        exact((usage['kind'],usage['mode']),(kind,mode),'serial child identity')
        result=audit(roles);results.append(result)
        sem=semantic(roles['stdout'],kind)
        comparable={key:sem[key] for key in ('state','steps','charges','cpuCycles','ifEnabled',
            'interrupts','ordinarySettings','devices')}
        if kind in semantics:exact(comparable,semantics[kind],'timing/profile semantic parity')
        else:semantics[kind]=comparable
        resource=parse(roles['resource'],65536)
        exact(resource['before']['unit'],cleanup['unit'],'same owned service')
        exact(resource['before']['membership'],'/system.slice/'+cleanup['unit'],'same cgroup')
    return {'schema':'bw.current-at-cost-original-reader.v1','reportedConsistencyPassed':True,
        'children':results,'sourceHead':first['sourceHead'],'sourceTree':first['sourceTree'],
        'nodeSha256':runtime['nodeSha256'],
        'officialMetadataAuthenticated':False,'physicalRTxQualified':False,
        'physical386FrequencyCalibrated':False,'measuredSpeedupQualified':False,
        'costSharesMeasured':False,'guestQualified':False}


def controls():
    import unittest
    class Cases(unittest.TestCase):
        def at_semantic(self):
            counters=[{'mode':0,'rw':0,'reload':0,'ce':0,'out':0,'armed':False,
                'nullCount':True,'gate':g} for g in (1,1,0)]
            return {'schema':'bw.current-at-cost-child.v1','kind':'at','mode':'timing',
                'requestedSteps':1000000,'steps':1000000,'charges':6000000,'cpuCycles':1000000,
                'state':{'ax':65534,'bx':65535,'ip':0,'word':65535},'ifEnabled':False,
                'interrupts':0,'ordinarySettings':{'translationCache':True,
                    'deliverFaults':True,'cpuProfile':'compatibility'},
                'startupNanoseconds':'10','warmupNanoseconds':'20',
                'setupNanoseconds':'10','executionLoopNanoseconds':'100',
                'warmupDoesNotContributeToMeasuredState':True,
                'physical386TimingCalibrated':False,
                'devices':{'machineCycles':6000000,'debt':5310,'deadline':16000,
                    'appliedClocks':5994690,'pitFraction':0.262723749965744,
                    'pitCounters':counters,'pics':[{'irr':0,'isr':0,'imr':0,
                        'vectorBase':0,'intActive':False} for _ in range(2)],
                    'rtc':{'cyclePhase':5994690,'periodicPhase':10562560,
                        'registerB':2,'registerC':64},
                    'cga':{'cycles':5994690,'frameCount':22,'lastVretrace':0},
                    'keyboard':{'commandByte':0,'queue':[{'value':170,'keyboard':True}],
                        'scheduled':0}}}
        def test_fixed_goldens_and_pending_not_delivered(self):
            value=self.at_semantic();semantic(json.dumps(value).encode(),'at')
            value['interrupts']=1
            with self.assertRaises(Refusal):semantic(json.dumps(value).encode(),'at')
            value['interrupts']=0;value['devices']['debt']=0
            with self.assertRaises(Refusal):semantic(json.dumps(value).encode(),'at')
        def test_profile_unknown_and_signed_samples_retained(self):
            raw=json.dumps({'nodes':[{'id':1,'callFrame':{'functionName':'unknown',
                'scriptId':'1','url':'unknown:kept','lineNumber':0,'columnNumber':0}}],
                'startTime':1,'endTime':20,'samples':[1,1],'timeDeltas':[4,-1]}).encode()
            result=profile_summary(raw,'core','file:///source','file:///fixture')
            self.assertEqual(result['rawDeltaSumMicroseconds'],3)
            self.assertEqual(result['frames'][0]['sourceRole'],'unresolved')
            changed=json.loads(raw);changed['samples'][0]=2
            with self.assertRaises(Refusal):
                profile_summary(json.dumps(changed).encode(),'core','file:///source','file:///fixture')
        def test_duplicate_and_bool_refused(self):
            with self.assertRaises(Refusal):parse(b'{"a":1,"a":2}',100)
            with self.assertRaises(Refusal):exact(True,1,'count')
        def test_independent_manifest_is_bounded_before_read(self):
            import tempfile
            with tempfile.TemporaryDirectory(prefix='bw-profile-reader-manifest-') as temporary:
                path=Path(temporary)/'source-rows.json'
                path.write_bytes(b'x'*65537)
                with self.assertRaises(Refusal):read_manifest(path)
        def packet_fixture(self):
            encode=lambda value:json.dumps(value,sort_keys=True,allow_nan=False).encode()
            source={'schema':'bw.current-at-cost-source.v1',
                'sourceHead':'a'*40,'diagnosticHead':'a'*40,'sourceTree':'d'*40,
                'sourceRoles':SOURCE_ROWS,'sourceRootURI':'file:///diagnostic',
                'diagnosticRootURI':'file:///diagnostic',
                'diagnosticRoles':{name:{'bytes':1,'sha256':'b'*64} for name in OWN},
                'helpers':HELPERS}
            runtime={'nodePath':'/fixed/node','nodeVersion':'22.23.3',
                'nodeBytes':NODE_BYTES,'nodeSha256':NODE_SHA,'python':'3.12 mock'}
            pos={'unit':'bw-current-cost-1-1.service',
                'membership':'/system.slice/bw-current-cost-1-1.service',
                'limits':{'cpu.max':'100000 100000','memory.max':'1073741824',
                    'memory.swap.max':'0'},'affinity':[0],
                'memoryEvents':{'max':0,'oom':0,'oom_kill':0},
                'observerPid':10,'directProcs':[10],
                'cgroupStat':{'nr_descendants':0,'nr_dying_descendants':0},
                'cgroupEvents':{'populated':1}}
            prof={'nodes':[{'id':1,'callFrame':{'functionName':'unknown','scriptId':'1',
                'url':'unknown:kept','lineNumber':0,'columnNumber':0}}],
                'startTime':1,'endTime':20,'samples':[1,1],'timeDeltas':[4,-1]}
            children={}
            for name in ORDER:
                kind,mode=name.split('-');sem=self.at_semantic()
                sem.update(kind=kind,mode=mode,charges=1000000 if kind=='core' else 6000000)
                if kind=='core':
                    sem['devices']=None
                    sem['ordinarySettings']={'translationCache':False,
                        'deliverFaults':False,'cpuProfile':'compatibility'}
                stdout=encode(sem)
                argv=['/fixed/node','--max-old-space-size=512']
                if mode=='profile':argv+=['--cpu-prof','--cpu-prof-interval=1000',
                    '--cpu-prof-dir=/output/'+name,'--cpu-prof-name=v8.cpuprofile']
                argv+=['/diagnostic/scripts/i80386-current-at-cost/fixture.mjs',kind,mode]
                usage={'kind':kind,'mode':mode,'argv':argv,
                    'requestedProfileIntervalMicroseconds':1000 if mode=='profile' else None,
                    'exitCode':0,'reaped':True,'timedOut':False,'cleanupErrors':[],
                    'observedStreamBytes':[len(stdout),0],'bufferPrefixBytes':[len(stdout),0],
                    'cpuSeconds':1.0,'wholeChildWallSeconds':1.1}
                import copy
                child=copy.deepcopy(pos);child['observerPid']=11;child['directProcs']=[10,11]
                child['profileFileLimitBytes']=PROFILE_CAP
                resource={'before':pos,'after':pos,'sourceBefore':source,'sourceAfter':source,
                    'runtimeBeforeSha256':NODE_SHA,'runtimeAfterSha256':NODE_SHA}
                roles={'stdout':stdout,'stderr':b'','usage':encode(usage),
                    'resource':encode(resource),'preexec':encode(child),
                    'source':encode(source),'runtime':encode(runtime)}
                if mode=='profile':roles['profile']=encode(prof)
                children[name]=roles
            state={'LoadState':'not-found','ActiveState':'inactive','SubState':'dead',
                'Result':'success','ExecMainCode':'0','ExecMainStatus':'0','ExecMainPID':'0'}
            show=''.join(key+'='+value+'\n' for key,value in state.items()).encode()
            cleanup=encode({'schema':'bw.code16-owned-service-cleanup.v1',
                'serviceState':state,'cgroupDisposition':'absent','complete':True,
                'terminalOrAbsentObserved':True,
                'emptyOrAbsentCgroupObserved':True,'unit':pos['unit']})
            return children,cleanup,show
        def test_four_serial_mock_originals_and_coherent_cuts(self):
            children,cleanup,show=self.packet_fixture()
            result=packet(children,cleanup,show,None)
            self.assertTrue(result['reportedConsistencyPassed'])
            self.assertEqual([row['mode'] for row in result['children']],
                             ['timing','profile','timing','profile'])
            self.assertFalse(result['physicalRTxQualified'])
            import copy
            for name,role,change in (
                ('core-timing','usage',lambda v:v['argv'].__setitem__(1,'--jitless')),
                ('at-profile','usage',lambda v:v.__setitem__('requestedProfileIntervalMicroseconds',None)),
                ('at-timing','source',lambda v:v.__setitem__('sourceHead','d'*40)),
                ('core-profile','profile',lambda v:v['samples'].__setitem__(0,2))):
                with self.subTest(name=name,role=role):
                    changed=copy.deepcopy(children);v=json.loads(changed[name][role]);change(v)
                    changed[name][role]=json.dumps(v).encode()
                    with self.assertRaises(Refusal):packet(changed,cleanup,show,None)
            bad=json.loads(cleanup);bad['complete']=False
            with self.assertRaises(Refusal):packet(children,json.dumps(bad).encode(),show,None)
            with self.assertRaises(Refusal):packet(children,cleanup,show.replace(b'not-found',b'loaded'),None)
        def test_missing_fourth_child_refused(self):
            with self.assertRaises(Refusal):packet({},b'{}',b'',None)
        def test_nested_or_dying_cgroup_and_selected_node_cuts(self):
            import copy
            children,cleanup,show=self.packet_fixture()
            for field in ('nr_descendants','nr_dying_descendants'):
                changed=copy.deepcopy(children)
                row=json.loads(changed['core-timing']['resource'])
                row['before']['cgroupStat'][field]=1
                changed['core-timing']['resource']=json.dumps(row).encode()
                with self.assertRaises(Refusal):packet(changed,cleanup,show,None)
            changed=copy.deepcopy(children)
            runtime=json.loads(changed['at-profile']['runtime']);runtime['nodeSha256']='c'*64
            changed['at-profile']['runtime']=json.dumps(runtime).encode()
            with self.assertRaises(Refusal):packet(changed,cleanup,show,None)
            changed=copy.deepcopy(children)
            pre=json.loads(changed['core-profile']['preexec']);pre['profileFileLimitBytes']+=1
            changed['core-profile']['preexec']=json.dumps(pre).encode()
            with self.assertRaises(Refusal):packet(changed,cleanup,show,None)
        def test_outside_held_cgroup_empty_and_nested_refusal(self):
            children,cleanup,show=self.packet_fixture()
            row=json.loads(cleanup);row['cgroupDisposition']='present-empty'
            cleanup=json.dumps(row).encode()
            stat=b'nr_descendants 0\nnr_dying_descendants 0\n'
            events=b'populated 0\nfrozen 0\n'
            self.assertTrue(packet(children,cleanup,show,b'',stat,events)['reportedConsistencyPassed'])
            for bad_stat,bad_events in ((b'nr_descendants 1\nnr_dying_descendants 0\n',events),
                                        (b'nr_descendants 0\nnr_dying_descendants 1\n',events),
                                        (stat,b'populated 1\n'),
                                        (b'nr_descendants 0\n',events)):
                with self.assertRaises(Refusal):
                    packet(children,cleanup,show,b'',bad_stat,bad_events)
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Cases))
    need(result.wasSuccessful(),'independent reader controls')


def cli():
    import sys,stat
    if sys.argv[1:]==['--controls']:controls();return
    need(len(sys.argv)==4 and sys.argv[1]=='--packet','fixed original-only CLI')
    directory=Path(sys.argv[2]);context=Path(sys.argv[3])
    def original(path,cap):
        before=path.lstat()
        need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and
             0<=before.st_size<=cap,'finite regular original')
        with path.open('rb') as stream:raw=stream.read(cap+1)
        after=path.lstat()
        need(len(raw)==before.st_size and len(raw)<=cap and
             (before.st_dev,before.st_ino,before.st_mode,before.st_nlink,
              before.st_size,before.st_mtime_ns)==
             (after.st_dev,after.st_ino,after.st_mode,after.st_nlink,
              after.st_size,after.st_mtime_ns),
             'held original bytes and named extent')
        return raw
    children={}
    for name in ORDER:
        names={'stdout':('stdout.original',262144),'stderr':('stderr.original',8192),
            'usage':('usage.original.json',16384),'resource':('resource.original.json',65536),
            'preexec':('resource-preexec.original.json',8192)}
        if name.endswith('profile'):names['profile']=('v8.cpuprofile',8388608)
        children[name]={key:original(directory/name/filename,cap)
                        for key,(filename,cap) in names.items()}
        children[name]['source']=original(directory/'source.original.json',65536)
        children[name]['runtime']=original(directory/'runtime.original.json',8192)
    cleanup_raw=original(context/'owned-service-cleanup.json',16384)
    cleanup=parse(cleanup_raw,16384)
    procs=(original(context/'cgroup-procs-after.original',8192)
           if cleanup.get('cgroupDisposition')=='present-empty' else None)
    stat_raw=(original(context/'cgroup-stat-after.original',8192)
              if cleanup.get('cgroupDisposition')=='present-empty' else None)
    events_raw=(original(context/'cgroup-events-after.original',8192)
                if cleanup.get('cgroupDisposition')=='present-empty' else None)
    result=packet(children,cleanup_raw,original(context/'unit-after-cleanup.original',8192),
                  procs,stat_raw,events_raw)
    with (context/'independent-reader.json').open('x') as stream:
        json.dump(result,stream,sort_keys=True,allow_nan=False);stream.write('\n')
if __name__=='__main__':cli()
