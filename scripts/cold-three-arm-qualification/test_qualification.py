"""Manufactured protocol/source fixtures only; no guest or subprocess."""
import sys
sys.dont_write_bytecode=True
import copy,json,unittest,unittest.mock
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import policy,admission,qualify
def fixture(arm='native-batched'):
    # Explicitly manufactured terminal inspect + matching final resume. The
    # eighth capture retained final inspect, not an actual final-resume record.
    native={'state':[0]*20,'extra':[0]*20,'segments':[0]*90,'system':[0]*30,'debug':[0]*6,'nativeTicks':'12','successfulQuanta':'10','mappingEpoch':0,'boardA20':1,'clockTransfers':{k:'0' for k in ('transfers','commits','words')},'callbacks':{k:'0' for k in ('physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks')},'fallback':{k:'0' for k in ('bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer')},'execution':{k:'0' for k in ('attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts')}}
    native['state'][8]=0xe16;native['state'][10]=0x7ffffff0;native['state'][13]=0xf000
    files={'lock.json':'a'*64,'source.mjs':'a'*64};revision='b'*40;source={'revision':revision,'hashes':files};b={'workers':{k:{'revision':revision,'files':files,'binding':'lock.json'} for k in ('native','plainJs')},'compiledFiles':{'source':'c'*64},'targetN':12,'targetQ':10,'configuredClockHz':6000000,'node':{'sha256':'d'*64},'capture':{'sha256':'e'*64},'independentAudit':{'sha256':'f'*64},'nativeInput':{'sha256':'1'*64}}
    ports=[{'ordinal':1,'dir':'out','port':0x64,'width':8,'value':0xaa,'q':3,'cycles':16},{'ordinal':2,'dir':'in','port':0x60,'width':8,'value':0x55,'q':9,'cycles':52}];board={'cycles':64,'debt':0,'a20Enabled':True,'pic1':{'irr':1,'imr':0,'isr':0}};final={'q':10,'cpu':{'cycles':10,'edx':0},'board':board,'ramSha256':'2'*64}
    capture={'progress':{'n':12,'q':10},'cuts':[{'name':'before-F000-E16','native':copy.deepcopy(native)}],'javascriptFinal':final,'javascriptPorts':ports};data={'mode':'oneQ' if arm=='native-oneQ' else 'batched'}
    timing={'cpuMicroseconds':{'user':200000,'system':10000},'wallNanoseconds':'300000000'};r={'input':data,'nodeSha256Before':'d'*64,'nodeSha256After':'d'*64,'prerequisite':{'bindingSha256':'a'*64,'captureSha256':'e'*64,'independentAuditSha256':'f'*64}}
    if arm=='plain-JS':r.update(schema='bw.cold-plain-js.worker.v1',status='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS',sourceBefore=source,sourceAfter=copy.deepcopy(source),result={'final':copy.deepcopy(final),'ports':copy.deepcopy(ports),'timing':timing})
    else:
        compiled={'revision':policy.COMPILED,'hashes':b['compiledFiles']};build={'addonSha256':'1'*64};native_ports=[{**p,'successfulQuanta':p['q']-1,'nativeTicks':p['q']+2} for p in ports]
        r.update(schema='bw.cold-native-performance.worker.v1',status='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS',workerBefore=source,workerAfter=copy.deepcopy(source),compiledBefore=compiled,compiledAfter=copy.deepcopy(compiled),buildBefore=build,buildAfter=copy.deepcopy(build),finalNative=copy.deepcopy(native),lastReturnedNative={**copy.deepcopy(native),'activityState':0,'reason':1,'chargedNativeTicks':1,'chargedQuanta':1,'sliceBytes':[0]*160},finalBoard={'state':{'board':copy.deepcopy(board),'nativeTicks':12,'successfulQuanta':10,'cold':{'phase':'complete'}},'ramSha256':'2'*64},ports=native_ports,executionTiming=timing)
    return r,data,b,capture

class QualificationControls(unittest.TestCase):
    def test_pending_and_disabled_never_spawn_or_download(self):
        pending=copy.deepcopy(admission.read_json(admission.HERE/'contract.json'));pending['status']='PENDING_ROOT_SOURCE_REVIEW'
        with unittest.mock.patch.object(qualify,'read_json',return_value=pending),unittest.mock.patch.object(qualify.subprocess,'Popen',side_effect=AssertionError('must never spawn')),unittest.mock.patch.object(qualify,'download',side_effect=AssertionError('must never download')):
            qualify.main('disabled')
            with self.assertRaisesRegex(ValueError,'pending'):qualify.main('enabled')
    def test_fixed_roles_bounds_and_worker_closure_mutations(self):
        c=admission.read_json(admission.HERE/'contract.json');c['status']='ROOT_REVIEWED_THREE_ARM_SOURCE_READY';admission.validate_contract(c)
        for change in [lambda x:x['order'].reverse(),lambda x:x['bounds'].update(cpuSeconds=61),lambda x:x.update(targetN=316561),lambda x:x['buildArtifact'].update(zipSha256='a'*64),lambda x:x['workers']['native']['files'].pop('package.json'),lambda x:x['workers']['plainJs'].update(sourceSha256='b'*64)]:
            v=copy.deepcopy(c);change(v)
            with self.assertRaises(ValueError):admission.validate_contract(v)
    def test_genuine_source_packets_and_missing_packet_stop_before_execution(self):
        c=admission.read_json(admission.HERE/'contract.json');admission.validate_source_packets(c)
        actual=admission.read_json(admission.HERE/'source-fixtures/eighth-snapshot-shapes.json');self.assertEqual(actual['captureSha256'],c['captureArtifact']['captureSha256'])
        reset,final,resume=(actual['snapshots'][k] for k in ('reset','before-F000-E16','rep-entry-e0c4'))
        policy.validate_inspect_snapshot(reset);policy.validate_inspect_snapshot(final);policy.validate_resume_snapshot(resume)
        self.assertEqual((policy.counter(reset['nativeTicks']),policy.counter(reset['successfulQuanta'])),(0,0));self.assertEqual((policy.counter(final['nativeTicks']),policy.counter(final['successfulQuanta'])),(c['targetN'],c['targetQ']))
        for inspect in (reset,final):
            self.assertNotIn('activityState',inspect)
            with self.assertRaises(ValueError):policy.validate_resume_snapshot(inspect)
        with self.assertRaises(ValueError):policy.validate_inspect_snapshot(resume)
        for mutate in [lambda x:x.pop('activityState'),lambda x:x.update(activityState=1),lambda x:x.update(reason=2),lambda x:x.update(chargedNativeTicks=601),lambda x:x.update(chargedQuanta=301),lambda x:x['sliceBytes'].pop(),lambda x:x['sliceBytes'].__setitem__(0,256)]:
            v=copy.deepcopy(resume);mutate(v)
            with self.assertRaises(ValueError):policy.validate_resume_snapshot(v)
        v=copy.deepcopy(c);v['workers']['native']['sourceQualification']['records']['stdout']['sha256']='c'*64
        with self.assertRaises(ValueError):admission.validate_source_packets(v)
        v=copy.deepcopy(c);v['status']='ROOT_REVIEWED_THREE_ARM_SOURCE_READY'
        with unittest.mock.patch.object(qualify,'read_json',return_value=v),unittest.mock.patch.object(qualify,'validate_source_packets',side_effect=ValueError('manufactured packet missing')),unittest.mock.patch.object(qualify.subprocess,'Popen',side_effect=AssertionError('must never spawn')):
            with self.assertRaisesRegex(ValueError,'packet missing'):qualify.main('enabled')
    def test_all_three_terminal_guards_and_independent_n_q(self):
        for arm in admission.ORDER:
            r,data,b,c=fixture(arm);policy.validate_worker_receipt(r,arm,data,b,c)
            paths=[('result','final','ramSha256'),('result','final','cpu','edx')] if arm=='plain-JS' else [('finalNative','nativeTicks'),('finalNative','successfulQuanta'),('finalBoard','ramSha256')]
            for path in paths:
                v=copy.deepcopy(r);obj=v
                for key in path[:-1]:obj=obj[key]
                obj[path[-1]]='9' if path[-1] in ('nativeTicks','successfulQuanta') else ('b'*64 if path[-1]=='ramSha256' else 768)
                with self.assertRaises(ValueError):policy.validate_worker_receipt(v,arm,data,b,c)
            v=copy.deepcopy(r);(v['result']['ports'] if arm=='plain-JS' else v['ports'])[0]['cycles']+=6
            with self.assertRaises(ValueError):policy.validate_worker_receipt(v,arm,data,b,c)
        r,data,b,c=fixture()
        self.assertNotIn('activityState',r['finalNative'])
        for mutate in [lambda x:x.pop('lastReturnedNative'),lambda x:x['lastReturnedNative'].pop('activityState'),lambda x:x['lastReturnedNative'].update(activityState=1),lambda x:x['lastReturnedNative'].update(nativeTicks='11'),lambda x:x['lastReturnedNative'].update(successfulQuanta='9'),lambda x:x['lastReturnedNative']['state'].__setitem__(0,1),lambda x:x['finalNative'].update(activityState=0)]:
            v=copy.deepcopy(r);mutate(v)
            with self.assertRaises((ValueError,KeyError)):policy.validate_worker_receipt(v,'native-batched',data,b,c)
        for key in ('state','extra','segments','system','debug'):
            for i in range(len(r['finalNative'][key])):
                v=copy.deepcopy(r);v['finalNative'][key][i]^=1
                with self.assertRaises(ValueError):policy.validate_worker_receipt(v,'native-batched',data,b,c)
    def test_https_origin_and_raw_semantic_metrics_have_no_gate(self):
        self.assertEqual(qualify.artifact_origin('https://api.github.com/a'),('https','api.github.com',443));self.assertEqual(qualify.artifact_origin('https://api.github.com:443/a'),('https','api.github.com',443))
        for value in ('http://api.github.com/a','https://api.github.com:0/a','https://token@api.github.com/a'):
            with self.assertRaises(ValueError):qualify.artifact_origin(value)
        for arm in admission.ORDER:
            r,data,b,c=fixture(arm);metrics=policy.validate_worker_receipt(r,arm,data,b,c);self.assertEqual(metrics['cpuMicrosecondsSum'],210000);self.assertNotIn('quantitativeGatePass',metrics)
if __name__=='__main__':unittest.main()
