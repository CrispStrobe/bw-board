import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const auditor = resolve(root, 'scripts/i80386-bochs-ring3-reference/read-elf-negative-v1.py');
const historical = resolve(root, 'scripts/i80386-bochs-ring3-reference/reader.py');
const controls = resolve(root, 'scripts/i80386-bochs-ring3-reference/controls.py');
// Public owned-source metadata only. No actual packet, log, trace or host input.
// It lets shallow CI checkouts manufacture the exact historical source context.
const sourceRows = JSON.parse(String.raw`{".github/workflows/i80386-bochs-ring3-reference.yml":{"bytes":53624,"gitBlob":"c670d8cfb3bf56e9a4822c8b3fa37b2c3eb500da","mode":"100644","sha256":"4a9351ae0436f1c0142d277508c9b179fa00a5d5c94e0e277a24078a31f555ba"},"LICENSE":{"bytes":1068,"gitBlob":"64556deb596b2bf990bd248108a0dce64eeb88bd","mode":"100644","sha256":"e53c4e17a0971ca6cac5010a19876b77a896e3ce172b1f61d934dfd14c595d6d"},"package-lock.json":{"bytes":1648,"gitBlob":"5890920443612bb7df5966b23b5e4fcec412e644","mode":"100644","sha256":"6eabf7e529e6cf7efeaa28034d5bb24f66db09a1ebbcbd202e0a45564850b764"},"package.json":{"bytes":2969,"gitBlob":"d68f8e2855c784f53a4e9319805027bf80c9ebd4","mode":"100644","sha256":"ff91e0e077c6e39cea49f5c1f07219637fee72f206a670649178a6a09d5e3e8c"},"scripts/i80386-bochs-ring3-reference/README.md":{"bytes":11350,"gitBlob":"10fad6c06571ccd2142ababe98422859809632de","mode":"100644","sha256":"b5eff4ba3df5f732822eb556d0e95dd1890f0292f00fe9614e426d39a67297b0"},"scripts/i80386-bochs-ring3-reference/controls.py":{"bytes":339546,"gitBlob":"fa0a770f04f6b83245df75e1094c7f23136c4a3e","mode":"100644","sha256":"e46e6ca6d623f714d45b949501464de26d16de751f6f75e2ffcb5c1ee91d1668"},"scripts/i80386-bochs-ring3-reference/reader.py":{"bytes":612057,"gitBlob":"7e0ff5281a08eb878d934ef3570cd51a62011bc6","mode":"100644","sha256":"01380f820b59a4a3140e6fe73a81c6b79ee949f58b27ab1a891767e8c3b35660"},"scripts/i80386-bochs-ring3-reference/run.py":{"bytes":475569,"gitBlob":"cf9db4ec2ff5a5affc8c274e33391b25fa3540ba","mode":"100644","sha256":"769dd751fe349b6bd36a3dedbb48b008316bfab13f6f9557a4c13d32485fe3c9"},"scripts/i80386-ring3-int-iret/fixture.mjs":{"bytes":7854,"gitBlob":"cabaedc63e92343976217b9a9fd8292c5aa3d0c9","mode":"100644","sha256":"921eac8c27015d4d0c6ee263aa844e598fcf45c35baf120d1025dbf4910bec71"},"scripts/i80386-ring3-int-iret/probe.mjs":{"bytes":10645,"gitBlob":"76f837b2133480a4c37b8363edb5981452c1d834","mode":"100644","sha256":"9dbb6a44328337c197f2d0ac5010b2b2062c6430aa5daa1bafae167735ec9cc1"},"src/experimental/i80386.js":{"bytes":238802,"gitBlob":"a4d1483ec97153268aa82f2b2eb2ed5178313eef","mode":"100644","sha256":"65041c0b0e3ca6f60dcaa99516178c2935f885cb4f8df616270f4a81e31cf483"},"test/i80386-bochs-ring3-reference.test.mjs":{"bytes":13809,"gitBlob":"bf3a2e67399c6866c01a26494f0a69221849ae02","mode":"100644","sha256":"0042cb40b77822820bc6fed078287cbcc576da1a0fe14729da088a95899d215f"}}`);

test('negative auditor import performs no input, network or process operation', () => {
  const program = String.raw`import builtins,os,socket,subprocess,sys,types
from pathlib import Path
from unittest import mock
raw=Path(sys.argv[1]).read_bytes()
namespace={'__file__':sys.argv[1],'__name__':'import_only_negative_auditor'}
with mock.patch.object(builtins,'open',side_effect=AssertionError('input on import')) as opened, \
     mock.patch.object(os,'open',side_effect=AssertionError('FD on import')) as fds, \
     mock.patch.object(socket,'socket',side_effect=AssertionError('network on import')) as network, \
     mock.patch.object(subprocess,'Popen',side_effect=AssertionError('process on import')) as process:
    exec(compile(raw,sys.argv[1],'exec'),namespace)
opened.assert_not_called();fds.assert_not_called();network.assert_not_called();process.assert_not_called()
assert 'bochs_reference_producer_controls' not in sys.modules
print('import has no input/network/process effects')
`;
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', program, auditor],
    {cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1 << 16});
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
});

test('genuine manufactured negative packets and coherent profile/source/ZIP cuts', () => {
  const program = String.raw`import base64,contextlib,copy,hashlib,importlib.util,io,json,os,socket,stat,struct,subprocess,sys,tempfile,types,unittest,zipfile
from pathlib import Path
from unittest import mock
AUDITOR,OLD,CONTROLS=map(Path,sys.argv[1:4]);SOURCE_ROWS=json.loads(sys.argv[4])
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
a=module('new_negative_auditor',AUDITOR)
c=module('existing_mock_edges_controls',CONTROLS);p=c.producer
old_raw=OLD.read_bytes();old=a.load_old(old_raw)
assert a.sha(old_raw)==a.OLD_READER_SHA
assert a.sha(a.wire(SOURCE_ROWS))==a.OLD_SOURCE_FILES_SHA
BASE_REQUEST=c.synthetic_request
def selected_request(route):
    request,raw,event,env=BASE_REQUEST(route)
    request['source']={'head':a.OLD_HEAD,'tree':a.OLD_TREE,'files':copy.deepcopy(SOURCE_ROWS)}
    request['pullRequest']=699
    event=json.loads(event);event['number']=699;event['pull_request']['number']=699
    event['pull_request']['head']['sha']=a.OLD_HEAD
    env['BW_EXPECTED_HEAD']=a.OLD_HEAD;env['GITHUB_WORKFLOW_SHA']=a.OLD_WORKFLOW
    env['GITHUB_WORKFLOW_REF']=p.REPOSITORY+'/'+p.WORKFLOW+'@refs/pull/699/merge'
    return request,p.canonical(request),p.canonical(event),env
def stat_text(root):
    values={key:0 for key in a.STAT_KEYS};values['nr_descendants']=1 if root else 0
    for key in ('cpu','memory','perf_event','pids'):values['nr_subsys_'+key]=2 if root else 1
    if root:
        for key in ('cpuset','io'):values['nr_subsys_'+key]=1
    return ''.join(key+' '+str(values[key])+'\n' for key in a.STAT_KEYS)
def fixture(tags):
    # The unchanged fixture first builds an ordinary synthetic packet. Its
    # provider is then reused with only the OS resource read edge changed, and
    # the genuine collector/finalizer run again with all22 rows from the start.
    with mock.patch.object(c,'synthetic_request',selected_request):
        request,raw,event,env,edges,_,_,prior=c.elf_attribution_sample(tag_values=tags)
    original_resources=edges.resources
    def observed_resources(route):
        value=original_resources(route)
        value['unitRoot']['files']['cgroup.stat']=stat_text(True)
        value['controller']['files']['cgroup.stat']=stat_text(False)
        return value
    edges.resources=observed_resources
    inner,roles=p.collect_elf_attribution(raw,event,env,edges)
    paths=p.route_paths(p.ELF_ROUTE,env)
    context={'env':env,'sourceRoot':'/mock/source','invoker':{'uid':1001,'gid':1001},'bootstrapCredentials':c.bootstrap_v2()}
    status=prior['service-status.original.json']
    with mock.patch.object(p,'ELF_ATTRIBUTION_ENABLED',True),mock.patch.object(p,'sealed_write'), \
         mock.patch.object(p,'retained_output_roles',return_value=copy.deepcopy(roles)), \
         mock.patch.object(p,'read_regular',return_value=(status,{})),mock.patch.object(p,'write_work_roles'):
        outside,roles=p.finish_cli(p.ELF_ROUTE,context,raw,event,paths,provider_factory=lambda *_:edges,
            service_status=paths['work']/'service-status.original.json',current=True)
    assert len(roles)==12
    assert json.loads(roles['original.json'])['resources']['before']['unitRoot']['files']['cgroup.stat']==stat_text(True)
    return roles
class NonSeek(io.BytesIO):
    def seekable(self):return False
    def seek(self,*args):raise io.UnsupportedOperation('streamed upload fixture')
def upload_zip(packet):
    stream=NonSeek()
    with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,body in sorted(packet.items()):
            row=zipfile.ZipInfo(name,(1980,1,1,0,0,0));row.create_system=3;row.create_version=45;row.extract_version=20
            row.compress_type=zipfile.ZIP_DEFLATED;row.external_attr=0o100444<<16
            archive.writestr(row,body)
    return stream.getvalue()
def refresh(packet):
    packet=copy.deepcopy(packet);packet['manifest.json']=p.canonical(p.elf_attribution_manifest(packet));return packet
def bundle(packet,alter=None,archive_alter=None,code_path=AUDITOR):
    archive=upload_zip(packet)
    if archive_alter:archive=archive_alter(archive)
    _,expected_raw,run,jobs,artifacts,log=c.elf_official_fixture(packet)
    expected=json.loads(expected_raw)
    expected.update(archiveBytes=len(archive),archiveSha256=a.sha(archive))
    artifacts['artifacts'][0].update(size_in_bytes=len(archive),digest='sha256:'+a.sha(archive))
    if alter:alter(expected,run,jobs,artifacts)
    original=json.loads(packet['request.original.json']);before=json.loads(packet['source.before.json'])
    contents={'archive':archive,'expectation':a.wire(expected),'run':a.wire(run),'jobs':a.wire(jobs),
        'artifacts':a.wire(artifacts),'jobLog':log,'originalFailure':b'sha_pinned_historical_bochs_reader.Refusal: finite delegated cgroup stat rows\n'}
    code=code_path.read_bytes()
    policy={'schema':'bw.bochs-ring3.elf-negative-review.v1','profile':a.PROFILE,'negativeOnly':True,
        'auditor':{'commit':'7'*40,'tree':'8'*40,'path':a.AUDITOR_PATH,'mode':'100644',
            'gitBlob':hashlib.sha1(b'blob '+str(len(code)).encode()+b'\0'+code).hexdigest(),'bytes':len(code),'sha256':a.sha(code)},
        'original':{'head':original['source']['head'],'tree':original['source']['tree'],
            'workflowCommit':before['workflowCommit'],'workflowTree':before['workflowTree'],
            'workflowFileSha256':before['workflowFileSha256'],'sourceFilesSha256':a.sha(a.wire(original['source']['files'])),
            'oldReaderSha256':a.OLD_READER_SHA,'requestSha256':a.sha(packet['request.original.json']),
            'eventSha256':a.sha(packet['event.original.json']),'manifestSha256':a.sha(packet['manifest.json']),
            'sourceBeforeSha256':a.sha(packet['source.before.json']),'sourceAfterSha256':a.sha(packet['source.after.json']),
            'refusal':a.OLD_REFUSAL},
        'inputs':{role:{'bytes':len(body),'sha256':a.sha(body)} for role,body in contents.items()}}
    return contents,policy
def invoke(contents,policy,*,reader=OLD,auditor=a):
    with tempfile.TemporaryDirectory(prefix='bochs-negative-synthetic-') as temp:
        root=Path(temp);paths={}
        for role,body in contents.items():
            path=root/role;path.write_bytes(body);paths[role]=str(path)
        policy_raw=a.wire(policy);path=root/'policy';path.write_bytes(policy_raw)
        argv=['--policy',str(path),'--policy-sha256',a.sha(policy_raw),'--auditor-commit',policy['auditor']['commit'],
            '--auditor-tree',policy['auditor']['tree'],'--old-reader',str(reader)]
        flags={'archive':'archive','expectation':'expectation','run':'run','jobs':'jobs','artifacts':'artifacts','jobLog':'job-log','originalFailure':'original-failure'}
        for role,flag in flags.items():argv+=['--'+flag,paths[role]]
        stdout=io.StringIO();stderr=io.StringIO()
        with contextlib.redirect_stdout(stdout),contextlib.redirect_stderr(stderr):code=auditor.main(argv)
        report=json.loads((stdout if code==0 else stderr).getvalue())
        assert all(report[flag] is False for flag in a.FALSE_FLAGS)
        return code,report
def change_inner(packet,callback):
    packet=copy.deepcopy(packet);inner=json.loads(packet['original.json']);callback(inner)
    packet['original.json']=p.canonical(inner);return refresh(packet)
def hidden_local(raw):
    value=bytearray(raw);eocd=len(value)-22;central=struct.unpack_from('<I',value,eocd+16)[0]
    name=b'unindexed.original';header=struct.pack('<IHHHHHIIIHH',0x04034b50,20,0,0,0,0,0,0,0,len(name),0)+name
    value[central:central]=header;struct.pack_into('<I',value,len(value)-22+16,central+len(header));return bytes(value)
def unused_deflate(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:infos=archive.infolist()
    first=infos[0];name_len=struct.unpack_from('<H',raw,26)[0];at=30+name_len+first.compress_size
    value=bytearray(raw);value[at:at]=b'UNUSED!!';central=struct.unpack_from('<I',value,len(value)-22+16)[0]+8
    struct.pack_into('<I',value,len(value)-22+16,central)
    struct.pack_into('<I',value,at+8+8,first.compress_size+8)
    cursor=central
    for index,info in enumerate(infos):
        if index==0:struct.pack_into('<I',value,cursor+20,info.compress_size+8)
        else:struct.pack_into('<I',value,cursor+42,info.header_offset+8)
        size=struct.unpack_from('<H',value,cursor+28)[0];cursor+=46+size
    return bytes(value)
def symlink_role(raw):
    value=bytearray(raw);central=struct.unpack_from('<I',value,len(value)-22+16)[0]
    struct.pack_into('<I',value,central+38,0o120444<<16);return bytes(value)
class NegativeControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.packet=fixture({'runpath':'/fixture/libU'})
    def refuses(self,packet,**kwargs):
        code,report=invoke(*bundle(packet,**kwargs));self.assertEqual(code,1,report)
        self.assertEqual(report['classification'],'original-refused/structural-incomplete')
        return report
    def test_genuine_collector_finalizer_old_refusal_and_negative_cli(self):
        contents,policy=bundle(self.packet)
        with self.assertRaisesRegex(old.Refusal,'finite delegated cgroup stat rows'):
            old.elf_attribution_official(contents['archive'],contents['expectation'],json.loads(contents['run']),
                json.loads(contents['jobs']),json.loads(contents['artifacts']),contents['jobLog'])
        first=old.resources_v2_fact
        with mock.patch.object(socket,'socket',side_effect=AssertionError('network during audit')) as network, \
             mock.patch.object(subprocess,'Popen',side_effect=AssertionError('process during audit')) as process:
            code,report=invoke(contents,policy)
        network.assert_not_called();process.assert_not_called();self.assertEqual(code,0,report)
        self.assertEqual(report['classification'],'original-refused/structural-attributed')
        self.assertIs(report['originalGradeRefused'],True);self.assertIs(report['officialMetadataBound'],True)
        self.assertEqual(report['triggerPath'],'/usr/libexec/gcc/x86_64-linux-gnu/13/cc1')
        self.assertEqual(report['tags']['runpath'],{'tag':29,'state':'present','entryOffset':288,'stringOffset':512,
            'stringBytes':len('/fixture/libU'),'terminatorOffset':512+len('/fixture/libU'),'value':'/fixture/libU'})
        self.assertIs(report['reportedWholeFile']['independentlyRehashedFromSparseRanges'],False)
        self.assertIs(old.resources_v2_fact,first)
    def test_tag_variants_remain_strict_negative_only(self):
        for tags in ({'rpath':'/fixture/R'},{'rpath':'/fixture/R','runpath':'/fixture/U'},{'rpath':''}):
            code,report=invoke(*bundle(fixture(tags)))
            with self.subTest(tags=tags):self.assertEqual(code,0,report)
        self.refuses(fixture({}))
    def test_exact_roster_and_separate_event_grammar(self):
        for kind in ('missing','extra','duplicate','reorder','unicode','signed','boolean','noncanonical','overflow','oversize','event-swap','bad-event'):
            def modify(inner):
                files=inner['resources']['before']['unitRoot']['files'];lines=files['cgroup.stat'].splitlines(True)
                if kind=='missing':lines.pop(10)
                elif kind=='extra':lines.append('nr_unknown 0\n')
                elif kind=='duplicate':lines[-1]=lines[0]
                elif kind=='reorder':lines[1],lines[2]=lines[2],lines[1]
                elif kind=='unicode':lines[1]='nr_subsys_cpu \u0661\n'
                elif kind=='signed':lines[1]='nr_subsys_cpuset -1\n'
                elif kind=='boolean':lines[1]='nr_subsys_cpuset true\n'
                elif kind=='noncanonical':lines[1]='nr_subsys_cpuset 01\n'
                elif kind=='overflow':lines[1]='nr_subsys_cpuset 18446744073709551616\n'
                elif kind=='oversize':lines[1]='nr_subsys_cpuset '+'1'*4096+'\n'
                elif kind=='event-swap':files['cgroup.events']=files['cgroup.stat']
                else:files['cgroup.events']='populated 1\nfrozen 2\n'
                files['cgroup.stat']=''.join(lines)
            with self.subTest(kind=kind):self.refuses(change_inner(self.packet,modify))
    def test_subsystem_snapshots_are_not_sum_or_equality_invariants(self):
        def modify(inner):
            files=inner['resources']['after']['unitRoot']['files']
            files['cgroup.stat']=files['cgroup.stat'].replace('nr_subsys_cpu 2\n','nr_subsys_cpu 7\n').replace('nr_dying_subsys_cpu 0\n','nr_dying_subsys_cpu 1\n')
        code,report=invoke(*bundle(change_inner(self.packet,modify)));self.assertEqual(code,0,report)
    def test_observed_resource_identity_membership_and_limits(self):
        for kind in ('path','inode','controller-inode','limit','procs','pid','uid-bool','child'):
            def modify(inner):
                row=inner['resources']['before']
                if kind=='path':row['unitRoot']['path']+='/foreign'
                elif kind=='inode':row['unitRoot']['directory']['ino']+=1;row['parentControl']['unitIdentity']['ino']+=1
                elif kind=='controller-inode':row['controller']['directory']['ino']+=1;row['parentControl']['controllerIdentity']['ino']+=1
                elif kind=='limit':row['unitRoot']['files']['memory.max']='536870913\n'
                elif kind=='procs':row['controller']['files']['cgroup.procs']='101\n'
                elif kind=='pid':row['pid']+=1
                elif kind=='uid-bool':row['uid']=False
                else:row['unitRoot']['children'].append('make')
            with self.subTest(kind=kind):self.refuses(change_inner(self.packet,modify))
    def test_historical_source_and_request_row_are_external_before_module_exec(self):
        for kind in ('workflow','head','reader-row','request-pr'):
            packet=copy.deepcopy(self.packet)
            if kind=='workflow':
                for name in ('source.before.json','source.after.json'):
                    value=json.loads(packet[name]);value['workflowCommit']='9'*40;packet[name]=p.canonical(value)
            else:
                value=json.loads(packet['request.original.json'])
                if kind=='head':value['source']['head']='9'*40
                elif kind=='request-pr':value['pullRequest']=700
                else:value['source']['files'][a.OLD_READER_PATH]['sha256']='9'*64
                packet['request.original.json']=p.canonical(value)
            packet=refresh(packet)
            with self.subTest(kind=kind),mock.patch.object(a,'load_old',wraps=a.load_old) as loaded:
                self.refuses(packet);loaded.assert_not_called()
        contents,policy=bundle(self.packet)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'wrong-reader';path.write_bytes(old_raw+b'\n')
            code,_=invoke(contents,policy,reader=path);self.assertEqual(code,1)
    def test_new_auditor_identity_manifest_and_original_failure_binding(self):
        for kind in ('new-code-sha','new-code-blob','new-mode','manifest-sha','failure-tail'):
            contents,policy=bundle(self.packet)
            if kind=='new-code-sha':policy['auditor']['sha256']='0'*64
            elif kind=='new-code-blob':policy['auditor']['gitBlob']='0'*40
            elif kind=='new-mode':policy['auditor']['mode']='100755'
            elif kind=='manifest-sha':policy['original']['manifestSha256']='0'*64
            else:
                contents['originalFailure']+=b'ValueError: a later different failure\n'
                policy['inputs']['originalFailure']={'bytes':len(contents['originalFailure']),'sha256':a.sha(contents['originalFailure'])}
            with self.subTest(kind=kind):
                code,report=invoke(contents,policy);self.assertEqual(code,1,report)
    def test_full_official_metadata_and_typed_raw_step_cuts(self):
        for kind in ('missing-job','extra-job','inactive-failure','attempt-bool','step-bool','step-float','step-reorder','other-step-failure','foreign-repo','foreign-pr','artifact-repo','artifact-digest'):
            def change(expected,run,jobs,artifacts):
                if kind=='missing-job':jobs['jobs'].pop();jobs['total_count']-=1
                elif kind=='extra-job':jobs['jobs'].append({**jobs['jobs'][0],'id':999});jobs['total_count']+=1
                elif kind=='inactive-failure':jobs['jobs'][0]['conclusion']='failure'
                elif kind=='attempt-bool':jobs['jobs'][0]['run_attempt']=True
                elif kind.startswith('step-') or kind=='other-step-failure':
                    steps=jobs['jobs'][3]['steps']
                    if kind=='step-bool':steps[0]['number']=True
                    elif kind=='step-float':steps[0]['number']=1.0
                    elif kind=='step-reorder':steps[1],steps[2]=steps[2],steps[1]
                    else:steps[0]['conclusion']='failure'
                    expected['steps']=copy.deepcopy(steps)
                elif kind=='foreign-repo':run['repository']['full_name']=run['head_repository']['full_name']='other/bw-board'
                elif kind=='foreign-pr':run['pull_requests'][0]['number']=700
                elif kind=='artifact-repo':artifacts['artifacts'][0]['workflow_run']['repository_id']+=1
                else:artifacts['artifacts'][0]['digest']='sha256:'+'0'*64
            with self.subTest(kind=kind):self.refuses(self.packet,alter=change)
        contents,policy=bundle(self.packet);contents['jobLog']+=b' unadmitted substitution'
        code,_=invoke(contents,policy);self.assertEqual(code,1)
    def test_sparse_bytes_tags_and_reported_whole_file_limit(self):
        for kind in ('tag','range'):
            def mutate(value):
                row=value['records'][-1]
                if kind=='tag':row['tags']['runpath']['value']='/invented/path'
                else:
                    item=row['ranges'][0];data=bytearray(base64.b64decode(item['base64']));data[0]^=1
                    item['base64']=base64.b64encode(data).decode();item['sha256']=a.sha(data)
            with self.subTest(kind=kind):self.refuses(c.elf_refresh_attribution(self.packet,mutate))
        packet=c.elf_refresh_attribution(self.packet,lambda value:value['records'][-1]['read'].update(sha256='9'*64))
        code,report=invoke(*bundle(packet));self.assertEqual(code,0,report)
        self.assertEqual(report['reportedWholeFile']['sha256'],'9'*64)
        self.assertIs(report['reportedWholeFile']['independentlyRehashedFromSparseRanges'],False)
    def test_zip_complete_geometry_and_compressed_span_counterexamples(self):
        for change in (hidden_local,unused_deflate):
            value=change(upload_zip(self.packet))
            decoded,_=old.archive_members(value,old.INVENTORY_CAPS,allowed=old.ELF_ROLES)
            self.assertEqual(decoded,self.packet)  # old ZIP decoder ignores these physical additions
            self.refuses(self.packet,archive_alter=change)
        self.refuses(self.packet,archive_alter=symlink_role)
        self.refuses(self.packet,archive_alter=lambda raw:raw+b'trailing')
        broken=copy.deepcopy(self.packet);broken.pop('source.after.json')
        contents,policy=bundle(self.packet)
        contents['archive']=upload_zip(broken)
        expected=json.loads(contents['expectation']);expected.update(archiveBytes=len(contents['archive']),archiveSha256=a.sha(contents['archive']))
        artifacts=json.loads(contents['artifacts']);artifacts['artifacts'][0].update(size_in_bytes=len(contents['archive']),digest='sha256:'+a.sha(contents['archive']))
        contents['expectation']=a.wire(expected);contents['artifacts']=a.wire(artifacts)
        for role in ('archive','expectation','artifacts'):
            policy['inputs'][role]={'bytes':len(contents[role]),'sha256':a.sha(contents[role])}
        code,report=invoke(contents,policy);self.assertEqual(code,1,report)
    def test_profile_guard_removal_counterfactual_does_not_change_old_reader(self):
        packet=change_inner(self.packet,lambda inner:inner['resources']['before']['unitRoot']['files'].update(
            {'cgroup.stat':inner['resources']['before']['unitRoot']['files']['cgroup.stat'].replace('nr_subsys_dmem 0\n','')}))
        self.refuses(packet)
        raw=AUDITOR.read_text();needle="need(tuple(rows) == STAT_KEYS, 'exact observed 22-key stat roster')"
        self.assertEqual(raw.count(needle),1)
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'private-mutant.py';path.write_text(raw.replace(needle,"need(True, 'exact observed 22-key stat roster')"))
            mutant=module('private_guard_removal',path)
            code,report=invoke(*bundle(packet,code_path=path),auditor=mutant)
            self.assertEqual(code,0,report)
        self.assertEqual(a.sha(OLD.read_bytes()),a.OLD_READER_SHA)
    def test_local_file_first_secondary_close_and_symlink_caps(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'regular';path.write_bytes(b'bounded DATA')
            link=Path(temp)/'alias';link.symlink_to(path)
            with self.assertRaises(a.ReadFailure):a.read_local(link,32,'input',[0])
            with self.assertRaises(a.ReadFailure):a.read_local(path,1,'input',[0])
            close=os.close
            def closing(fd):close(fd);raise OSError(9,'secondary-close')
            with mock.patch.object(a.os,'read',side_effect=OSError(5,'first-read-private-path')),mock.patch.object(a.os,'close',side_effect=closing):
                with self.assertRaises(a.ReadFailure) as held:a.read_local(path,32,'input',[0])
            self.assertEqual(held.exception.first['errno'],5)
            self.assertEqual([e['errno'] for e in held.exception.secondary],[9])
            self.assertNotIn('private-path',held.exception.first['message'])
            with mock.patch.object(a.os,'close',side_effect=closing):
                with self.assertRaises(a.ReadFailure) as held:a.read_local(path,32,'input',[0])
            self.assertEqual(held.exception.first['errno'],9);self.assertEqual(held.exception.secondary,[])
unittest.main(argv=['negative-reader-controls'],verbosity=1)
`;
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', program, auditor, historical,
    controls, JSON.stringify(sourceRows)], {cwd: root, encoding: 'utf8', timeout: 60_000,
    maxBuffer: 2 << 20, env: {...process.env, PYTHONDONTWRITEBYTECODE: '1'}});
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /Ran 12 tests/);
  assert.match(result.stdout + result.stderr, /OK/);
});
