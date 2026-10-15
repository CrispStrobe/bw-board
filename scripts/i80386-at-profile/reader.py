"""Independent byte-only original reader; imports no producer/helpers."""
import hashlib,json,math
from pathlib import Path
PROFILE_CAP=8388608
INTERVAL=1000
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
        role='CPU' if url==source_uri+'/src/experimental/i80386.js' else 'AT scheduler/devices' if url in {source_uri+'/'+name for name in SOURCE_ROWS if name.startswith('src/')} else 'fixture' if url==fixture_uri else 'Node builtin' if url.startswith('node:') else 'V8 GC' if name=='(garbage collector)' and url=='' else 'unresolved'
        frames.append({'nodeId':identifier,'sourceRole':role,'functionName':name,'url':url,'lineNumber':frame['lineNumber'],'columnNumber':frame['columnNumber'],'deoptReason':node.get('deoptReason'),**weights[identifier]})
    return {'schema':'bw.at-v8-profile-summary.v1','arm':arm,'profileSha256':hashlib.sha256(raw).hexdigest(),'profileBytes':len(raw),'recordedDurationMicroseconds':duration,'requestedSamplingIntervalMicroseconds':INTERVAL,'totalSamples':len(samples),'rawDeltaSumMicroseconds':sum(deltas),'unusualNonpositiveDeltaCount':sum(v<=0 for v in deltas),'frames':frames,'sampleWeightsAreExactCPUCosts':False,'allocationCountsMeasured':False,'completeOSStartupCovered':False,'pairedPerformanceGate':False,'adoptionQualified':False}


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
    need(type(v) is dict and set(v)=={'schema','kind','steps','charges','cpuCycles','state','ifEnabled','interrupts','ordinarySettings','devices','setupNanoseconds','executionLoopNanoseconds'},'semantic fields')
    exact(v['schema'],'bw.at-profile-child.v1','schema');exact(v['kind'],kind,'kind')
    exact(v['steps'],1000000,'steps');exact(v['cpuCycles'],1000000,'cpu completed')
    exact(v['charges'],1000000 if kind=='core' else 6000000,'charge')
    exact(v['state'],{'ax':65534,'bx':65535,'ip':0,'word':65535},'authored architecture')
    exact(v['ordinarySettings'],{'translationCache':kind=='at','deliverFaults':kind=='at','cpuProfile':'compatibility'},'ordinary constructor settings')
    exact(v['ifEnabled'],False,'IF clear');exact(v['interrupts'],0,'delivered IRQ')
    need(type(v['setupNanoseconds']) is str and v['setupNanoseconds'].isdigit() and 0<int(v['setupNanoseconds'])<=60000000000,'setup window')
    need(type(v['executionLoopNanoseconds']) is str and v['executionLoopNanoseconds'].isdigit() and 0<int(v['executionLoopNanoseconds'])<=60000000000,'loop window')
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

SOURCE_ROWS = {'package.json': {'bytes': 2969, 'sha256': 'ff91e0e077c6e39cea49f5c1f07219637fee72f206a670649178a6a09d5e3e8c'}, 'src/adc0809.js': {'bytes': 6267, 'sha256': '92926d8bd4315fa837d6cce7bc3770148960d181802eb52ba5d9aa013e5f64af'}, 'src/at-8042-a20.js': {'bytes': 19631, 'sha256': 'c604c8a272034a9a80eeb30abe1c5d6ab09ebe6c816b3f3c778874f6b9a9f6b8'}, 'src/at-ps2-mouse.js': {'bytes': 2891, 'sha256': 'b75f93e3a4473e21568af438d658941e9a9703ab330147b8f444baba278281ea'}, 'src/at-system-control.js': {'bytes': 2682, 'sha256': 'aaeecd1c9ea926f4d35481a46be3f64075367152144756786443041018c443e7'}, 'src/audio-bus.js': {'bytes': 10590, 'sha256': '95a263b2432f8309b76a64a0b6dcf0ddcc1dd61aeabb7a8727505f343e26ba08'}, 'src/cga-card.js': {'bytes': 10416, 'sha256': 'afb6141ce8420556e8e9acfff7642225d46f5509db20459bd6fdaba8d0b50fdc'}, 'src/chip-ledger.js': {'bytes': 6217, 'sha256': 'b12b5d635086636f0f9f405e4a06816943b74c03c1b036fcbd3ffe813055ac3a'}, 'src/dac0832.js': {'bytes': 5848, 'sha256': '81b24b9c8f461cbd2f4a9bcd1aceda3e366062841d1c530440eccdb8cbeae787'}, 'src/ega-card.js': {'bytes': 6552, 'sha256': '5b93057ca256f7a43046b477127862278c80bb9849e062528c1cd603f7e3d2f5'}, 'src/experimental/ata16.js': {'bytes': 13489, 'sha256': 'bcf08d6e5e2316cfefe7e264c587e6d23e94b5a4f4e5099c8aace162164a88b7'}, 'src/experimental/i80286-protected.js': {'bytes': 73806, 'sha256': 'b3e00b7bd10e1e02d9e9a27bf543f620229e5f9f888dddf4c9ef0a2127826e70'}, 'src/experimental/i80386-at-machine.js': {'bytes': 26851, 'sha256': '6c5f12cc92ba7219ed4b53f6237622f6ce58269402ee14770791e04c68f93cb0'}, 'src/experimental/i80386.js': {'bytes': 134357, 'sha256': '2303557f35ad56d8101eb96ffc8749fa4d64338425726027d70bd64a6b10d4ba'}, 'src/experimental/vga-memory.js': {'bytes': 7229, 'sha256': '966109bdc8c55992474175dae31dcff4a6d609a64a0cbf2db7b6976e16ee001a'}, 'src/hercules-card.js': {'bytes': 4798, 'sha256': '6e3af9bce88edbc609b2f8a07dc464b8a1fb60ce5fd800a4d345dac61367752b'}, 'src/i8086-machine.js': {'bytes': 128619, 'sha256': '7cf7fdf4e6de451071809e32e128aa0ac663524eaf8b2e08581780b0ec4f167c'}, 'src/i8086-ram-words.js': {'bytes': 1656, 'sha256': '5bfdcf9743a73d1fc37afe78949f045d2aeb2d3d7b71561a694af96a443da6c5'}, 'src/i8086.js': {'bytes': 107519, 'sha256': '814d2a96184f7b490905f25317197ec0dcea8128e234efcf3fe3f173f799300a'}, 'src/i8237.js': {'bytes': 26099, 'sha256': 'a2a774349848e797861108c59a9563a281ce1c1b561a201b8dc022d5584142ad'}, 'src/i8251.js': {'bytes': 9962, 'sha256': '45a2df29bc0920e7d57188a365e8c05addab0805efc1eb02d8df72a41d4dca2b'}, 'src/i8254.js': {'bytes': 18502, 'sha256': '4346fc1eb6b2d368480292372ac8cec7db8cac6baf94d6a88c7311b1809a8c30'}, 'src/i8255.js': {'bytes': 8295, 'sha256': '3445ac6676005f225db542031be51b6d1561045d2be76be339e5853a50f6ff7f'}, 'src/i8259.js': {'bytes': 19093, 'sha256': 'fcfca4a160bac3cf4b72ca0613c63ca702cd26d6822000ba75a0035ef87da278'}, 'src/machine-checkpoint.js': {'bytes': 8280, 'sha256': '576a8420212a8eedaf89dc0dff27cb26e8a7e73c89162e242d65b8e1cc3f0139'}, 'src/mc146818.js': {'bytes': 12655, 'sha256': 'f6caa1e99c2f0fc323cab7a913df68435c5c13c4a86d3c89a8b55ccdde2ec80c'}, 'src/mc6845.js': {'bytes': 11052, 'sha256': '30c369c37fc4030162dde6d46bea388ce9acbf489141195ab166f3c0cab5c599'}, 'src/mc6850.js': {'bytes': 2854, 'sha256': 'e987c5243a92a7b43533a99ff9bf2da29e0bd608a2417162c7b5dfeb1cb75889'}, 'src/ne2000.js': {'bytes': 17462, 'sha256': '12a97f87807aaf74a94245d81acddfb10f43748c09a1d4633e0ba7959b7a1244'}, 'src/ns16c550.js': {'bytes': 8784, 'sha256': '34633ec3bec4d0826998fadde5e11bf88f20dfd32fc5a09144c6bad64461f41b'}, 'src/pc-speaker.js': {'bytes': 6434, 'sha256': '50260dcd04eaedd84373e5c2b1e42faa2f1bc924833b6bdf0aa7d23a80ea9499'}, 'src/sb-dsp.js': {'bytes': 13475, 'sha256': '901fc1d6536e19a552380d226b8e285ff4ab29f871a319d552701c2100044f71'}, 'src/upd765.js': {'bytes': 53603, 'sha256': 'b5a066fd577ee358f40c13682015d28be490acbeb00a50d8c7199671523fcde4'}, 'src/vga-card.js': {'bytes': 10652, 'sha256': '245d777aeae5513a5cae02e943d1e18a5b333bd03352dd2717eee51b8c3e5d71'}, 'src/ym3812.js': {'bytes': 15069, 'sha256': 'c78833b8efb3048143e7fac898a7af5374ce3f00f1b9e5b55baa6d212a51df04'}}

def audit(roles):
    need(type(roles) is dict and set(roles)=={'stdout','stderr','usage','resource','preexec','profile','source','runtime'},'six original roles')
    source=parse(roles['source'],65536);runtime=parse(roles['runtime'],8192)
    exact(source['sourceHead'],'4d17e27c6bb1b3b329ccb53620d342c3b031e672','source revision')
    exact(source['sourceRoles'],SOURCE_ROWS,'complete source closure')
    need(type(source['sourceRootURI']) is str and source['sourceRootURI'].startswith('file:///'),'reported source URI')
    need(type(source['diagnosticHead']) is str and len(source['diagnosticHead'])==40,'publication head')
    exact(runtime['nodeVersion'],'20.20.2','runtime version')
    need(type(runtime['nodeSha256']) is str and len(runtime['nodeSha256'])==64,'runtime hash')
    usage=parse(roles['usage'],16384);res=parse(roles['resource'],65536);pre=parse(roles['preexec'],8192)
    kind=usage.get('kind');need(kind in ('core','at'),'path kind')
    fixture_uri=source['diagnosticRootURI']+'/scripts/i80386-at-profile/fixture.mjs'
    fixture_path=str(Path(fixture_uri.removeprefix('file://')))
    argv=usage['argv'];need(type(argv) is list and len(argv)==8,'fixed argv extent')
    exact(usage['requestedProfileIntervalMicroseconds'],1000,'requested sample interval')
    need(type(runtime['nodePath']) is str and runtime['nodePath'].startswith('/'),'runtime executable path')
    exact(argv[:5],[runtime['nodePath'],'--max-old-space-size=512','--cpu-prof','--cpu-prof-interval=1000',argv[4]],'fixed Node options')
    need(type(argv[4]) is str and argv[4].startswith('--cpu-prof-dir=') and argv[4].endswith('/'+kind),'owned profile directory')
    exact(argv[5:],['--cpu-prof-name=v8.cpuprofile',fixture_path,kind],'fixed fixture command')
    semantic(roles['stdout'],kind);exact(roles['stderr'],b'','empty stderr')
    exact(usage['exitCode'],0,'exit');exact(usage['reaped'],True,'owned reap');exact(usage['timedOut'],False,'timeout');exact(usage['cleanupErrors'],[],'cleanup')
    exact(usage['observedStreamBytes'],[len(roles['stdout']),0],'complete streams');exact(usage['bufferPrefixBytes'],[len(roles['stdout']),0],'prefix')
    for k in ('cpuSeconds','wholeChildWallSeconds'):
        need(type(usage[k]) in (int,float) and math.isfinite(usage[k]) and usage[k]>0,'finite child metric')
    exact(res['sourceBefore'],source,'source before original');exact(res['sourceAfter'],source,'source after original')
    exact(res['runtimeBeforeSha256'],runtime['nodeSha256'],'runtime before');exact(res['runtimeAfterSha256'],runtime['nodeSha256'],'runtime after')
    for position in [res['before'],pre,res['after']]:
        exact(position['limits'],{'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0'},'resource policy')
        need(type(position['affinity']) is list and len(position['affinity'])==1 and type(position['affinity'][0]) is int,'one CPU')
        need(type(position['memoryEvents']) is dict and {'max','oom','oom_kill'}<=set(position['memoryEvents']) and all(type(x) is int and x==0 for x in position['memoryEvents'].values()),'pressure zero')
    exact(res['before'],pre,'preexec resources');exact(res['before'],res['after'],'after resources')
    return profile_summary(roles['profile'],kind,source['sourceRootURI'],usage['argv'][-2] if usage['argv'][-2].startswith('file:') else Path(usage['argv'][-2]).as_uri())

def controls():
    import unittest,copy
    class Cases(unittest.TestCase):
        def profile(self):return {'nodes':[{'id':1,'callFrame':{'functionName':'unknown','scriptId':'1','url':'unknown:kept','lineNumber':0,'columnNumber':0}}],'startTime':1,'endTime':20,'samples':[1,1],'timeDeltas':[4,-1]}
        def semantic_fixture(self):
            counters=[{'mode':0,'rw':0,'reload':0,'ce':0,'out':0,'armed':False,'nullCount':True,'gate':g} for g in (1,1,0)]
            return {'schema':'bw.at-profile-child.v1','kind':'at','steps':1000000,'charges':6000000,'cpuCycles':1000000,'state':{'ax':65534,'bx':65535,'ip':0,'word':65535},'ifEnabled':False,'interrupts':0,'ordinarySettings':{'translationCache':True,'deliverFaults':True,'cpuProfile':'compatibility'},'setupNanoseconds':'10','executionLoopNanoseconds':'100','devices':{'machineCycles':6000000,'debt':5310,'deadline':16000,'appliedClocks':5994690,'pitFraction':0.262723749965744,'pitCounters':counters,'pics':[{'irr':0,'isr':0,'imr':0,'vectorBase':0,'intActive':False} for _ in range(2)],'rtc':{'cyclePhase':5994690,'periodicPhase':10562560,'registerB':2,'registerC':64},'cga':{'cycles':5994690,'frameCount':22,'lastVretrace':0},'keyboard':{'commandByte':0,'queue':[{'value':170,'keyboard':True}],'scheduled':0}}}
        def test_authored_positive_oracle(self):semantic(json.dumps(self.semantic_fixture()).encode(),'at')
        def test_debt_not_applied(self):
            p=self.semantic_fixture();p['devices']['appliedClocks']=6000000
            with self.assertRaises(Refusal):semantic(json.dumps(p).encode(),'at')
        def test_no_pending_as_delivery(self):
            p=self.semantic_fixture();p['interrupts']=1
            with self.assertRaises(Refusal):semantic(json.dumps(p).encode(),'at')
        def test_wrong_tick_fraction(self):
            p=self.semantic_fixture();p['devices']['pitFraction']=0.5
            with self.assertRaises(Refusal):semantic(json.dumps(p).encode(),'at')
        def packet_fixture(self):
            encode=lambda x:json.dumps(x).encode()
            names=['package.json','.github/workflows/i80386-at-profile.yml','scripts/i80386-at-profile/fixture.mjs','scripts/i80386-at-profile/profile.py','scripts/i80386-at-profile/reader.py','scripts/i80386-at-profile/README.md','test/i80386-at-profile-fixture.test.mjs']
            source={'sourceHead':'4d17e27c6bb1b3b329ccb53620d342c3b031e672','sourceRoles':SOURCE_ROWS,'sourceRootURI':'file:///source','diagnosticRootURI':'file:///diagnostic','diagnosticHead':'a'*40,'diagnosticRoles':{n:{'bytes':1,'sha256':'b'*64} for n in names},'helpers':{'run.py':'8b941d7af7ae7dfd6c0300b317bd7d2530ecf44b4e9bd6fc2e0d61b89c7f1467','policy.py':'a3ec7bd0a74f38d070babfc39eedfe7afd8d1aaf2e579002749a06cd19f2d659'}}
            runtime={'nodePath':'/fixed/node','nodeVersion':'20.20.2','nodeSha256':'c'*64}
            position={'unit':'bw-at-profile-1-1.service','membership':'/system.slice/bw-at-profile-1-1.service','limits':{'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0'},'affinity':[0],'memoryEvents':{'max':0,'oom':0,'oom_kill':0}}
            roles={}
            for kind in ('core','at'):
                sem=self.semantic_fixture()
                if kind=='core':sem.update(kind='core',charges=1000000,devices=None,ordinarySettings={'translationCache':False,'deliverFaults':False,'cpuProfile':'compatibility'})
                stdout=encode(sem)
                usage={'kind':kind,'argv':['/fixed/node','--max-old-space-size=512','--cpu-prof','--cpu-prof-interval=1000','--cpu-prof-dir=/output/'+kind,'--cpu-prof-name=v8.cpuprofile','/diagnostic/scripts/i80386-at-profile/fixture.mjs',kind],'requestedProfileIntervalMicroseconds':1000,'exitCode':0,'reaped':True,'timedOut':False,'cleanupErrors':[],'observedStreamBytes':[len(stdout),0],'bufferPrefixBytes':[len(stdout),0],'cpuSeconds':1.0,'wholeChildWallSeconds':1.1}
                resource={'before':position,'after':position,'sourceBefore':source,'sourceAfter':source,'runtimeBeforeSha256':'c'*64,'runtimeAfterSha256':'c'*64}
                roles[kind]={'stdout':stdout,'stderr':b'','usage':encode(usage),'resource':encode(resource),'preexec':encode(position),'profile':encode(self.profile()),'source':encode(source),'runtime':encode(runtime)}
            return roles,encode({'complete':True,'terminalOrAbsentObserved':True,'emptyOrAbsentCgroupObserved':True,'unit':position['unit']})
        def test_complete_manufactured_packet(self):
            roles,clean=self.packet_fixture();self.assertTrue(packet(roles,clean)['reportedConsistencyPassed'])
        def test_substituted_command_refused(self):
            roles,clean=self.packet_fixture();v=json.loads(roles['at']['usage']);v['argv'][1]='--jitless';roles['at']['usage']=json.dumps(v).encode()
            with self.assertRaises(Refusal):packet(roles,clean)
        def test_uncertain_cleanup_refused(self):
            roles,clean=self.packet_fixture();v=json.loads(clean);v['complete']=False
            with self.assertRaises(Refusal):packet(roles,json.dumps(v).encode())
        def test_source_after_drift_refused(self):
            roles,clean=self.packet_fixture();v=json.loads(roles['at']['resource']);v['sourceAfter']['sourceHead']='d'*40;roles['at']['resource']=json.dumps(v).encode()
            with self.assertRaises(Refusal):packet(roles,clean)
        def test_signed_unknown_weights(self):
            r=profile_summary(json.dumps(self.profile()).encode(),'core','file:///source','file:///fixture');self.assertEqual(r['rawDeltaSumMicroseconds'],3);self.assertEqual(r['frames'][0]['sampleCount'],2)
        def test_reference(self):
            p=self.profile();p['samples'][0]=2
            with self.assertRaises(Refusal):profile_summary(json.dumps(p).encode(),'core','file:///source','file:///fixture')
        def test_duplicate(self):
            with self.assertRaises(Refusal):parse(b'{"a":1,"a":2}',100)
        def test_bool_count(self):
            with self.assertRaises(Refusal):exact(True,1,'count')
        def test_no_missing_roles(self):
            with self.assertRaises(Refusal):audit({})
    result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(Cases))
    need(result.wasSuccessful(),'reader controls')

def packet(roles,cleanup_raw):
    need(type(roles) is dict and list(roles)==['core','at'],'fixed profile order')
    cleanup=parse(cleanup_raw,16384)
    exact(cleanup['complete'],True,'external cleanup')
    exact(cleanup['terminalOrAbsentObserved'],True,'unit terminal')
    exact(cleanup['emptyOrAbsentCgroupObserved'],True,'cgroup empty')
    first=parse(roles['core']['source'],65536)
    runtime=parse(roles['core']['runtime'],8192)
    need(type(first['diagnosticRoles']) is dict and set(first['diagnosticRoles'])=={'package.json','.github/workflows/i80386-at-profile.yml','scripts/i80386-at-profile/fixture.mjs','scripts/i80386-at-profile/profile.py','scripts/i80386-at-profile/reader.py','scripts/i80386-at-profile/README.md','test/i80386-at-profile-fixture.test.mjs'},'publication role census')
    for row in first['diagnosticRoles'].values():
        need(type(row) is dict and set(row)=={'bytes','sha256'} and type(row['bytes']) is int and 0<row['bytes']<=65536,'publication row')
        need(type(row['sha256']) is str and len(row['sha256'])==64 and all(c in '0123456789abcdef' for c in row['sha256']),'publication digest')
    exact(first['helpers'],{'run.py':'8b941d7af7ae7dfd6c0300b317bd7d2530ecf44b4e9bd6fc2e0d61b89c7f1467','policy.py':'a3ec7bd0a74f38d070babfc39eedfe7afd8d1aaf2e579002749a06cd19f2d659'},'immutable helper pins')
    summaries=[]
    for kind in ('core','at'):
        exact(parse(roles[kind]['source'],65536),first,'same source graph')
        exact(parse(roles[kind]['runtime'],8192),runtime,'same runtime')
        summary=audit(roles[kind]);summaries.append(summary)
        res=parse(roles[kind]['resource'],65536)
        exact(res['before']['unit'],cleanup['unit'],'cleanup owned unit')
        exact(res['before']['membership'],'/system.slice/'+cleanup['unit'],'resource cgroup ownership')
    return {'schema':'bw.at-original-packet-reader.v1','reportedConsistencyPassed':True,'profiles':summaries,'originalMetadataAuthenticated':False,'costSharesMeasured':False,'physicalRTxQualified':False,'OSQualified':False}

def cli():
    import sys,stat
    if sys.argv[1:]==['--controls']:controls();return
    need(len(sys.argv)==4 and sys.argv[1]=='--packet','fixed packet CLI')
    directory=Path(sys.argv[2]);context=Path(sys.argv[3])
    def original(path,cap):
        before=path.lstat();need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and 0<=before.st_size<=cap,'original role extent')
        with path.open('rb') as f:raw=f.read(cap+1)
        need(len(raw)==before.st_size and len(raw)<=cap,'original role bytes');return raw
    roles={}
    for kind in ('core','at'):
        names={'stdout':('stdout.original',262144),'stderr':('stderr.original',8192),'usage':('usage.original.json',16384),'resource':('resource.original.json',65536),'preexec':('resource-preexec.original.json',8192),'profile':('v8.cpuprofile',8388608)}
        roles[kind]={key:original(directory/kind/name,cap) for key,(name,cap) in names.items()}
        roles[kind]['source']=original(directory/'source.original.json',65536);roles[kind]['runtime']=original(directory/'runtime.original.json',8192)
    result=packet(roles,original(context/'owned-service-cleanup.json',16384))
    # Derived result is separate; source originals are never rewritten.
    with (context/'independent-reader.json').open('x') as f:json.dump(result,f,sort_keys=True,allow_nan=False);f.write('\n')
if __name__=='__main__':cli()
