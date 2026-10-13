"""Source-only manufactured controls; all namespace/resource/process edges mocked."""
import hashlib,importlib.util,json,os,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
PROFILE_PATH="scripts/i80386-provisioning-operational-profile/driver.py"
def module(name):
    spec=importlib.util.spec_from_file_location('test_'+name.replace('-','_'),HERE/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def fixture():
    policy=(('cpuSeconds',0,180),('addressSpaceBytes',9,2147483648),('fileBytes',1,67108864),('fdCount',7,256),('coreBytes',4,0))
    limits={'schema':'bw.provisioning-pid1-limits.v1','phase':'prepared','closed':True,'prepared':True,'processLimitsPrepared':True,'firstFailure':None,'stoppedPhase':None,'eligibility':{n:True for n in ('linuxObserved','pid1Observed','rootCredentialsObserved','githubContextObserved')},'policy':[],'rows':[],'setAttempted':5,'getAttempted':10}
    for k in ('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):limits[k]=False
    for name,kind,n in policy:
        row={'name':name,'resource':kind,'soft':n,'hard':n};limits['policy'].append(dict(row));row.update(setReturned=True,observations=[{'position':p,'shapeValid':True,'soft':n,'hard':n,'matchesPolicy':True}for p in ('immediate','final')]);limits['rows'].append(row)
    wire={'schema':'bw.provisioning-contained-resource.v1','components':{'limits':{'bytes':5805,'sha256':'829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4'},'controller':{'bytes':19661,'sha256':'9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd'}},'limits':limits,'controllerBootstrapStarted':False,'observerOwnershipQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False}
    controller={'schema':'bw.provisioning-controller-result.v1','phase':'refused','closed':True,'complete':False,'firstFailure':'approval-unarmed','secondaryFailure':None,'bootstrapComponentsVerified':0,'sourceBefore':None,'sourceAfter':None,'inheritedProjection':{'kind':'INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','before':None,'after':None},'transport':None,'coordinator':None,'cleanupRefused':0,'outerHardBoundImplemented':False}
    for k in ('actualAcquisitionQualified','profileSourceAdmissionQualified','sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','namespaceModeQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified'):controller[k]=False
    enc=lambda x:(json.dumps(x,sort_keys=True,separators=(',',':'))+'\n').encode()
    cb=enc(controller);wb=enc(wire)
    entry={'schema':'bw.provisioning-contained-entry.v1','phase':'refused','closed':True,'complete':False,'firstFailure':'entry-refused','stoppedPhase':'controller','cleanupRefused':0,'resourceFacts':limits,'handshakeSent':True,'ackReceived':True,'controllerLoaded':True,'sourceControllerResultState':'absent','controllerStatusCapture':{'state':'captured','attempts':1,'rolePresent':True,'contentComplete':True,'closeCertain':True,'reason':None,'bytes':len(cb),'sha256':hashlib.sha256(cb).hexdigest()}}
    for k in ('observerOwnershipQualified','outerTimeoutQualified','officialHostQualified','resourceSufficiencyQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):entry[k]=False
    observer={'schema':'bw.provisioning-operational-resource-observation.v1','sourceSchema':'bw.provisioning-observer-admission.v1','phase':'closed','closed':True,'admissionObserved':True,'firstFailure':None,'cleanupRefused':0,'kernelLimitRows':[{'name':n,'resource':k,'observedSoft':v,'observedHard':v,'matchesPolicy':True}for n,k,v in policy],'handlesAdmitted':True,'ownedDescriptors':0,'ackAttempted':True,'ackSent':True,'ackMayHaveEscaped':True,'resourceWireReference':{'bytes':len(wb),'sha256':hashlib.sha256(wb).hexdigest()}}
    for k in ('namespaceOwnershipQualified','continuousPIDLeaseQualified','outerTimeoutQualified','officialHostQualified','resourceSufficiencyQualified','aggregateQuotaQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):observer[k]=False
    lifetime={'schema':'bw.provisioning-observer-lifetime.v1','phase':'observed','closed':True,'complete':True,'firstFailure':None,'cleanupRefused':0,'stdoutPrefixBytes':0,'stderrPrefixBytes':0,'stdoutObservedBytes':0,'stderrObservedBytes':0,'stdoutPrefixSha256':hashlib.sha256(b'').hexdigest(),'stderrPrefixSha256':hashlib.sha256(b'').hexdigest(),'stdoutEOF':True,'stderrEOF':True,'outputCapRefused':False,'admissionObserved':True,'historicalHandlesAdmitted':True,'ackAttempted':True,'ackSent':True,'ackMayHaveEscaped':True,'pid1Terminal':True,'launcherReaped':True,'launcherExit':0,'censusCounts':[0,0],'signalAttempted':False,'signalReturned':False,'cleanupObservationsMissing':False,'launchUnobserved':False}
    for k in ('namespaceOwnershipQualified','continuousLeaseQualified','outerHardDeadlineQualified','officialHostQualified','resourceSufficiencyQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified'):lifetime[k]=False
    members={'controller-status.json':cb,'entry-status.json':enc(entry),'resource-wire.bin':wb,'resource-observation.json':enc(observer),'lifetime-status.json':enc(lifetime),'stdout.bin':b'','stderr.bin':b'','observer-diagnostic.bin':b'','official-event.json':enc({'schema':'bw.provisioning-operational-event.v1','event':'pull_request','action':'opened','headRepository':'CrispStrobe/bw-board','pr':1,'base':'b'*40,'workflow':'.github/workflows/i80386-provisioning-operational-profile.yml','job':'operational-smoke','repository':'CrispStrobe/bw-board','head':'a'*40,'run':1,'attempt':1,'mode':'limits-ack-approval-refusal','authenticatedContextQualified':False})}
    index={'schema':'bw.provisioning-operational-capture.v1','mode':'limits-ack-approval-refusal','roles':{name:{'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}for name,body in members.items()},'childCapture':{'schema':'bw.provisioning-contained-capture.v1','records':{n:{'state':'captured','attempts':1,'rolePresent':True,'contentComplete':True,'closeCertain':True,'reason':None,'bytes':len(members[n]),'sha256':hashlib.sha256(members[n]).hexdigest()}for n in ('resource-wire.bin','controller-status.json','entry-status.json')},'primaryType':'Refusal','captureErrors':[],'observationAbsentReason':'child-before-group-absent','actualAcquisitionQualified':False,'compilerQualified':False},'parentCapture':{n:{'state':'captured','attempts':1,'rolePresent':True,'contentComplete':True,'closeCertain':True,'reason':None,'bytes':len(members[n]),'sha256':hashlib.sha256(members[n]).hexdigest()}for n in ('observer-diagnostic.bin','official-event.json')},'observerExit':0,'outerDiagnosticBytes':0,'outerDiagnosticOverflow':False,'outerCaptureError':None,'outerCleanupRefused':0,'reviewDigest':'c'*64,'hostTools':{p:{'bytes':1,'sha256':'d'*64}for p in ('/usr/bin/python3','/usr/bin/timeout','/usr/bin/unshare','/usr/bin/git')},'observationAbsentReason':'child-before-group-absent','finiteFixturePass':False,'materializationComplete':False,'actualAcquisitionQualified':False,'compilerQualified':False}
    members['capture-index.json']=enc(index);return members

class Controls(unittest.TestCase):
    def setUp(self):self.reader=module('report-reader');self.collect=module('collect')
    def mutate(self,name,fn):
        members=fixture();value=json.loads(members[name]);fn(value);members[name]=json.dumps(value).encode();index=json.loads(members['capture-index.json']);index['roles'][name]={'bytes':len(members[name]),'sha256':hashlib.sha256(members[name]).hexdigest()};
        for records in (index['childCapture']['records'],index['parentCapture']):
            if name in records:records[name].update(bytes=len(members[name]),sha256=hashlib.sha256(members[name]).hexdigest())
        if name=='controller-status.json':
            entry=json.loads(members['entry-status.json']);entry['controllerStatusCapture'].update(bytes=len(members[name]),sha256=hashlib.sha256(members[name]).hexdigest());members['entry-status.json']=json.dumps(entry).encode();index['roles']['entry-status.json']={'bytes':len(members['entry-status.json']),'sha256':hashlib.sha256(members['entry-status.json']).hexdigest()};index['childCapture']['records']['entry-status.json'].update(**index['roles']['entry-status.json'])
        members['capture-index.json']=json.dumps(index).encode();return self.reader.audit(members,0,False)
    def test_default_driver_zero_os(self):
        d=module('driver')
        with patch.object(d.os,'open',side_effect=AssertionError('OS')),patch.object(d.subprocess,'Popen',side_effect=AssertionError('process')):
            with self.assertRaises(d.Refusal):d.main()
            with self.assertRaises(d.Refusal):d.actual()
    def test_fixture_smoke_not_materialization(self):
        result=self.reader.audit(fixture(),0,False);self.assertTrue(result['finiteFixturePass']);self.assertFalse(result['materializationComplete']);self.assertFalse(result['actualAcquisitionQualified'])
    def test_missing_before_no_v1(self):
        m=fixture();m['observation.zip']=b'fake';self.assertFalse(self.reader.audit(m,0,False)['finiteFixturePass'])
    def test_controller_unexpected_transport(self):self.assertFalse(self.mutate('controller-status.json',lambda x:x.update(transport={}))['finiteFixturePass'])
    def test_controller_first_error_preserved(self):self.assertFalse(self.mutate('controller-status.json',lambda x:x.update(firstFailure='operation-refused'))['finiteFixturePass'])
    def test_entry_success_cannot_replace_refusal(self):self.assertFalse(self.mutate('entry-status.json',lambda x:x.update(complete=True))['finiteFixturePass'])
    def test_bool_kernel_limit_refused(self):self.assertFalse(self.mutate('resource-observation.json',lambda x:x['kernelLimitRows'][4].update(observedSoft=False))['finiteFixturePass'])
    def test_missing_ack_refused(self):self.assertFalse(self.mutate('resource-observation.json',lambda x:x.update(ackSent=False))['finiteFixturePass'])
    def test_consumed_handles_no_current_credit(self):self.assertFalse(self.mutate('resource-observation.json',lambda x:x.update(ownedDescriptors=1))['finiteFixturePass'])
    def test_terminal_census_and_cleanup(self):
        for key,value in [('pid1Terminal',False),('censusCounts',[0,1]),('cleanupRefused',1),('cleanupObservationsMissing',True)]:
            with self.subTest(key=key):self.assertFalse(self.mutate('lifetime-status.json',lambda x:x.update({key:value}))['finiteFixturePass'])
    def test_raw_prefix_original_bytes(self):
        m=fixture();m['stdout.bin']=b'\x00\xff';self.assertFalse(self.reader.audit(m,0,False)['finiteFixturePass'])
    def test_outer_exit_overflow(self):
        self.assertFalse(self.reader.audit(fixture(),-9,False)['finiteFixturePass']);self.assertFalse(self.reader.audit(fixture(),0,True)['finiteFixturePass'])
    def test_duplicate_and_foreign_keys(self):
        m=fixture();m['controller-status.json']=b'{"schema":1,"schema":2}'
        self.assertFalse(self.reader.audit(m,0,False)['finiteFixturePass'])
        with self.assertRaises(self.reader.Refusal):self.reader.audit({True:b''},0,False)
    def test_cap_before_json(self):
        with patch.object(self.reader.json,'loads',side_effect=AssertionError('parse')):
            with self.assertRaises(self.reader.Refusal):self.reader.audit({'stdout.bin':b'x'*65537},0,False)
    def test_store_exclusive_readback(self):
        with tempfile.TemporaryDirectory()as tmp:
            fd=os.open(tmp,os.O_RDONLY|os.O_DIRECTORY)
            try:
                store=self.collect.Store(fd);store.put('stdout.bin',b'\x00\xff');self.assertEqual(store.records['stdout.bin']['sha256'],hashlib.sha256(b'\x00\xff').hexdigest())
                with self.assertRaises(self.collect.Refusal):store.put('stdout.bin',b'other')
            finally:os.close(fd)
    def test_store_cap_retains_reason(self):
        with tempfile.TemporaryDirectory()as tmp:
            fd=os.open(tmp,os.O_RDONLY|os.O_DIRECTORY)
            try:
                store=self.collect.Store(fd)
                with self.assertRaises(self.collect.Refusal):store.put('stdout.bin',b'x'*65537)
                self.assertEqual(store.records['stdout.bin']['reason'],'serialization-cap-refused')
            finally:os.close(fd)
    def test_store_partial_write_primary_close(self):
        with tempfile.TemporaryDirectory()as tmp:
            fd=os.open(tmp,os.O_RDONLY|os.O_DIRECTORY);realwrite=os.write;realclose=os.close;original=OSError('first-write');calls=[]
            def write(handle,body):
                calls.append(1)
                if len(calls)==1:return realwrite(handle,body[:1])
                raise original
            def close(handle):realclose(handle);raise OSError('secondary-close')
            try:
                store=self.collect.Store(fd)
                with patch.object(self.collect.os,'write',new=write),patch.object(self.collect.os,'close',new=close):
                    with self.assertRaises(OSError)as caught:store.put('stdout.bin',b'ab')
                self.assertIs(caught.exception,original);self.assertEqual(Path(tmp,'stdout.bin').read_bytes(),b'a');self.assertTrue(store.records['stdout.bin']['rolePresent']);self.assertFalse(store.records['stdout.bin']['closeCertain'])
            finally:realclose(fd)

    def test_real_entry_limits_ack_controller_refusal_with_mocked_kernel(self):
        import resource,socket,sys
        b=module('contained-bootstrap');c=self.collect
        entrybody=(ROOT/'scripts/i80386-provisioning-contained/entry.py').read_bytes()
        # Only private control wiring substitutes admission; held Entry/Limits/
        # Controller source is compiled unchanged, all kernel edges mocked.
        expected={0:(180,180),9:(2147483648,2147483648),1:(67108864,67108864),7:(256,256),4:(0,0)}
        sets=[];gets=[];closed=[]
        class Channel:
            def sendmsg(self,buffers,ancillary):return len(buffers[0])
            def recv(self,n):return b'ACK\n'
            def settimeout(self,n):pass
            def getsockopt(self,*args):return int(socket.SOCK_SEQPACKET)
            def close(self):closed.append('channel')
        realopen=os.open;realclose=os.close
        def opened(path,*args,**kwargs):
            return 9001 if str(path)=='/proc/self/ns/pid'else realopen(path,*args,**kwargs)
        def close(fd):
            if fd in (9001,9002):closed.append(fd)
            else:realclose(fd)
        with tempfile.TemporaryDirectory()as tmp:
            Path(tmp,'approval.json').write_bytes(b'{}');fd=realopen(tmp,os.O_RDONLY|os.O_DIRECTORY)
            with patch.object(b,'_load_collect',return_value=c),patch.object(c,'admit',return_value=({}, {'scripts/i80386-provisioning-contained/entry.py':entrybody})),patch.object(sys,'argv',['bootstrap','--channel-fd','9000','--report-fd',str(fd)]),patch.object(socket,'socket',return_value=Channel()),patch.object(os,'open',new=opened),patch.object(os,'close',new=close),patch.object(os,'pidfd_open',return_value=9002),patch.object(os,'getpid',return_value=1),patch.object(os,'getuid',return_value=0),patch.object(os,'geteuid',return_value=0),patch.object(os,'getgid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(resource,'setrlimit',new=lambda k,v:sets.append((k,v))),patch.object(resource,'getrlimit',new=lambda k:(gets.append(k)or expected[k])),patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_RUN_ATTEMPT':'1'}):
                self.assertEqual(b.main(),0)
            result=json.loads(Path(tmp,'controller-status.json').read_bytes());entry=json.loads(Path(tmp,'entry-status.json').read_bytes())
            self.assertEqual(result['firstFailure'],'approval-unarmed');self.assertIsNone(result['transport']);self.assertIsNone(result['sourceBefore']);self.assertEqual(entry['sourceControllerResultState'],'absent');self.assertTrue(entry['ackReceived']);self.assertEqual(len(sets),5);self.assertEqual(len(gets),10);self.assertEqual(closed.count(9001),1);self.assertEqual(closed.count(9002),1);self.assertEqual(closed.count('channel'),1)

    def test_companion_stored_framing_independent_reader(self):
        with tempfile.TemporaryDirectory()as tmp:
            members=fixture();self.collect.package(tmp,members);raw=Path(tmp,'companion.zip').read_bytes()
            self.assertTrue(self.reader.audit_zip(raw)['finiteFixturePass'])
            for bad in (b'x'+raw,raw+b'x',raw[:50]+bytes([raw[50]^1])+raw[51:]):
                with self.subTest(kind=len(bad)):
                    with self.assertRaises(self.reader.Refusal):self.reader.audit_zip(bad)
    def test_event_and_index_not_selfauthority(self):
        self.assertFalse(self.mutate('official-event.json',lambda v:v.update(authenticatedContextQualified=True))['finiteFixturePass'])
        self.assertFalse(self.mutate('official-event.json',lambda v:v.update(attempt=True))['finiteFixturePass'])
        members=fixture();index=json.loads(members['capture-index.json']);index['roles']['stdout.bin']['sha256']='f'*64;members['capture-index.json']=json.dumps(index).encode()
        self.assertFalse(self.reader.audit(members,0,False)['finiteFixturePass'])
    def test_approval_bad_cap_no_compile(self):
        for name in ('driver','observer-main','contained-bootstrap'):
            m=module(name)
            with patch('builtins.compile',side_effect=AssertionError('compile')):
                for raw,seal in ((b'{}',None),(b'x'*65537,'a'*64)):
                    with self.assertRaises(ValueError):m._preload(raw,seal)

    def test_real_graph_admission_and_precompile_closure(self):
        d=module('driver');graph=json.loads((HERE/'fixed-graph.json').read_bytes())
        roles={}
        for path in graph['roles']:
            body=(ROOT/path).read_bytes();roles[path]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
        review={'schema':'bw.provisioning-operational-approval.v1','repository':'CrispStrobe/bw-board','head':'a'*40,'mode':'limits-ack-approval-refusal','roles':roles,'graphSha256':hashlib.sha256((HERE/'fixed-graph.json').read_bytes()).hexdigest()}
        raw=(json.dumps(review,sort_keys=True,separators=(',',':'))+'\n').encode();loaded=d._preload(raw,hashlib.sha256(raw).hexdigest());self.assertTrue(hasattr(loaded,'Store'))
        for change in ('missing','bool','digest'):
            bad=json.loads(raw)
            if change=='missing':del bad['roles']['scripts/i80386-full-tree-provisioner/manifest.json']
            elif change=='bool':bad['roles'][PROFILE_PATH]['bytes']=True
            else:bad['graphSha256']='f'*64
            body=json.dumps(bad).encode()
            with patch('builtins.compile',side_effect=AssertionError('compile before admission')):
                with self.assertRaises(ValueError):d._preload(body,hashlib.sha256(body).hexdigest())

    def test_foreign_file_descriptor_never_closed(self):
        with patch.object(self.collect.os,'open',return_value=True),patch.object(self.collect.os,'close',side_effect=AssertionError('foreign close')):
            with self.assertRaises(self.collect.Refusal):self.collect.regular('/not-opened',10)
    def test_owned_launch_alias_refusal_closes_unique(self):
        import socket
        o=module('observer-main');c=self.collect
        lifetimebody=(ROOT/'scripts/i80386-provisioning-observer-lifetime/lifetime.py').read_bytes();closed=[];realopen=os.open;realclose=os.close;realstat=os.stat
        class Channel:
            def __init__(self,n):self.n=n
            def fileno(self):return self.n
            def setsockopt(self,*args):pass
            def close(self):closed.append(('socket',self.n))
        original_module=c.module
        def loader(root,bodies,relative):
            loaded=original_module(root,bodies,relative)
            loaded.Lifetime._run=lambda owner:loaded._launch()
            return loaded
        def close(fd):
            if fd>=100:closed.append(('raw',fd))
            else:realclose(fd)
        class RootStat:
            st_uid=0
        with tempfile.TemporaryDirectory()as tmp:
            output=Path(tmp,'bw-provisioning-operational');output.mkdir();(output/'approval.json').write_bytes(b'{}')
            with patch.dict(os.environ,{'RUNNER_TEMP':tmp}),patch.object(o,'_collector',return_value=c),patch.object(c,'admit',return_value=({}, {'scripts/i80386-provisioning-observer-lifetime/lifetime.py':lifetimebody})),patch.object(c,'module',new=loader),patch.object(os,'getuid',return_value=0),patch.object(os,'geteuid',return_value=0),patch.object(os,'getgid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(os,'stat',new=lambda path,*a,**k:RootStat()if Path(path)in(ROOT,ROOT/'.git')else realstat(path,*a,**k)),patch.object(socket,'socketpair',return_value=(Channel(100),Channel(101))),patch.object(os,'pipe2',side_effect=[(101,102),(103,104)]),patch.object(os,'close',new=close),patch.object(o.subprocess,'Popen',side_effect=AssertionError('launch before unique ownership')):
                with self.assertRaises(c.Refusal):o.main()
            self.assertEqual(closed.count(('socket',101)),1);self.assertNotIn(('raw',101),closed)
            self.assertEqual(len(closed),len(set(closed)))

    def test_capture_uncertainty_retained_never_positive(self):
        for kind in ('child-error','child-close','parent-write','bool-attempt'):
            members=fixture();index=json.loads(members['capture-index.json'])
            if kind=='child-error':index['childCapture']['captureErrors']=['report-directory-close-refused']
            elif kind=='child-close':index['childCapture']['records']['controller-status.json'].update(state='close-uncertain',closeCertain=False)
            elif kind=='parent-write':index['parentCapture']['observer-diagnostic.bin'].update(state='write-refused',contentComplete=False)
            else:index['childCapture']['records']['controller-status.json']['attempts']=True
            members['capture-index.json']=json.dumps(index).encode()
            self.assertFalse(self.reader.audit(members,0,False)['finiteFixturePass'])

    def test_launch_closure_captured_seal_and_fixed_mapping(self):
        import socket
        o=module('observer-main');c=self.collect;actual_module=c.module;closed=[];commands=[];realclose=os.close;realstat=os.stat;stop=OSError('manufactured-after-handoff')
        class Channel:
            def __init__(self,n):self.n=n
            def fileno(self):return self.n
            def setsockopt(self,*args):pass
            def close(self):closed.append(self.n)
        def close(fd):
            if fd>=100:closed.append(fd)
            else:realclose(fd)
        def loader(root,bodies,relative):
            loaded=actual_module(root,bodies,relative)
            def run(owner):
                bundle=loaded._launch();bundle[1].close();close(bundle[2]);close(bundle[3]);raise stop
            loaded.Lifetime._run=run;return loaded
        class RootStat:st_uid=0
        with tempfile.TemporaryDirectory()as tmp:
            output=Path(tmp,'bw-provisioning-operational');output.mkdir();(output/'approval.json').write_bytes(b'{}')
            bodies={'scripts/i80386-provisioning-observer-lifetime/lifetime.py':(ROOT/'scripts/i80386-provisioning-observer-lifetime/lifetime.py').read_bytes()}
            def popen(args,**kwargs):commands.append((args,kwargs));return object()
            with patch.dict(os.environ,{'RUNNER_TEMP':tmp,'BW_APPROVAL_SHA256':'c'*64}),patch.object(o,'_collector',return_value=c),patch.object(c,'admit',return_value=({},bodies)),patch.object(c,'module',new=loader),patch.object(os,'getuid',return_value=0),patch.object(os,'geteuid',return_value=0),patch.object(os,'getgid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(os,'stat',new=lambda path,*a,**k:RootStat()if Path(path)in(ROOT,ROOT/'.git')else realstat(path,*a,**k)),patch.object(socket,'socketpair',return_value=(Channel(100),Channel(101))),patch.object(os,'pipe2',side_effect=[(102,103),(104,105)]),patch.object(os,'close',new=close),patch.object(o.subprocess,'Popen',new=popen):
                with self.assertRaises(OSError)as caught:o.main()
            self.assertIs(caught.exception,stop);self.assertEqual(len(commands),1)
            argv,opts=commands[0];self.assertEqual(argv[:3],('/usr/bin/timeout','--signal=KILL','480s'));self.assertNotIn('/usr/bin/sudo',argv);self.assertEqual(opts['pass_fds'][0],101);self.assertEqual(len(opts['pass_fds']),2);self.assertNotIn(103,opts['pass_fds']);self.assertNotIn(105,opts['pass_fds']);self.assertEqual(opts['stdin'],o.subprocess.DEVNULL);self.assertEqual(opts['env']['BW_APPROVAL_SHA256'],'c'*64)
            self.assertEqual(len(closed),len(set(closed)))
    def test_driver_primary_survives_selector_and_pipe_cleanup(self):
        import stat
        d=module('driver');c=self.collect;realregular=c.regular;reallstat=os.lstat;realread=os.read;first=OSError('original-pipe-read');closed=[]
        class Stream:
            def fileno(self):return 111
            def close(self):closed.append('pipe')
        class Process:
            stderr=Stream()
            def kill(self):closed.append('owned-process')
            def wait(self,timeout):return -9
        class Selector:
            def register(self,*args):pass
            def select(self,*args):return [(None,None)]
            def close(self):closed.append('selector');raise OSError('secondary-selector-close')
        class RootStat:st_uid=0;st_mode=stat.S_IFDIR
        with tempfile.TemporaryDirectory()as tmp:
            checkout=Path(tmp,'synthetic-checkout');(checkout/'.git/objects/info').mkdir(parents=True)
            output=Path(tmp,'bw-provisioning-operational');output.mkdir();members=fixture()
            for name,body in members.items():
                if name not in ('capture-index.json','official-event.json','observer-diagnostic.bin'):(output/name).write_bytes(body)
            (output/'child-capture.json').write_bytes(json.dumps(json.loads(members['capture-index.json'])['childCapture']).encode());(output/'approval.json').write_bytes(b'{}')
            env={'RUNNER_TEMP':tmp,'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'1','GITHUB_SHA':'a'*40,'BW_HEAD_SHA':'a'*40,'BW_HEAD_REPOSITORY':'CrispStrobe/bw-board','GITHUB_EVENT_NAME':'pull_request','BW_PR_ACTION':'opened','BW_PR_NUMBER':'1','BW_BASE_SHA':'b'*40}
            def read(fd,n):
                if fd==111:raise first
                return realread(fd,n)
            bodies={'scripts/i80386-provisioning-operational-profile/report-reader.py':(HERE/'report-reader.py').read_bytes()}
            with patch.object(d,'ROOT',checkout),patch.object(d,'EXTERNAL_APPROVAL_SHA256','c'*64),patch.dict(os.environ,env),patch.object(d,'_load',return_value=c),patch.object(c,'admit',return_value=({'head':'a'*40},bodies)),patch.object(c,'regular',new=lambda path,cap:realregular(path,cap)if str(path).startswith(str(output))else b'tool'),patch.object(os,'getuid',return_value=0),patch.object(os,'geteuid',return_value=0),patch.object(os,'getgid',return_value=0),patch.object(os,'getegid',return_value=0),patch.object(os,'lstat',new=lambda path,*a,**k:RootStat()if Path(path)in(checkout,checkout/'.git')else reallstat(path,*a,**k)),patch.object(d.subprocess,'Popen',return_value=Process()),patch.object(d.selectors,'DefaultSelector',return_value=Selector()),patch.object(os,'set_blocking',return_value=None),patch.object(os,'read',new=read),patch.object(d.time,'monotonic',return_value=100.0):
                with self.assertRaises(OSError)as caught:d.main()
            self.assertIs(caught.exception,first);self.assertEqual(closed.count('selector'),1);self.assertEqual(closed.count('pipe'),1);self.assertTrue((output/'observer-diagnostic.bin').exists())

if __name__=='__main__':unittest.main()
