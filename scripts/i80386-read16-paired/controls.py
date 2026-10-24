"""Pure manufactured originals and mocked process edges; never executes a child."""
import base64
import copy
from contextlib import ExitStack
import importlib.util
import json
import io
from pathlib import Path
import types
import tempfile
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
def load(name):
    spec=importlib.util.spec_from_file_location('_read16_'+name,HERE/(name+'.py'));value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
reader=load('reader');producer=load('run')
def b64(raw):return base64.b64encode(raw).decode()
def fixture():
    rows_raw=(HERE/'source-rows.json').read_bytes();rows=json.loads(rows_raw)
    common={p:{'bytes':1,'sha256':'f'*64} for p in reader.COMMON}
    req={'schema':'bw.read16-paired-request.v1','repository':'CrispStrobe/bw-board','head':'a'*40,'tree':'b'*40,'baseHead':reader.BASE_HEAD,'baseTree':reader.BASE_TREE,'workflowHead':'c'*40,'workflowRef':'CrispStrobe/bw-board/.github/workflows/i80386-read16-paired.yml@refs/pull/999/merge','pullRequest':999,'sourceBranch':'lane/386-read16-ordered-pair-source-20261024','label':'x86-read16-paired-v1','eventName':'pull_request','attempt':1,'sourceRowsSha256':reader.ROWS_SHA,'commonFiles':common,'workflowSha256':'f'*64}
    request_raw=reader.canonical(req);event_raw=reader.canonical({'repository':{'full_name':'CrispStrobe/bw-board','fork':False},'sender':{'login':'CrispStrobe'},'action':'labeled','number':999,'label':{'name':req['label']},'pull_request':{'body':'<!-- BW_READ16_PAIRED_REQUEST_SHA256='+reader.sha(request_raw)+' -->','number':999,'state':'open','merged':False,'labels':[{'name':req['label']}],'head':{'sha':req['head'],'ref':req['sourceBranch'],'repo':{'full_name':'CrispStrobe/bw-board','fork':False,'owner':{'login':'CrispStrobe'}}},'base':{'ref':'master','repo':{'full_name':'CrispStrobe/bw-board'}}}})
    source={'schema':'bw.read16-paired-source.v1','head':req['head'],'tree':req['tree'],'baseHead':reader.BASE_HEAD,'baseTree':reader.BASE_TREE,'rowsBase64':b64(rows_raw),'commonFiles':common,'arms':rows,'workflowSource':{'head':req['workflowHead'],'ref':req['workflowRef'],'fileBytes':1,'fileSha256':'f'*64}}
    source_sha=reader.sha(reader.canonical(source));unit='bw-read16-paired-42-1.service';parent=999
    context={'workflowHead':req['workflowHead'],'workflowRef':req['workflowRef'],'actor':'CrispStrobe','repository':req['repository'],'head':req['head'],'pullRequest':req['pullRequest'],'sourceBranch':req['sourceBranch'],'eventName':'pull_request','eventSha256':reader.sha(event_raw),'requestSha256':reader.sha(request_raw),'runId':'42','attempt':1,'job':'paired','parentPid':parent,'unit':unit}
    semantic={'schema':'bw.at-profile-child.v1','kind':'at','steps':1000000,'charges':6000000,'cpuCycles':1000000,'state':{'ax':65534,'bx':65535,'ip':0,'word':65535},'ifEnabled':False,'interrupts':0,'ordinarySettings':{'translationCache':True,'deliverFaults':True,'cpuProfile':'compatibility'},'devices':{'machineCycles':6000000,'debt':5310,'deadline':16000,'appliedClocks':5994690,'pitFraction':0.262723749965744,'pitCounters':[{'mode':0,'rw':0,'reload':0,'ce':0,'out':0,'armed':False,'nullCount':True,'gate':g} for g in (1,1,0)],'pics':[{'irr':0,'isr':0,'imr':0,'vectorBase':0,'intActive':False}]*2,'rtc':{'cyclePhase':5994690,'periodicPhase':10562560,'registerB':2,'registerC':64},'cga':{'cycles':5994690,'frameCount':22,'lastVretrace':0},'keyboard':{'commandByte':0,'queue':[{'value':170,'keyboard':True}],'scheduled':0}}}
    def position(child=None):return {'unit':unit,'membership':'/system.slice/'+unit,'observerPid':parent if child is None else child,'affinity':[1],'limits':{'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','pids.max':'64'},'pids':[parent] if child is None else sorted([parent,child]),'descendants':0,'dyingDescendants':0,'populated':1,'tasksCurrent':1 if child is None else 2,'memoryEvents':{'low':0,'high':0,'max':0,'oom':0,'oom_kill':0,'oom_group_kill':0}}
    children=[]
    for sequence,phase,pair,arm in reader.SCHEDULE:
        raw=reader.canonical({'schema':'bw.read16-paired-child.v1','arm':arm,'sourceFiles':rows[arm],'semantic':copy.deepcopy(semantic),'setupNanoseconds':'1000','executionLoopNanoseconds':'100000000','warmupSteps':25000,'warmupDoesNotContributeToMeasuredState':True,'physical386TimingCalibrated':False})
        cpu=1.1 if arm=='A' else 1.0;pid=1000+sequence
        usage={'pid':pid,'exitCode':0,'reaped':True,'timedOut':False,'userSeconds':cpu,'systemSeconds':0.0,'cpuSeconds':cpu,'wallSeconds':1.2,'maxRSSKiB':65536,'stdoutBytes':len(raw),'stderrBytes':0,'primary':None,'secondary':[]}
        resource={'before':position(),'preexec':position(pid),'after':position(),'sourceBeforeSha256':source_sha,'sourceAfterSha256':source_sha,'runtimeBeforeSha256':reader.NODE_SHA,'runtimeAfterSha256':reader.NODE_SHA}
        children.append({'sequence':sequence,'phase':phase,'pair':pair,'arm':arm,'stdoutBase64':b64(raw),'stderrBase64':'','usage':usage,'resource':resource})
    original={'schema':'bw.read16-paired-original.v1','requestBase64':b64(request_raw),'eventBase64':b64(event_raw),'source':source,'runtime':{'nodeVersion':'22.23.3','nodeBytes':124827920,'nodeSha256':reader.NODE_SHA,'nodePath':'/opt/hostedtoolcache/node/22.23.3/x64/bin/node','measurement':'whole child including preexec; wait4 user+system and matched monotonic wall'},'context':context,'children':children,'failure':None}
    cleanup={'schema':'bw.read16-paired-cleanup.v1','runId':'42','attempt':1,'unit':unit,'beforeShowExit':0,'beforeShowStdoutBase64':b64(b'LoadState=not-found\nActiveState=inactive\nControlGroup=\nResult=success\nExecMainPID=0\nExecMainCode=0\nExecMainStatus=0\n'),'beforeShowStderrBase64':'','stopExit':0,'stopStdoutBase64':'','stopStderrBase64':'','showExit':0,'showStdoutBase64':b64(b'LoadState=not-found\nActiveState=inactive\nControlGroup=\nExecMainPID=0\n'),'showStderrBase64':'','cgroupAbsent':True,'remainingPids':[],'nestedGroups':[],'errors':[]}
    expected={'schema':'bw.read16-paired-expectation.v1','head':req['head'],'tree':req['tree'],'workflowHead':req['workflowHead'],'workflowRef':req['workflowRef'],'pullRequest':req['pullRequest'],'runId':'42','jobId':43,'artifactId':44,'requestSha256':reader.sha(request_raw),'eventSha256':reader.sha(event_raw),'originalSha256':'','originalBytes':0,'cleanupSha256':'','cleanupBytes':0,'workflowSha256':'f'*64,'conclusion':'success'}
    return original,cleanup,request_raw,event_raw,expected

def evaluate(parts):
    original,cleanup,request_raw,event_raw,expected=copy.deepcopy(parts)
    original_raw=reader.canonical(original);cleanup_raw=reader.canonical(cleanup)
    expected.update(originalSha256=reader.sha(original_raw),originalBytes=len(original_raw),cleanupSha256=reader.sha(cleanup_raw),cleanupBytes=len(cleanup_raw))
    return reader.audit(original_raw,cleanup_raw,request_raw,event_raw,expected)

def source_control_sparse_paths(workflow):
    # This job deliberately uses only literal non-cone file/directory selectors.
    job=workflow.split('  source-controls:\n',1)[1].split('  paired:\n',1)[0]
    marker='          sparse-checkout: |\n'
    if job.count(marker)!=1 or '          sparse-checkout-cone-mode: false\n' not in job:raise ValueError('one literal non-cone source-controls checkout')
    selected=[]
    for line in job.split(marker,1)[1].splitlines():
        if not line.startswith('            '):break
        name=line[12:]
        if not name or name!=name.strip() or name.startswith('/') or any(c in name for c in '*?![]\\') or any(p in ('','.','..') for p in name.split('/')):raise ValueError('literal repository sparse selector')
        selected.append(name)
    if len(selected)!=len(set(selected)):raise ValueError('unique sparse selectors')
    return selected

def require_source_control_sparse_closure(workflow,required):
    selected=source_control_sparse_paths(workflow)
    missing=sorted(name for name in required if not any(name==p or name.startswith(p+'/') for p in selected))
    if missing:raise ValueError('source-controls sparse closure missing: '+', '.join(missing))
    return selected

class SparseCheckoutControls(unittest.TestCase):
    def inputs(self):
        workflow=(HERE.parents[1]/'.github/workflows/i80386-read16-paired.yml').read_text()
        rows=reader.source_rows((HERE/'source-rows.json').read_bytes())
        self.assertEqual(set(rows['A']),set(rows['B']))
        required=set(reader.COMMON)|set(rows['B'])
        self.assertEqual(len(reader.COMMON),10);self.assertEqual(len(rows['B']),35)
        return workflow,required
    def test_source_controls_checkout_covers_COMMON10_and_source35(self):
        workflow,required=self.inputs()
        require_source_control_sparse_closure(workflow,required)
        for name in required:self.assertTrue((HERE.parents[1]/name).is_file(),name)
    def test_removing_required_file_or_directory_selector_is_detected(self):
        workflow,required=self.inputs()
        require_source_control_sparse_closure(workflow,required)
        for selector in ('.github/workflows/i80386-read16-paired.yml','src','package.json'):
            line='            '+selector+'\n';self.assertIn(line,workflow.split('  paired:\n',1)[0])
            mutated=workflow.replace(line,'',1)
            with self.subTest(selector=selector),self.assertRaisesRegex(ValueError,'sparse closure missing'):
                require_source_control_sparse_closure(mutated,required)

class OriginalControls(unittest.TestCase):
    def test_positive_complete_packet_and_caps(self):
        p=fixture();v=evaluate(p);self.assertTrue(v['performancePassed']);self.assertFalse(v['adoptionQualified']);self.assertFalse(v['officialMetadataAuthenticated'])
        self.assertLess(len(reader.canonical(p[0])),reader.CAP)
        # Even maximum bounded raw streams fit the declared original cap.
        for c in p[0]['children']:c['stdoutBase64']=b64(b'x'*32768);c['stderrBase64']=b64(b'x'*8192)
        p[0]['eventBase64']=b64(b'x'*262144);p[0]['requestBase64']=b64(b'x'*65536)
        self.assertLess(len(reader.canonical(p[0])),reader.CAP)
    def test_gate_failure_retained_and_never_relabelled(self):
        p=list(fixture());u=p[0]['children'][4]['usage'];u['cpuSeconds']=u['userSeconds']=0.99
        p[0]['failure']={'phase':'gate','reason':'strict paired performance gate failed'};p[4]['conclusion']='failure';p[1]['beforeShowStdoutBase64']=b64(b'LoadState=loaded\nActiveState=failed\nControlGroup=/system.slice/bw-read16-paired-42-1.service\nResult=exit-code\nExecMainPID=999\nExecMainCode=1\nExecMainStatus=1\n')
        self.assertFalse(evaluate(p)['performancePassed'])
        p[0]['failure']=None
        with self.assertRaises(reader.Refusal):evaluate(p)
    def test_coherent_wall_failure_cannot_pass(self):
        p=fixture()
        for c in p[0]['children']:
            if c['arm']=='B':c['usage']['wallSeconds']=1.4
        p[0]['failure']={'phase':'gate','reason':'strict paired performance gate failed'};p[4]['conclusion']='failure';p[1]['beforeShowStdoutBase64']=b64(b'LoadState=loaded\nActiveState=failed\nControlGroup=/system.slice/bw-read16-paired-42-1.service\nResult=exit-code\nExecMainPID=999\nExecMainCode=1\nExecMainStatus=1\n')
        self.assertFalse(evaluate(p)['performancePassed'])
    def test_material_packet_mutations_rejected(self):
        mutations={
            'missing child':lambda p:p[0]['children'].pop(),
            'duplicate PID':lambda p:p[0]['children'][1]['usage'].update(pid=1000),
            'reordered schedule':lambda p:p[0]['children'].reverse(),
            'different tree':lambda p:p[0]['source'].update(tree='c'*40),
            'different runtime':lambda p:p[0]['runtime'].update(nodeVersion='22.23.2'),
            'changed current runtime':lambda p:p[0]['children'][8]['resource'].update(runtimeAfterSha256='e'*64),
            'changed source':lambda p:p[0]['children'][8]['resource'].update(sourceAfterSha256='e'*64),
            'nested group':lambda p:p[0]['children'][0]['resource']['after'].update(descendants=1),
            'extra process':lambda p:p[0]['children'][0]['resource']['after']['pids'].append(7654),
            'memory pressure':lambda p:p[0]['children'][0]['resource']['after']['memoryEvents'].update(max=1),
            'not reaped':lambda p:p[0]['children'][0]['usage'].update(reaped=False),
            'timeout':lambda p:p[0]['children'][0]['usage'].update(timedOut=True),
            'cleanup uncertainty':lambda p:p[0]['children'][0]['usage']['secondary'].append({'phase':'reap'}),
            'outside group remains':lambda p:p[1].update(cgroupAbsent=False),
            'outside active':lambda p:p[1].update(showStdoutBase64=b64(b'LoadState=loaded\nActiveState=active\nControlGroup=\n')),
            'official run drift':lambda p:p[4].update(runId='45'),
        }
        for name,mutation in mutations.items():
            with self.subTest(name=name):
                p=fixture();mutation(p)
                with self.assertRaises((reader.Refusal,ValueError)):evaluate(p)
    def test_coherent_authored_state_mutation_rejected(self):
        p=fixture()
        for c in p[0]['children']:
            v=json.loads(base64.b64decode(c['stdoutBase64']));v['semantic']['state']['ax']=0
            raw=reader.canonical(v);c['stdoutBase64']=b64(raw);c['usage']['stdoutBytes']=len(raw)
        with self.assertRaises(reader.Refusal):evaluate(p)
    def test_coherent_resource_policy_mutation_rejected(self):
        p=fixture()
        for c in p[0]['children']:
            for phase in ('before','preexec','after'):c['resource'][phase]['limits']['pids.max']='128'
        with self.assertRaises(reader.Refusal):evaluate(p)
    def test_coherent_source35_mutation_rejected(self):
        p=fixture();rows=json.loads(base64.b64decode(p[0]['source']['rowsBase64']))
        for arm in 'AB':rows[arm]['src/adc0809.js']['sha256']='d'*64
        p[0]['source']['rowsBase64']=b64(reader.canonical(rows));p[0]['source']['arms']=rows
        source_sha=reader.sha(reader.canonical(p[0]['source']))
        for c in p[0]['children']:
            v=json.loads(base64.b64decode(c['stdoutBase64']));v['sourceFiles']=rows[c['arm']];raw=reader.canonical(v)
            c['stdoutBase64']=b64(raw);c['usage']['stdoutBytes']=len(raw);c['resource'].update(sourceBeforeSha256=source_sha,sourceAfterSha256=source_sha)
        with self.assertRaises(reader.Refusal):evaluate(p)
    def test_producer_positive_and_negative_request_admission_is_inert(self):
        p=fixture();req=json.loads(p[2]);env={'GITHUB_ACTIONS':'true','GITHUB_ACTOR':'CrispStrobe','GITHUB_REPOSITORY':req['repository'],'BW_EXPECTED_HEAD':req['head'],'GITHUB_WORKFLOW_SHA':req['workflowHead'],'GITHUB_WORKFLOW_REF':req['workflowRef'],'GITHUB_HEAD_REF':req['sourceBranch'],'GITHUB_BASE_REF':'master','GITHUB_EVENT_NAME':'pull_request','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'paired','GITHUB_RUN_ID':'42','BW_READ16_REQUEST_SHA256':reader.sha(p[2])}
        with mock.patch.dict(producer.os.environ,env,clear=True):self.assertEqual(producer.admit_request(p[2],p[3]),req)
        for key in ('GITHUB_ACTOR','BW_EXPECTED_HEAD','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF','GITHUB_HEAD_REF','GITHUB_BASE_REF','GITHUB_REPOSITORY','GITHUB_RUN_ATTEMPT'):
            bad=dict(env);bad[key]='wrong'
            with self.subTest(key=key),mock.patch.dict(producer.os.environ,bad,clear=True):
                with self.assertRaises(producer.Refusal):producer.admit_request(p[2],p[3])
    def test_exact_PR_label_state_actor_and_head_mutations_refused(self):
        mutations={
            'label':lambda e:e['label'].update(name='other'),
            'action':lambda e:e.update(action='synchronize'),
            'closed':lambda e:e['pull_request'].update(state='closed'),
            'merged':lambda e:e['pull_request'].update(merged=True),
            'head':lambda e:e['pull_request']['head'].update(sha='c'*40),
            'fork':lambda e:e['pull_request']['head']['repo'].update(fork=True),
            'base':lambda e:e['pull_request']['base'].update(ref='main'),
            'actor':lambda e:e['sender'].update(login='collaborator'),
            'PR number':lambda e:(e.update(number=1000),e['pull_request'].update(number=1000)),
        }
        for name,mutation in mutations.items():
            with self.subTest(name=name):
                p=list(fixture());e=json.loads(p[3]);mutation(e);p[3]=reader.canonical(e)
                p[0]['eventBase64']=b64(p[3]);p[0]['context']['eventSha256']=reader.sha(p[3]);p[4]['eventSha256']=reader.sha(p[3])
                with self.assertRaises(producer.Refusal):producer.admit_event(json.loads(p[2]),e)
                with self.assertRaises(reader.Refusal):evaluate(p)
    def test_request_SHA_body_marker_missing_wrong_duplicate_and_mixed_refused(self):
        for kind in ('missing','wrong','duplicate','mixed'):
            with self.subTest(kind=kind):
                p=list(fixture());e=json.loads(p[3]);body=e['pull_request']['body']
                e['pull_request']['body']={'missing':'','wrong':'<!-- BW_READ16_PAIRED_REQUEST_SHA256='+'0'*64+' -->','duplicate':body+body,'mixed':body+body.lower()}[kind]
                p[3]=reader.canonical(e);p[0]['eventBase64']=b64(p[3]);p[0]['context']['eventSha256']=reader.sha(p[3]);p[4]['eventSha256']=reader.sha(p[3])
                with self.assertRaises(producer.Refusal):producer.admit_event(json.loads(p[2]),e)
                with self.assertRaises(reader.Refusal):evaluate(p)
    def test_executing_merge_workflow_identity_cannot_be_relabelled_as_head(self):
        for role in ('context','source','external'):
            p=fixture()
            if role=='context':p[0]['context']['workflowHead']=p[0]['context']['head']
            elif role=='source':p[0]['source']['workflowSource']['fileSha256']='d'*64
            else:p[4]['workflowHead']=p[4]['head']
            with self.subTest(role=role),self.assertRaises(reader.Refusal):evaluate(p)
    def test_terminal_owned_PID_and_failed_status_are_not_ignored(self):
        p=fixture();p[1]['showStdoutBase64']=b64(b'LoadState=not-found\nActiveState=inactive\nControlGroup=\nExecMainPID=7654\n')
        with self.assertRaises(reader.Refusal):evaluate(p)
        p=fixture();raw=base64.b64decode(p[1]['beforeShowStdoutBase64']).replace(b'Result=success',b'Result=timeout');p[1]['beforeShowStdoutBase64']=b64(raw)
        with self.assertRaises(reader.Refusal):evaluate(p)
    def test_duplicate_json_key_and_nonfinite_refused(self):
        with self.assertRaises(reader.Refusal):reader.parse(b'{"x":1,"x":1}',100)
        with self.assertRaises(reader.Refusal):reader.parse(b'{"x":NaN}',100)

class BootstrapControls(unittest.TestCase):
    def test_inline_bootstrap_positive_and_wrong_head_or_source_use_no_process(self):
        workflow=(HERE.parents[1]/'.github/workflows/i80386-read16-paired.yml').read_text()
        start=workflow.index('          import hashlib,json,os,re,stat,subprocess\n');end=workflow.index('          PY\n',start)
        body='\n'.join(line[10:] for line in workflow[start:end].splitlines())+'\n'
        self.assertIn('if: ${{ true &&',workflow);self.assertIn("steps.admission.outcome == 'success'",workflow)
        for mutation in ('none','head','source','workflow-live','workflow-head','workflow-ref','marker-missing','marker-duplicate','marker-mixed'):
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory(dir=HERE) as directory:
                root=Path(directory);publication=root/'publication';publication.mkdir();workflow_root=root/'workflow-source';workflow_root.mkdir();temp=root/'scratch';temp.mkdir()
                _,_,request_raw,event_raw,_=fixture();req=json.loads(request_raw)
                files={'scripts/i80386-read16-paired/run.py':b'INERT PRODUCER DATA\n','.github/workflows/i80386-read16-paired.yml':b'INERT WORKFLOW DATA\n'}
                for name,raw in files.items():
                    path=publication/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw);req['commonFiles'][name]={'bytes':len(raw),'sha256':reader.sha(raw)}
                req['workflowSha256']=req['commonFiles']['.github/workflows/i80386-read16-paired.yml']['sha256'];raw=reader.canonical(req)
                actual=workflow_root/'.github/workflows/i80386-read16-paired.yml';actual.parent.mkdir(parents=True);actual.write_bytes(files['.github/workflows/i80386-read16-paired.yml'])
                e=json.loads(event_raw);e['pull_request']['body']='<!-- BW_READ16_PAIRED_REQUEST_SHA256='+reader.sha(raw)+' -->'
                if mutation=='marker-missing':e['pull_request']['body']=''
                if mutation=='marker-duplicate':e['pull_request']['body']*=2
                if mutation=='marker-mixed':e['pull_request']['body']+=e['pull_request']['body'].lower()
                event_raw=reader.canonical(e)
                event_path=temp/'event.json';event_path.write_bytes(event_raw)
                env={'GITHUB_WORKSPACE':str(root),'RUNNER_TEMP':str(temp),'GITHUB_RUN_ID':'42','BW_READ16_REQUEST_JSON':raw.decode(),'BW_READ16_REQUEST_SHA256':reader.sha(raw),'BW_EXPECTED_HEAD':req['head'] if mutation!='head' else 'd'*40,'GITHUB_WORKFLOW_SHA':req['workflowHead'],'GITHUB_WORKFLOW_REF':req['workflowRef'],'GITHUB_EVENT_PATH':str(event_path)}
                if mutation=='workflow-live':actual.write_bytes(b'CHANGED WORKFLOW')
                if mutation=='workflow-head':env['GITHUB_WORKFLOW_SHA']='d'*40
                if mutation=='workflow-ref':env['GITHUB_WORKFLOW_REF']='wrong'
                if mutation=='source':(publication/'scripts/i80386-read16-paired/run.py').write_bytes(b'CHANGED')
                def git(command,**kwargs):
                    args=command[4:]
                    if args==('rev-parse','HEAD'):out=((req['workflowHead'] if command[3]==str(workflow_root) else req['head'])+'\n').encode()
                    elif args==('rev-parse','HEAD^{tree}'):out=(req['tree']+'\n').encode()
                    elif args[0]=='cat-file':
                        name=args[2].split(':',1)[1];out=(str(len(files[name]))+'\n').encode() if args[1]=='-s' else files[name]
                    else:raise AssertionError('unexpected command')
                    return types.SimpleNamespace(returncode=0,stdout=out,stderr=b'')
                with mock.patch.dict(producer.os.environ,env,clear=True),mock.patch.object(producer.subprocess,'run',side_effect=git),mock.patch.object(producer.subprocess,'Popen',side_effect=AssertionError('no child')):
                    if mutation=='none':exec(compile(body,'inert-workflow-bootstrap','exec'),{})
                    else:
                        with self.assertRaises(AssertionError):exec(compile(body,'inert-workflow-bootstrap','exec'),{})
                self.assertEqual((temp/'read16-admission-42-1/request.original.json').read_bytes(),raw)
                if mutation!='none':self.assertTrue((temp/'read16-admission-42-1/first-failure.json').exists())
    def test_cleanup_retains_before_status_and_stop_error_without_live_service(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            env={'GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_ACTOR':'CrispStrobe','GITHUB_RUN_ATTEMPT':'1','GITHUB_RUN_ID':'42','RUNNER_TEMP':directory}
            def capture(command,*args,**kwargs):
                usage={'exitCode':0,'primary':None,'secondary':[],'reaped':True,'timedOut':False}
                if 'stop' in command:usage['primary']={'type':'OSError','reason':'FIRST stop failure'};return b'',b'prefix',usage
                if '--property=Result' in command:return b'Result=timeout\nExecMainPID=999\n',b'',usage
                return b'LoadState=not-found\nActiveState=inactive\nControlGroup=\nExecMainPID=0\n',b'',usage
            with mock.patch.dict(producer.os.environ,env,clear=True),mock.patch.object(producer,'capture',side_effect=capture),mock.patch.object(producer.Path,'exists',return_value=False):
                with self.assertRaisesRegex(producer.Refusal,'incomplete'):producer.cleanup()
            data=json.loads((Path(directory)/'read16-paired-42-1/cleanup.original.json').read_bytes())
            self.assertEqual(base64.b64decode(data['beforeShowStdoutBase64']),b'Result=timeout\nExecMainPID=999\n');self.assertEqual(data['errors'][0]['usage']['primary']['reason'],'FIRST stop failure')

class AdmissionControls(unittest.TestCase):
    def test_positive_and_partial_source_refusal_retain_verified_rows_without_Git(self):
        rows=json.loads((HERE/'source-rows.json').read_bytes());root=HERE.parents[1]
        common={name:(root/name).read_bytes() for name in reader.COMMON}
        arms={'B':{name:(root/name).read_bytes() for name in rows['B']}}
        arms['A']=dict(arms['B']);arm_cpu=arms['A']['src/experimental/i80386.js']
        block=b'      if (size === 2) {\n        const low = this.read(physical) & 255;\n        const high = this.read((physical + 1) >>> 0) & 255;\n        return low | (high << 8);\n      }\n'
        self.assertEqual(arm_cpu.count(block),1);arms['A']['src/experimental/i80386.js']=arm_cpu.replace(block,b'',1)
        for arm in 'AB':
            for name,raw in arms[arm].items():self.assertEqual({'bytes':len(raw),'sha256':reader.sha(raw)},rows[arm][name])
        for failed in (False,True):
            with self.subTest(failed=failed),tempfile.TemporaryDirectory(dir=HERE) as directory:
                output=Path(directory)/'read16-admission-42-1';output.mkdir()
                p=fixture();req=json.loads(p[2]);req['commonFiles']={name:{'bytes':len(raw),'sha256':reader.sha(raw)} for name,raw in common.items()};req['workflowSha256']=req['commonFiles']['.github/workflows/i80386-read16-paired.yml']['sha256'];request_raw=reader.canonical(req)
                e=json.loads(p[3]);e['pull_request']['body']='<!-- BW_READ16_PAIRED_REQUEST_SHA256='+reader.sha(request_raw)+' -->';event_raw=reader.canonical(e)
                env={'GITHUB_ACTIONS':'true','GITHUB_ACTOR':'CrispStrobe','GITHUB_REPOSITORY':req['repository'],'BW_EXPECTED_HEAD':req['head'],'GITHUB_WORKFLOW_SHA':req['workflowHead'],'GITHUB_WORKFLOW_REF':req['workflowRef'],'GITHUB_HEAD_REF':req['sourceBranch'],'GITHUB_BASE_REF':'master','GITHUB_EVENT_NAME':'pull_request','GITHUB_RUN_ATTEMPT':'1','GITHUB_JOB':'paired','GITHUB_RUN_ID':'42','BW_READ16_REQUEST_SHA256':reader.sha(request_raw),'RUNNER_TEMP':directory}
                def resolve(path):
                    for arm,dirname in [('A','source-a'),('B','source-b')]:
                        base=root.parent/dirname
                        if path.is_relative_to(base):
                            name=str(path.relative_to(base))
                            if failed and arm=='A' and name=='src/adc0809.js':raise OSError('FIRST selected source refusal')
                            return arms[arm][name]
                    if path.is_relative_to(root.parent/'workflow-source'):return common[str(path.relative_to(root.parent/'workflow-source'))]
                    return common[str(path.relative_to(root))]
                def read(path,cap):
                    raw=resolve(path);self.assertLessEqual(len(raw),cap);return raw
                def git(checkout,*args):
                    arm='A' if checkout.name=='source-a' else 'B';head=reader.BASE_HEAD if arm=='A' else req['workflowHead'] if checkout.name=='workflow-source' else req['head'];tree=reader.BASE_TREE if arm=='A' else req['tree']
                    if args==('rev-parse','HEAD'):return (head+'\n').encode()
                    if args==('rev-parse','HEAD^{tree}'):return (tree+'\n').encode()
                    if args[:2]==('cat-file','blob'):return resolve(checkout/args[2].split(':',1)[1])
                    raise AssertionError('unexpected Git')
                with mock.patch.dict(producer.os.environ,env,clear=True),mock.patch.object(producer,'read_file',side_effect=read),mock.patch.object(producer,'git',side_effect=git),mock.patch.object(producer.subprocess,'Popen',side_effect=AssertionError('no process')),mock.patch('sys.stdout',new_callable=io.StringIO):
                    if failed:
                        with self.assertRaisesRegex(producer.Refusal,'original retained'):producer.source_admission(request_raw,event_raw,'--admit')
                    else:producer.source_admission(request_raw,event_raw,'--admit')
                receipt=json.loads((output/'source-admission.original.json').read_bytes())
                self.assertEqual(receipt['complete'],not failed);self.assertFalse(receipt['actualApproved']);self.assertLess((output/'source-admission.original.json').stat().st_size,65536);self.assertLess((output/'source-admission-progress.original.jsonl').stat().st_size,32768)
                if failed:
                    self.assertEqual(receipt['firstFailure']['reason'],'FIRST selected source refusal');self.assertEqual(receipt['firstFailure']['lastPath'],'src/adc0809.js');self.assertIn('package.json',receipt['observations']['arms']['A']['files'])
    def test_admission_wrapper_failure_retains_exit_and_bounded_stream_prefixes(self):
        p=fixture()
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            output=Path(directory)/'read16-admission-42-1';output.mkdir();request_path=output/'request.original.json';request_path.write_bytes(p[2]);event_path=output/'event.original.json';event_path.write_bytes(p[3])
            usage=copy.deepcopy(p[0]['children'][0]['usage']);usage.update(exitCode=1,primary=None)
            with mock.patch.dict(producer.os.environ,{'GITHUB_RUN_ID':'42','RUNNER_TEMP':directory},clear=True),mock.patch.object(producer,'capture',return_value=(b'prefix',b'FIRST admit stderr',usage)) as capture:
                with self.assertRaisesRegex(producer.Refusal,'originals retained'):producer.admission_wrapper(request_path,event_path)
            status=json.loads((output/'admit-command.original.json').read_bytes())
            self.assertFalse(status['complete']);self.assertFalse(status['actualApproved']);self.assertEqual(status['usage']['exitCode'],1);self.assertEqual(base64.b64decode(status['stderrBase64']),b'FIRST admit stderr');self.assertEqual(capture.call_args.kwargs['seconds'],120);self.assertEqual(capture.call_args.kwargs['stream_caps'],(8192,8192))

class Pipe:
    def __init__(self,fd):self.fd=fd;self.closed=False
    def fileno(self):return self.fd
    def close(self):self.closed=True
class Selector:
    def __init__(self):self.items={};self.closed=False
    def register(self,pipe,event,data):self.items[pipe.fd]=types.SimpleNamespace(fileobj=pipe,data=data)
    def get_map(self):return self.items
    def select(self,timeout):return [(next(iter(self.items.values())),1)] if self.items else []
    def unregister(self,pipe):self.items.pop(pipe.fd)
    def close(self):self.closed=True
class CaptureControls(unittest.TestCase):
    def run_capture(self,read_chunks=None,selector_error=None,wait_error=None,kill_error=None,clock_step=.01,output_paths=None,own_group=True):
        process=types.SimpleNamespace(pid=123,stdout=Pipe(10),stderr=Pipe(11),returncode=None);selector=Selector();chunks={10:list(read_chunks or [b'ok',b'']),11:[b'']};ticks=[0];wait_calls=[0]
        usage=types.SimpleNamespace(ru_utime=.1,ru_stime=.02,ru_maxrss=1234)
        def read(fd,count):
            value=chunks[fd].pop(0)
            if isinstance(value,BaseException):raise value
            return value
        def wait(pid,options):
            wait_calls[0]+=1
            if wait_error and wait_calls[0]==1:raise wait_error
            return (0,0,None) if wait_calls[0]==1 and clock_step<60 else (123,0,usage)
        def clock():ticks[0]+=clock_step;return ticks[0]
        with mock.patch.object(producer.subprocess,'Popen',return_value=process) as popen,mock.patch.object(producer.selectors,'DefaultSelector',side_effect=selector_error if selector_error else lambda:selector),mock.patch.object(producer.os,'set_blocking'),mock.patch.object(producer.os,'read',side_effect=read),mock.patch.object(producer.os,'wait4',side_effect=wait),mock.patch.object(producer.os,'killpg',side_effect=kill_error) as kill,mock.patch.object(producer.os,'kill',side_effect=kill_error) as kill_pid,mock.patch.object(producer.time,'monotonic',side_effect=clock),mock.patch.object(producer.time,'sleep'):
            result=producer.capture(('inert',),{},lambda:None,output_paths=output_paths,own_group=own_group)
        return result,process,selector,kill if own_group else kill_pid,popen
    def test_positive_capture_reaps_and_closes(self):
        (out,err,u),p,s,kill,popen=self.run_capture()
        self.assertEqual(out,b'ok');self.assertEqual(err,b'');self.assertTrue(u['reaped']);self.assertIsNone(u['primary']);self.assertEqual(u['secondary'],[]);self.assertFalse(kill.called);self.assertTrue(p.stdout.closed and p.stderr.closed and s.closed)
    def test_bounded_prefix_is_written_before_return_on_read_failure(self):
        with tempfile.TemporaryDirectory(dir=HERE) as directory:
            paths=(Path(directory)/'stdout',Path(directory)/'stderr')
            (out,_,u),_,_,_,_=self.run_capture(read_chunks=[b'prefix',OSError('authored read')],output_paths=paths)
            self.assertEqual(out,b'prefix');self.assertEqual(paths[0].read_bytes(),b'prefix');self.assertEqual(paths[1].read_bytes(),b'');self.assertEqual(u['primary']['reason'],'authored read')
    def test_metadata_Git_uses_owned_PID_and_stays_in_admission_group(self):
        (_,_,u),_,_,kill,popen=self.run_capture(read_chunks=[OSError('FIRST metadata read')],own_group=False)
        self.assertTrue(kill.called);self.assertTrue(u['reaped']);self.assertFalse(popen.call_args.kwargs['start_new_session'])
    def test_selector_constructor_failure_kills_and_reaps(self):
        (_,_,u),p,_,kill,_=self.run_capture(selector_error=OSError('authored selector failure'))
        self.assertEqual(u['primary']['reason'],'authored selector failure');self.assertTrue(kill.called);self.assertTrue(u['reaped']);self.assertTrue(p.stdout.closed and p.stderr.closed)
    def test_read_failure_retains_prefix_and_first_error(self):
        (out,_,u),_,_,kill,_=self.run_capture(read_chunks=[b'prefix',OSError('authored read')],kill_error=ProcessLookupError('authored kill'))
        self.assertEqual(out,b'prefix');self.assertEqual(u['primary']['reason'],'authored read');self.assertEqual(u['secondary'][0]['phase'],'kill');self.assertTrue(u['reaped'])
    def test_overflow_keeps_only_bounded_prefix_and_reaps(self):
        (out,_,u),_,_,kill,_=self.run_capture(read_chunks=[b'x'*32769])
        self.assertEqual(len(out),32768);self.assertEqual(u['primary']['reason'],'stream overflow');self.assertTrue(kill.called);self.assertTrue(u['reaped'])
    def test_wait_failure_preserves_primary_and_cleanup_reap(self):
        (_,_,u),_,_,kill,_=self.run_capture(wait_error=OSError('authored wait'))
        self.assertEqual(u['primary']['reason'],'authored wait');self.assertTrue(u['reaped']);self.assertTrue(kill.called)
    def test_timeout_kills_and_reaps(self):
        (_,_,u),_,_,kill,_=self.run_capture(clock_step=61)
        self.assertTrue(u['timedOut']);self.assertEqual(u['primary']['reason'],'child deadline');self.assertTrue(kill.called);self.assertTrue(u['reaped'])
    def test_popen_failure_retains_primary_without_inventing_pid(self):
        with mock.patch.object(producer.subprocess,'Popen',side_effect=OSError('authored spawn')) as popen,mock.patch.object(producer.os,'killpg') as kill:
            stdout,stderr,u=producer.capture(('inert',),{},lambda:None)
        self.assertEqual(stdout,b'');self.assertEqual(stderr,b'');self.assertIsNone(u['pid']);self.assertFalse(u['reaped']);self.assertEqual(u['primary']['reason'],'authored spawn');self.assertFalse(kill.called)
    def test_capture_primary_survives_post_observation_failure(self):
        record={'stderrBase64':'','usage':{'primary':{'type':'OSError','reason':'FIRST stream failure'},'secondary':[{'phase':'kill','type':'OSError','reason':'SECOND kill failure'}],'exitCode':-9,'reaped':True,'timedOut':False}}
        def observe():raise OSError('THIRD cgroup/source failure')
        failure=producer.finish_record(record,observe)
        self.assertEqual(failure['reason'],'FIRST stream failure');self.assertEqual([f['reason'] for f in failure['secondary']],['SECOND kill failure','THIRD cgroup/source failure'])
    def test_disabled_guard_precedes_every_host_factory_in_all_modes(self):
        for args in [('--admit','request','event'),('--admission-wrapper','request','event'),('--capture','request','event'),('--cleanup',)]:
            with self.subTest(mode=args[0]),ExitStack() as stack:
                stack.enter_context(mock.patch.object(producer,'ACTUAL_ENABLED',False))
                stack.enter_context(mock.patch.object(producer.sys,'argv',['run.py',*args]))
                targets=[(producer,n) for n in ('read_file','store','admit_request','admit_sources','source_admission','admission_wrapper','capture','cleanup','git')]
                targets += [(producer.subprocess,n) for n in ('Popen','run')]+[(producer.os,n) for n in ('open','read','kill','killpg','wait4')]+[(producer.Path,'open')]
                spies=[stack.enter_context(mock.patch.object(target,name,side_effect=AssertionError('inactive host operation '+name))) for target,name in targets]
                with self.assertRaisesRegex(producer.Refusal,'disabled'):producer.main()
                for spy in spies:spy.assert_not_called()
    def test_active_missing_or_wrong_request_SHA_refuses_before_host_execution(self):
        p=fixture()
        for selected in (None,'0'*64):
            env={} if selected is None else {'BW_READ16_REQUEST_SHA256':selected}
            with self.subTest(selected=selected),mock.patch.dict(producer.os.environ,env,clear=True),mock.patch.object(producer,'git',side_effect=AssertionError('unexpected Git')) as git,mock.patch.object(producer,'capture',side_effect=AssertionError('unexpected capture')) as capture,mock.patch.object(producer.subprocess,'Popen',side_effect=AssertionError('unexpected Popen')) as popen:
                with self.assertRaisesRegex(producer.Refusal,'request SHA'):producer.admit_request(p[2],p[3])
                git.assert_not_called();capture.assert_not_called();popen.assert_not_called()
    def test_producer_refuses_nested_census(self):
        def text(path):
            if path.name=='cgroup':return '0::/system.slice/bw-read16-paired-42-1.service'
            return {'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','pids.max':'64','cpuset.cpus.effective':'1','cgroup.procs':'999'}[path.name]
        def fields(path):return {'nr_descendants':1,'nr_dying_descendants':0} if path.name=='cgroup.stat' else {'populated':1} if path.name=='cgroup.events' else {'max':0,'oom':0,'oom_kill':0}
        with mock.patch.object(producer,'text',side_effect=text),mock.patch.object(producer,'integer_fields',side_effect=fields),mock.patch.object(producer.os,'sched_getaffinity',return_value={1}):
            with self.assertRaisesRegex(producer.Refusal,'nested'):producer.position('bw-read16-paired-42-1.service',999)

if __name__=='__main__':unittest.main()
