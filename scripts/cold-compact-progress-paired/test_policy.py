"""Pure manufactured policy and tiny process-lifecycle fixtures, no guest."""
import sys
sys.dont_write_bytecode=True
import ast,copy,json,os,signal,tempfile,time,unittest
import unittest.mock
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import policy
import parent

def fixture(arm='compact-progress-batched'):
    native={'state':[0]*20,'extra':[0]*20,'segments':[0]*90,'system':[0]*30,'debug':[0]*6,'nativeTicks':'12','successfulQuanta':'10','mappingEpoch':0,'boardA20':1,'fallback':{k:'0' for k in ('bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer')},'execution':{k:'0' for k in ('attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts')}}
    native['clockTransfers']={k:'0' for k in ('transfers','commits','words')};native['callbacks']={k:'0' for k in ('physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks')}
    native['bridgeClockEntryAttempts']={k:str(int(k=='INIT')) for k in policy.METADATA_COUNTER_FIELDS['bridgeClockEntryAttempts']};native['bridgeMemoryEntryAttempts']={k:'0' for k in policy.METADATA_COUNTER_FIELDS['bridgeMemoryEntryAttempts']};
    native['state'][8]=0xe16;native['state'][10]=0x7ffffff0;native['state'][13]=0xf000
    files={'lock.json':'a'*64,'source.mjs':'a'*64};revision='b'*40;source={'revision':revision,'hashes':files};b={'workers':{k:{'revision':revision,'files':files,'binding':'lock.json'} for k in ('native','plainJs')},'compiledFiles':{'source':'c'*64},'targetN':12,'targetQ':10,'configuredClockHz':6000000,'node':{'sha256':'d'*64},'capture':{'sha256':'e'*64},'independentAudit':{'sha256':'f'*64},'nativeInput':{'sha256':'1'*64}}
    ports=[{'ordinal':1,'dir':'out','port':0x64,'width':8,'value':0xaa,'q':3,'cycles':16},{'ordinal':2,'dir':'in','port':0x60,'width':8,'value':0x55,'q':9,'cycles':52}];board={'cycles':64,'debt':0,'a20Enabled':True,'pic1':{'irr':1,'imr':0,'isr':0}};final={'q':10,'cpu':{'cycles':10,'edx':0},'board':board,'ramSha256':'2'*64}
    capture={'progress':{'n':12,'q':10},'cuts':[{'name':'manufactured-reset','native':copy.deepcopy(native)},{'name':'before-F000-E16','native':{k:copy.deepcopy(v) for k,v in native.items() if not k.startswith('bridge')}}],'javascriptFinal':final,'javascriptPorts':ports};data={'mode':'oneQ' if arm=='plain-JS' else 'batched'}
    timing={'cpuMicroseconds':{'user':200000,'system':10000},'wallNanoseconds':'300000000'};r={'input':data,'nodeSha256Before':'d'*64,'nodeSha256After':'d'*64,'prerequisite':{'bindingSha256':'a'*64,'captureSha256':'e'*64,'independentAuditSha256':'f'*64}}
    if arm=='plain-JS':r.update(schema='bw.cold-plain-js.worker.v1',status='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS',sourceBefore=source,sourceAfter=copy.deepcopy(source),result={'final':copy.deepcopy(final),'ports':copy.deepcopy(ports),'timing':timing})
    else:
        compiled={'revision':policy.COMPILED,'hashes':b['compiledFiles']};build={'addonSha256':'1'*64};native_ports=[{**p,'successfulQuanta':p['q']-1,'nativeTicks':p['q']+2} for p in ports]
        r.update(requiredMemoryFusionProfile='bw.cold-native.memory-clock-fusion.v1',admittedMemoryFusionProfile='bw.cold-native.memory-clock-fusion.v1',reset={'native':copy.deepcopy(native)},bridgeAttemptCounts={'provider':{'memoryOuterEntries':0,'replyValidations':0,'readEffects':0,'writeEffects':0},'reset':{'clock':copy.deepcopy(native['bridgeClockEntryAttempts']),'memory':copy.deepcopy(native['bridgeMemoryEntryAttempts'])},'final':{'clock':copy.deepcopy(native['bridgeClockEntryAttempts']),'memory':copy.deepcopy(native['bridgeMemoryEntryAttempts'])},'scope':'Manufactured counters only'},requiredStateExportProfile='bw.cold-native.copied-u32-state.v1',admittedStateExportProfile='bw.cold-native.copied-u32-state.v1',typedSnapshotOwnership='RESET_STABLE_AND_FINAL_LAST_RETURN_DISTINCT',schema='bw.cold-native-memory-fusion-ledger-scalars-performance.worker.v1',status='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS',workerBefore=source,workerAfter=copy.deepcopy(source),compiledBefore=compiled,compiledAfter=copy.deepcopy(compiled),buildBefore=build,buildAfter=copy.deepcopy(build),finalNative=copy.deepcopy(native),lastReturnedNative={**copy.deepcopy(native),'activityState':0,'reason':1,'chargedNativeTicks':1,'chargedQuanta':1,'sliceBytes':[0]*160},progress={'n':12,'q':10,'dn':1,'dq':1},finalBoard={'state':{'board':copy.deepcopy(board),'nativeTicks':12,'successfulQuanta':10,'cold':{'phase':'complete'}},'ramSha256':'2'*64},ports=native_ports,executionTiming=timing)
    if arm!='plain-JS':
        b['workers']['native']['files']['scripts/cold-native-compact-progress-performance/scalar-overlay.json']='9'*64
        r['requiredScalarProviderProfile']='bw.cold-native.memory-clock-fusion.ledger-scalars.v1';r['scalarOverlay']={'profile':r['requiredScalarProviderProfile'],'bindingSha256':'9'*64}
        r['workerBefore']['hashes']=copy.deepcopy(b['workers']['native']['files']);r['workerAfter']=copy.deepcopy(r['workerBefore'])
    if arm!='plain-JS':
        r.pop('lastReturnedNative');r['lastReturnedProgress']=json.loads((Path(__file__).parent/'actual-terminal-progress.json').read_text())
        for view in (r['finalNative'],r['reset']['native'],* [cut['native'] for cut in capture['cuts']]):view.update(nativeTicks='316562',successfulQuanta='316562')
        b.update(targetN=316562,targetQ=316562);capture['progress']={'n':316562,'q':316562};capture['javascriptFinal']['cpu']['cycles']=316562;capture['javascriptFinal']['q']=316562;capture['javascriptFinal']['board']['cycles']=1899376;r['finalBoard']['state']['board']['cycles']=1899376
        r['progress']={'n':316562,'q':316562,'dn':7,'dq':7};r['finalBoard']['state'].update(nativeTicks=316562,successfulQuanta=316562)
        r['lastResumeInspect']=copy.deepcopy(r['finalNative']);r['schema']='bw.cold-native-compact-progress-performance.worker.v1';r['typedSnapshotOwnership']='RESET_STABLE_AND_REQUESTED_LAST_FINAL_INSPECT_DISTINCT'
        r['requiredProgressExportProfile']=r['admittedProgressExportProfile']='bw.cold-native.compact-progress.v1'
    return r,data,b,capture

class PureControls(unittest.TestCase):
    def test_scalar_projection_and_independent_setup_failure_guards(self):
        r,data,b,c=fixture();before=copy.deepcopy(r)
        self.assertEqual(policy.validate_worker_receipt(r,'compact-progress-batched',data,b,c)['cpuSeconds'],.21)
        self.assertEqual(r,before)
        for field in ('schema','requiredScalarProviderProfile','scalarOverlay'):
            changed=copy.deepcopy(r);changed[field]='wrong'
            with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,'compact-progress-batched',data,b,c)
        for mutate in [lambda x:x['lastReturnedProgress'].update(nativeTicks='32'),lambda x:x['lastReturnedProgress'].update(mappingEpoch=1),lambda x:x['lastReturnedProgress'].update(boardA20=0),lambda x:x['lastReturnedProgress'].update(state=[]),lambda x:x['lastResumeInspect']['state'].__setitem__(0,1),lambda x:x.update(admittedProgressExportProfile='wrong')]:
            changed=copy.deepcopy(r);mutate(changed)
            with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,'compact-progress-batched',data,b,c)
        import importlib.util
        spec=importlib.util.spec_from_file_location('setup_entry_control',Path(__file__).parent/'setup-entry.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        report={'status':'FAIL','error':'original child failure'}
        def unavailable():raise OSError('source after unavailable')
        error=module.final_guards(report,[('sourceAfter',unavailable,{}),('originalInputsAfter',lambda:{'changed':True},{}),('restoredAfter',lambda:{'same':True},{'same':True})])
        self.assertIsInstance(error,OSError);self.assertEqual(report['error'],'original child failure')
        self.assertEqual(set(report['finalizationErrors']),{'sourceAfter','originalInputsAfter'});self.assertEqual(report['originalInputsAfter'],{'changed':True});self.assertEqual(report['restoredAfter'],{'same':True})
    def test_held_schedule_and_cpu_gate_source_are_exact(self):
        source=(Path(__file__).parent/'policy.py').read_text()
        held=json.loads((Path(__file__).parent/'held-source.json').read_text())
        for name,record in held['files'].items():
            candidate=(Path(__file__).parent/name).read_text();self.assertEqual(policy.sha(candidate.encode()),record['candidateSha256'])
            for seam in reversed(record['edits']):
                self.assertEqual(candidate[seam['start']:seam['end']],seam['next']);candidate=candidate[:seam['start']]+seam['old']+candidate[seam['end']:]
            self.assertEqual(policy.sha(candidate.encode()),record['heldSha256'])
        workflow=(Path(__file__).resolve().parents[2]/'.github/workflows/i80386-cold-compact-progress-paired.yml').read_text();self.assertIn('default: false',workflow);self.assertIn('workflow_dispatch:',workflow);self.assertNotIn('push:',workflow);self.assertNotIn('pull_request:',workflow)
        for name in ('pair_schedule','summarize_pairs'):
            function=next(node for node in ast.parse(source).body if isinstance(node,ast.FunctionDef) and node.name==name)
            actual='\n'.join(source.splitlines()[function.lineno-1:function.end_lineno])
            self.assertEqual(policy.sha(actual.strip().encode()),held['mechanics'][name])
    def test_owned_pending_audit_denies_before_setup_network_or_process(self):
        import authority,importlib.util
        c=json.loads((Path(__file__).parent/'hosted-contract.json').read_bytes())
        # The refusal fixture is independent of production READY/PENDING status.
        pending=copy.deepcopy(c);pending['status']='PENDING_ACTUAL_MEMORY_FUSION_QUALIFICATION_AUDIT';pending['compactQualificationAudit']=None;pending['compactQualificationArtifact']=None
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'hosted-contract.json').write_text(json.dumps(pending))
            with unittest.mock.patch.object(authority,'HERE',root),unittest.mock.patch.object(parent.subprocess,'Popen',side_effect=AssertionError('must not spawn')),unittest.mock.patch.object(parent.subprocess,'check_output',side_effect=AssertionError('must not query metadata')):
                with self.assertRaisesRegex(ValueError,'PENDING'):authority.pending_guard()
        ready=copy.deepcopy(c);ready['status']='ROOT_REVIEWED_ACTUAL_COMPACT_QUALIFICATION_READY'
        actual,path=authority.validate_authority(ready);self.assertEqual(actual['compactQualificationArtifact']['runId'],37263077732)
        for key in ('compactQualificationAudit','compactQualificationArtifact'):
            bad=copy.deepcopy(ready);bad[key]=None
            with self.assertRaises((ValueError,TypeError)):authority.validate_authority(bad)
        manufactured={'runId':1,'headSha':'a'*40,'artifactId':2,'zipBytes':20<<20,'zipSha256':'b'*64}
        mapped=authority.download_descriptor(manufactured);self.assertEqual(mapped['head'],manufactured['headSha']);self.assertNotIn('headSha',mapped)
        bad={**manufactured,'head':manufactured['headSha']}
        with self.assertRaises(ValueError):authority.download_descriptor(bad)
        ready['compactQualificationArtifact']=manufactured
        spec=importlib.util.spec_from_file_location('typed_hosted_resource',Path(__file__).parent/'hosted.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);identity={'source':'frozen'}
            with unittest.mock.patch.object(m,'parent_identity',return_value=identity),unittest.mock.patch.object(m,'host_context',side_effect=OSError('manufactured host unavailable')):
                m.finish(root,identity,RuntimeError('manufactured primary'))
            retained=json.loads((root/'hosted-result.json').read_text());self.assertEqual(retained['status'],'FAIL');self.assertIn('manufactured primary',retained['primaryError']);self.assertIn('hostAfterUnavailable',retained)
        self.assertEqual(m.setup_bounds(ready)['fileBytes'],32<<20)
        bad=copy.deepcopy(ready);bad['compactQualificationArtifact']['zipBytes']=(32<<20)+1
        with self.assertRaises(ValueError):m.setup_bounds(bad)
    def test_actual_parent_success_writes_all_eighteen_progress_records(self):
        # Manufactured receipts/prerequisites; actual main, schedule, filesystem,
        # input fingerprints, summary and final authentication. No child spawn.
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);capture=root/'capture.json';capture.write_text('{}')
            initial={'parent':{'revision':'a'*40,'hashes':{}}}
            request={'comparison':'plain-JS-v-compact-progress-batched','output':str(root/'result'),'parentRevision':'a'*40,'parentSourceSha256':policy.identity_sha('a'*40,{})}
            binding={'compiledRoot':'/never-compiled','workers':{k:{'root':'/never-'+k,'entry':'worker.mjs'} for k in ('native','plainJs')},'capture':{'path':str(capture)},'node':{'path':'/never-node'},'bounds':{}}
            request_path=root/'request.json';binding_path=root/'binding.json';request_path.write_text(json.dumps(request));binding_path.write_text(json.dumps(binding));calls=[]
            def child(command,cwd,out,bounds):
                out.mkdir();(out/'receipt').mkdir();data=json.loads(Path(command[-1]).read_text());pin=parent.fingerprint(command[-1])['sha256'];calls.append(out.name)
                parent.write(out/'receipt'/'receipt.json',{'inputSha256Before':pin,'inputSha256After':pin,'arm':data['arm']})
                return {'exitCode':0,'timedOut':False,'interrupted':None,'cpuSeconds':20,'wallSeconds':25}
            def metrics(receipt,arm,data,binding,capture):
                self.assertEqual(receipt['arm'],arm);value=8 if arm=='compact-progress-batched' else 10
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
    def test_native_full166_independent_totals_and_counter_refusals(self):
        r,data,b,c=fixture();self.assertAlmostEqual(policy.validate_worker_receipt(r,'compact-progress-batched',data,b,c)['cpuSeconds'],.21)
        for key in ('state','extra','segments','system','debug'):
            for i in range(len(r['finalNative'][key])):
                changed=copy.deepcopy(r);changed['finalNative'][key][i]^=1
                with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,'compact-progress-batched',data,b,c)
        for patch in ({'nativeTicks':'11'},{'successfulQuanta':'9'},{'nativeTicks':'010'},{'fallback':{}},{'execution':{}},{'activityState':1}):
            changed=copy.deepcopy(r);changed['finalNative'].update(patch)
            with self.assertRaises((ValueError,KeyError)):policy.validate_worker_receipt(changed,'compact-progress-batched',data,b,c)
        for mutation in ('nativeNumber','nativeLeadingZero','providerMismatch','resetInit','lastMap','profile','resetWord'):
            changed=copy.deepcopy(r)
            if mutation=='nativeNumber':changed['finalNative']['bridgeMemoryEntryAttempts']['fusedOuter']=0
            elif mutation=='nativeLeadingZero':changed['finalNative']['bridgeMemoryEntryAttempts']['fusedOuter']='00'
            elif mutation=='providerMismatch':changed['bridgeAttemptCounts']['provider']['memoryOuterEntries']=1
            elif mutation=='resetInit':changed['reset']['native']['bridgeClockEntryAttempts']['INIT']='0'
            elif mutation=='lastMap':changed['lastResumeInspect']['bridgeMemoryEntryAttempts']['fusedOuter']='1'
            elif mutation=='profile':changed['admittedMemoryFusionProfile']='old-profile'
            else:changed['reset']['native']['state'][0]^=1
            with self.assertRaises(ValueError):policy.validate_worker_receipt(changed,'compact-progress-batched',data,b,c)
    def test_whole_board_ram_complete_pio_and_js_counter_scope(self):
        for arm in ('compact-progress-batched','plain-JS'):
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

if __name__=="__main__":unittest.main(verbosity=2)
