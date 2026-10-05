"""Pure manufactured policy and tiny process-lifecycle fixtures, no guest."""
import sys
sys.dont_write_bytecode=True
import copy,json,os,signal,tempfile,time,unittest
import unittest.mock
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import policy
import parent

def fixture(arm='native-batched'):
    native={'state':[0]*20,'extra':[0]*20,'segments':[0]*90,'system':[0]*30,'debug':[0]*6,'nativeTicks':'12','successfulQuanta':'10','mappingEpoch':0,'boardA20':1,'fallback':{k:'0' for k in ('bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer')},'execution':{k:'0' for k in ('attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts')}}
    native['clockTransfers']={k:'0' for k in ('transfers','commits','words')};native['callbacks']={k:'0' for k in ('physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks')}
    native['state'][8]=0xe16;native['state'][10]=0x7ffffff0;native['state'][13]=0xf000
    files={'lock.json':'a'*64,'source.mjs':'a'*64};revision='b'*40;source={'revision':revision,'hashes':files};b={'workers':{k:{'revision':revision,'files':files,'binding':'lock.json'} for k in ('native','plainJs')},'compiledFiles':{'source':'c'*64},'targetN':12,'targetQ':10,'configuredClockHz':6000000,'node':{'sha256':'d'*64},'capture':{'sha256':'e'*64},'independentAudit':{'sha256':'f'*64},'nativeInput':{'sha256':'1'*64}}
    ports=[{'ordinal':1,'dir':'out','port':0x64,'width':8,'value':0xaa,'q':3,'cycles':16},{'ordinal':2,'dir':'in','port':0x60,'width':8,'value':0x55,'q':9,'cycles':52}];board={'cycles':64,'debt':0,'a20Enabled':True,'pic1':{'irr':1,'imr':0,'isr':0}};final={'q':10,'cpu':{'cycles':10,'edx':0},'board':board,'ramSha256':'2'*64}
    capture={'progress':{'n':12,'q':10},'cuts':[{'name':'before-F000-E16','native':copy.deepcopy(native)}],'javascriptFinal':final,'javascriptPorts':ports};data={'mode':'oneQ' if arm=='native-oneQ' else 'batched'}
    timing={'cpuMicroseconds':{'user':200000,'system':10000},'wallNanoseconds':'300000000'};r={'input':data,'nodeSha256Before':'d'*64,'nodeSha256After':'d'*64,'prerequisite':{'bindingSha256':'a'*64,'captureSha256':'e'*64,'independentAuditSha256':'f'*64}}
    if arm=='plain-JS':r.update(schema='bw.cold-plain-js.worker.v1',status='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS',sourceBefore=source,sourceAfter=copy.deepcopy(source),result={'final':copy.deepcopy(final),'ports':copy.deepcopy(ports),'timing':timing})
    else:
        compiled={'revision':policy.COMPILED,'hashes':b['compiledFiles']};build={'addonSha256':'1'*64};native_ports=[{**p,'successfulQuanta':p['q']-1,'nativeTicks':p['q']+2} for p in ports]
        r.update(schema='bw.cold-native-performance.worker.v1',status='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS',workerBefore=source,workerAfter=copy.deepcopy(source),compiledBefore=compiled,compiledAfter=copy.deepcopy(compiled),buildBefore=build,buildAfter=copy.deepcopy(build),finalNative=copy.deepcopy(native),lastReturnedNative={**copy.deepcopy(native),'activityState':0,'reason':1,'chargedNativeTicks':1,'chargedQuanta':1,'sliceBytes':[0]*160},progress={'n':12,'q':10,'dn':1,'dq':1},finalBoard={'state':{'board':copy.deepcopy(board),'nativeTicks':12,'successfulQuanta':10,'cold':{'phase':'complete'}},'ramSha256':'2'*64},ports=native_ports,executionTiming=timing)
    return r,data,b,capture

class PureControls(unittest.TestCase):
    def test_pending_refuses_before_any_spawn(self):
        binding=json.loads((Path(__file__).parent/'binding.json').read_text())
        binding['status']='PENDING_MANUFACTURED_CONTROL'
        with unittest.mock.patch.object(parent.subprocess,'Popen',side_effect=AssertionError('must never spawn')):
            with self.assertRaisesRegex(ValueError,'pending'):policy.validate_ready_binding(binding)
            with tempfile.TemporaryDirectory() as directory:
                request=Path(directory)/'request.json';request.write_text(json.dumps({'comparison':'native-oneQ-v-batched','output':directory+'/never-created','parentRevision':'a'*40,'parentSourceSha256':'b'*64}))
                real_read=parent.read_json
                def read(path,max_bytes=8<<20):
                    return binding if Path(path)==parent.HERE/'binding.json' else real_read(path,max_bytes)
                with unittest.mock.patch.object(parent,'read_json',side_effect=read):
                    with self.assertRaisesRegex(ValueError,'pending'):parent.main(request)
                self.assertFalse(Path(directory,'never-created').exists())
        initial={'source':'frozen'};pin={'sha256':'a'*64,'bytes':1}
        report={'finalAuthentication':initial,'requestPinAfter':pin,'bindingPinBefore':pin,'bindingPinAfter':pin}
        parent.validate_final_authentication(report,initial,pin)
        for patch in ({'finalAuthentication':{'source':'changed'}},{'finalAuthentication':None},{'requestPinAfter':{'sha256':'b'*64,'bytes':1}},{'requestPinAfter':None},{'bindingPinAfter':{'sha256':'b'*64,'bytes':1}},{'bindingPinAfter':None}):
            changed={**report,**patch}
            with self.assertRaises(ValueError):parent.validate_final_authentication(changed,initial,pin)
        # Manufactured completion only: no workers or subprocesses execute.
        for primary_failure in (False,True):
            with tempfile.TemporaryDirectory() as directory:
                initial={'parent':{'revision':'a'*40,'hashes':{}}};request={'comparison':'native-oneQ-v-batched','output':directory+'/result','parentRevision':'a'*40,'parentSourceSha256':policy.identity_sha('a'*40,{})}
                binding={'compiledRoot':'/never-compiled','workers':{},'capture':{'path':'/manufactured-capture'}}
                with unittest.mock.patch.object(parent,'read_json',side_effect=[request,binding,{}]),unittest.mock.patch.object(parent,'validate_ready_binding',return_value=binding),unittest.mock.patch.object(parent,'pair_schedule',return_value=[]),unittest.mock.patch.object(parent,'host_context',return_value={}),unittest.mock.patch.object(parent,'fingerprint',return_value=pin),unittest.mock.patch.object(parent,'immutable_snapshot',side_effect=[initial,OSError('manufactured final auth unavailable')]),unittest.mock.patch.object(parent,'validate_prerequisites',side_effect=RuntimeError('manufactured primary failure') if primary_failure else None),unittest.mock.patch.object(parent,'summarize_pairs',return_value={'quantitativeGatePass':True}),unittest.mock.patch.object(parent.subprocess,'Popen',side_effect=AssertionError('must never spawn')):
                    with self.assertRaises((ValueError,RuntimeError)):parent.main(Path(directory)/'request.json')
                retained=json.loads(Path(directory,'result','result.json').read_text());self.assertEqual(retained['status'],'FAIL');self.assertIn('finalizationError',retained);self.assertIn('finalAuthenticationUnavailable',retained)
                self.assertEqual('error' in retained,primary_failure)
        # A changed derived binding is the sole final failure; preserve both pins.
        with tempfile.TemporaryDirectory() as directory:
            initial={'parent':{'revision':'a'*40,'hashes':{}}};request={'comparison':'native-oneQ-v-batched','output':directory+'/result','parentRevision':'a'*40,'parentSourceSha256':policy.identity_sha('a'*40,{})}
            binding={'compiledRoot':'/never-compiled','workers':{},'capture':{'path':'/manufactured-capture'}};calls=0
            def fingerprint(path,max_bytes=256<<20):
                nonlocal calls
                if Path(path)==parent.HERE/'binding.json':
                    calls+=1
                    if calls>=4:return {'sha256':'b'*64,'bytes':1}
                return pin
            with unittest.mock.patch.object(parent,'read_json',side_effect=[request,binding,{}]),unittest.mock.patch.object(parent,'validate_ready_binding',return_value=binding),unittest.mock.patch.object(parent,'pair_schedule',return_value=[]),unittest.mock.patch.object(parent,'host_context',return_value={}),unittest.mock.patch.object(parent,'fingerprint',side_effect=fingerprint),unittest.mock.patch.object(parent,'immutable_snapshot',return_value=initial),unittest.mock.patch.object(parent,'validate_prerequisites'),unittest.mock.patch.object(parent,'summarize_pairs',return_value={'quantitativeGatePass':True}),unittest.mock.patch.object(parent.subprocess,'Popen',side_effect=AssertionError('must never spawn')):
                with self.assertRaisesRegex(ValueError,'binding'):parent.main(Path(directory)/'request.json')
            retained=json.loads(Path(directory,'result','result.json').read_text());self.assertEqual(retained['status'],'FAIL');self.assertIn('finalizationError',retained);self.assertNotIn('error',retained);self.assertEqual(retained['bindingPinBefore'],pin);self.assertEqual(retained['bindingPinAfter']['sha256'],'b'*64)

    def test_actual_parent_success_writes_all_eighteen_progress_records(self):
        # Manufactured receipts/prerequisites; actual main, schedule, filesystem,
        # input fingerprints, summary and final authentication. No child spawn.
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);capture=root/'capture.json';capture.write_text('{}')
            initial={'parent':{'revision':'a'*40,'hashes':{}}}
            request={'comparison':'native-oneQ-v-batched','output':str(root/'result'),'parentRevision':'a'*40,'parentSourceSha256':policy.identity_sha('a'*40,{})}
            binding={'compiledRoot':'/never-compiled','workers':{k:{'root':'/never-'+k,'entry':'worker.mjs'} for k in ('native','plainJs')},'capture':{'path':str(capture)},'node':{'path':'/never-node'},'bounds':{}}
            request_path=root/'request.json';binding_path=root/'binding.json';request_path.write_text(json.dumps(request));binding_path.write_text(json.dumps(binding));calls=[]
            def child(command,cwd,out,bounds):
                out.mkdir();(out/'receipt').mkdir();data=json.loads(Path(command[-1]).read_text());pin=parent.fingerprint(command[-1])['sha256'];calls.append(out.name)
                parent.write(out/'receipt'/'receipt.json',{'inputSha256Before':pin,'inputSha256After':pin,'arm':data['arm']})
                return {'exitCode':0,'timedOut':False,'interrupted':None,'cpuSeconds':20,'wallSeconds':25}
            def metrics(receipt,arm,data,binding,capture):
                self.assertEqual(receipt['arm'],arm);value=8 if arm=='native-batched' else 10
                return {'cpuSeconds':value,'cpuMicrosecondsSum':value*1000000,'wallSeconds':12}
            with unittest.mock.patch.object(parent,'validate_ready_binding',return_value=binding),unittest.mock.patch.object(parent,'host_context',return_value={}),unittest.mock.patch.object(parent,'immutable_snapshot',return_value=initial),unittest.mock.patch.object(parent,'validate_prerequisites'),unittest.mock.patch.object(parent,'child_input',side_effect=lambda arm,b,out:{'arm':arm}),unittest.mock.patch.object(parent,'bounded_child',side_effect=child),unittest.mock.patch.object(parent,'validate_worker_receipt',side_effect=metrics),unittest.mock.patch.object(parent.subprocess,'Popen',side_effect=AssertionError('must never spawn')):
                parent.main(request_path,binding_path)
            report=json.loads((root/'result'/'result.json').read_text());schedule=policy.pair_schedule(request['comparison'])
            self.assertEqual(calls,[f"pair-{p['pair']:02d}-"+arm for p in schedule for arm in p['order']]);self.assertEqual(len(calls),18)
            self.assertEqual([p['phase'] for p in report['pairs']],['warmup']*2+['measured']*7);self.assertEqual(report['status'],'PAIRED_CAPTURE_COMPLETE_QUANTITATIVE_PASS')
            self.assertEqual(report['finalAuthentication'],initial);self.assertEqual(report['bindingPinBefore'],report['bindingPinAfter'])
            for i,name in enumerate(calls):
                progress=json.loads((root/'result'/('progress-'+name+'.json')).read_text())
                self.assertEqual(sum(len(p['arms']) for p in progress['pairs']),i+1)

    def test_exact_separate_alternating_protocol(self):
        for name in policy.COMPARISONS:
            schedule=policy.pair_schedule(name);self.assertEqual(len(schedule),9);self.assertEqual(sum(p['phase']=='warmup' for p in schedule),2);self.assertEqual(sum(p['phase']=='measured' for p in schedule),7);self.assertEqual(schedule[0]['order'],list(policy.COMPARISONS[name]));self.assertEqual(schedule[1]['order'],list(reversed(policy.COMPARISONS[name])));self.assertEqual(sum(len(p['order']) for p in schedule),18)
        with self.assertRaises(ValueError):policy.pair_schedule('mixed-diagnostic')
    def test_native_full166_independent_totals_and_counter_refusals(self):
        r,data,b,c=fixture();self.assertAlmostEqual(policy.validate_worker_receipt(r,'native-batched',data,b,c)['cpuSeconds'],.21)
        for key in ('state','extra','segments','system','debug'):
            for i in range(len(r['finalNative'][key])):
                changed=copy.deepcopy(r);changed['finalNative'][key][i]^=1
                with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,'native-batched',data,b,c)
        for patch in ({'nativeTicks':'11'},{'successfulQuanta':'9'},{'nativeTicks':'010'},{'fallback':{}},{'execution':{}},{'activityState':1}):
            changed=copy.deepcopy(r);changed['finalNative'].update(patch)
            with self.assertRaises((ValueError,KeyError)):policy.validate_worker_receipt(changed,'native-batched',data,b,c)
    def test_whole_board_ram_complete_pio_and_js_counter_scope(self):
        for arm in ('native-oneQ','plain-JS'):
            r,data,b,c=fixture(arm);policy.validate_worker_receipt(r,arm,data,b,c)
            changed=copy.deepcopy(r)
            if arm=='plain-JS':changed['result']['final']['cpu']['edx']=0x300
            else:changed['finalBoard']['state']['board']['pic1']['irr']=0
            with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,arm,data,b,c)
            changed=copy.deepcopy(r)
            if arm=='plain-JS':changed['result']['final']['ramSha256']='3'*64
            else:changed['finalBoard']['ramSha256']='3'*64
            with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,arm,data,b,c)
            for field in ('cycles','value','ordinal'):
                changed=copy.deepcopy(r);ports=changed['result']['ports'] if arm=='plain-JS' else changed['ports'];ports[0][field]+=1
                with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,arm,data,b,c)
    def test_phase_and_whole_child_metrics_are_not_pooled(self):
        rows=[]
        for p in policy.pair_schedule('native-oneQ-v-batched'):
            rows.append({**p,'arms':{'native-oneQ':{'execution':{'cpuSeconds':10,'cpuMicrosecondsSum':10000000,'wallSeconds':12},'wholeChild':{'cpuSeconds':20,'wallSeconds':25}},'native-batched':{'execution':{'cpuSeconds':8,'cpuMicrosecondsSum':8000000,'wallSeconds':11},'wholeChild':{'cpuSeconds':30,'wallSeconds':40}}}})
        result=policy.summarize_pairs('native-oneQ-v-batched',rows);self.assertTrue(result['quantitativeGatePass']);self.assertAlmostEqual(result['meanCpuReduction'],.2);self.assertEqual(result['rawRatios'][0]['wholeChildCpuCandidateOverBaseline'],1.5)
        for p in rows:p['arms']['native-batched']['execution'].update(cpuSeconds=9,cpuMicrosecondsSum=9000000)
        self.assertTrue(policy.summarize_pairs('native-oneQ-v-batched',rows)['quantitativeGatePass'],'exact10pct inclusive threshold')
        rows[3]['arms']['native-batched']['execution'].update(cpuSeconds=11,cpuMicrosecondsSum=11000000);self.assertFalse(policy.summarize_pairs('native-oneQ-v-batched',rows)['quantitativeGatePass'])
        with self.assertRaises(ValueError):policy.phase_metrics({'cpuMicroseconds':{'user':0,'system':0},'wallNanoseconds':'1'})
    def test_ordinary_source_roles_reject_symlinks_and_bounds(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'ordinary';p.write_text('abc');self.assertEqual(parent.fingerprint(p)['bytes'],3);link=Path(directory)/'link';link.symlink_to(p)
            with self.assertRaises(ValueError):parent.fingerprint(link)
            with self.assertRaises(ValueError):parent.fingerprint(p,2)
    def test_tiny_timeout_stops_detached_descendant_and_preserves_exit(self):
        # Tiny Python sleeper fixture only. No Node/addon/CPU/BIOS involved.
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);pid_file=root/'detached.pid';out=root/'child'
            code="import subprocess,sys,time;from pathlib import Path;p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(20)'],start_new_session=True);Path(sys.argv[1]).write_text(str(p.pid));time.sleep(20)"
            bounds={'cpuSeconds':1,'wallSeconds':.7,'heapMiB':None,'fileBytes':1<<20,'coreBytes':0,'niceIncrement':10}
            result=parent.bounded_child([sys.executable,'-c',code,str(pid_file)],root,out,bounds);self.assertTrue(result['timedOut']);self.assertNotEqual(result['exitCode'],0);self.assertTrue((out/'exit.json').is_file());self.assertIsNotNone(result['rusage']);child=int(pid_file.read_text());self.assertIn(child,result['terminatedPids'])
            deadline=time.monotonic()+1
            state=None
            while time.monotonic()<deadline:
                try:state=Path('/proc',str(child),'stat').read_text().rsplit(')',1)[1].split()[0]
                except FileNotFoundError:state=None;break
                if state=='Z':break
                time.sleep(.01)
            self.assertIn(state,(None,'Z'),'detached fixture no longer running')

class HostedPendingTests(unittest.TestCase):
    def test_owned_pending_audit_denies_before_setup_network_or_process(self):
        import importlib.util
        spec=importlib.util.spec_from_file_location('paired_setup_pending',Path(__file__).parent/'setup-entry.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        raw=(Path(__file__).parent/'hosted-contract.json').read_bytes();contract=json.loads(raw)
        with unittest.mock.patch.object(m.subprocess,'check_output',side_effect=AssertionError('must not spawn metadata')):
            actual,path=m.pending_guard();self.assertEqual(actual['qualificationArtifact']['runId'],37126251298)
            pending=copy.deepcopy(contract);pending['status']='PENDING_ACTUAL_AUDIT'
            original=m.Path.read_bytes
            def pending_bytes(path):return json.dumps(pending).encode() if path.name=='hosted-contract.json' else original(path)
            with unittest.mock.patch.object(m.Path,'read_bytes',pending_bytes):
                with self.assertRaisesRegex(ValueError,'PENDING actual semantic audit'):m.pending_guard()
            corrupt=copy.deepcopy(contract);corrupt['nodeSha256']='0'*64
            def corrupt_bytes(path):return json.dumps(corrupt).encode() if path.name=='hosted-contract.json' else original(path)
            with unittest.mock.patch.object(m.Path,'read_bytes',corrupt_bytes):
                with self.assertRaisesRegex(ValueError,'runtime Node'):m.pending_guard()
        spec=importlib.util.spec_from_file_location('paired_hosted_resource',Path(__file__).parent/'hosted.py');hosted=importlib.util.module_from_spec(spec);spec.loader.exec_module(hosted)
        bounds=hosted.setup_bounds(contract);self.assertEqual(bounds['fileBytes'],32<<20);self.assertGreater(contract['qualificationArtifact']['zipBytes'],16<<20)
        too_large=copy.deepcopy(contract);too_large['qualificationArtifact']['zipBytes']=(32<<20)+1
        with self.assertRaisesRegex(ValueError,'setup file cap'):hosted.setup_bounds(too_large)
        source=(Path(__file__).parents[2]/'.github/workflows/i80386-cold-paired-performance.yml').read_text()
        self.assertIn('default: false',source);self.assertIn('m.pending_guard()',source)
        self.assertNotIn('qualify.py enabled',source)
    def test_process_cgroup_quota_is_separate_from_hierarchy_root(self):
        import io
        opened=[]
        def fake_open(path,*args,**kwargs):
            path=str(path);opened.append(path)
            return io.StringIO('200000 100000' if path=='/sys/fs/cgroup/owned/cpu.max' else 'root-or-other-file')
        with unittest.mock.patch.object(parent.Path,'read_text',return_value='0::/owned\n'),unittest.mock.patch.object(parent.Path,'glob',return_value=[]),unittest.mock.patch('builtins.open',side_effect=fake_open):context=parent.host_context()
        self.assertEqual(context['processCgroup']['path'],'/sys/fs/cgroup/owned')
        self.assertEqual(context['processCgroup']['files']['cpu.max'],'200000 100000')
        self.assertEqual(context['cgroupRootFiles']['cpu.max'],'root-or-other-file')
        self.assertIn('/sys/fs/cgroup/owned/cpu.max',opened)


class ActualMetadataTests(unittest.TestCase):
    def test_genuine_inspect_and_resume_shapes_and_terminal_return_mutations(self):
        actual=json.loads((Path(__file__).parent/'actual-snapshot-fixtures.json').read_text());policy.inspect_metadata(actual['reset']);policy.inspect_metadata(actual['finalInspect'])
        self.assertNotIn('activityState',actual['finalInspect']);returned=actual['resume'];inspect=copy.deepcopy(returned)
        for k in ('activityState','reason','chargedNativeTicks','chargedQuanta','sliceBytes'):del inspect[k]
        progress={'n':int(returned['nativeTicks']),'q':int(returned['successfulQuanta']),'dn':returned['chargedNativeTicks'],'dq':returned['chargedQuanta']};policy.terminal_return_metadata(returned,inspect,'oneQ',progress)
        for change in ('activity','missingActivity','n','q','word','charge','slice'):
            bad=copy.deepcopy(returned)
            if change=='activity':bad['activityState']=1
            elif change=='missingActivity':del bad['activityState']
            elif change=='n':bad['nativeTicks']=str(int(bad['nativeTicks'])+1)
            elif change=='q':bad['successfulQuanta']=str(int(bad['successfulQuanta'])+1)
            elif change=='word':bad['state'][2]^=1
            elif change=='charge':bad['chargedNativeTicks']=2
            else:del bad['sliceBytes']
            with self.assertRaises(ValueError):policy.terminal_return_metadata(bad,inspect,'oneQ',progress)
        for change in ('inventedActivity','fault','irq','halt','missingCallbacks'):
            bad=copy.deepcopy(actual['finalInspect'])
            if change=='inventedActivity':bad['activityState']=0
            elif change=='missingCallbacks':del bad['callbacks']
            else:bad['execution'][{'fault':'faults','irq':'irqDeliveries','halt':'haltIdleCuts'}[change]]='1'
            with self.assertRaises(ValueError):policy.inspect_metadata(bad)

if __name__=='__main__':
    unittest.main()
