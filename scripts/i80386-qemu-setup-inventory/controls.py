#!/usr/bin/python3
"""Tiny injected controls; every observation is a manufactured object."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import types
import unittest
from unittest import mock
import os
import sys

spec=importlib.util.spec_from_file_location('inventory_run',Path(__file__).with_name('run.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)

class FakeClock:
    def check(self):pass

class FakeOps:
    def __init__(self):
        self.source_bytes={p:p.encode() for p in r.SOURCE5}
        self.data={p:b'abc' for p in r.FILES}
        self.data['/var/lib/dpkg/status']=(b'Package: qemu-system-x86\nArchitecture: amd64\nVersion: 1:8.2.2+ds-0ubuntu1.18\nStatus: install ok installed\nDepends: libc6 (>= 2.38)\nProvides: qemu-system\n\n')
        self.data['/usr/lib/os-release']=b'ID=ubuntu\nVERSION_ID="24.04"\n'
        self.alias={'/etc/os-release':'../usr/lib/os-release','/bin':'usr/bin'}
        self.dirs={'/run/systemd/system'}
        self.absent=set();self.changed=set();self.short=set();self.close_fail=set();self.drift_after=set();self.stat_counts={}
        self.fds={};self.nextfd=10;self.source_calls=0;self.read_calls=0;self.close_calls=0
    def _s(self,path):
        if path in self.absent:raise FileNotFoundError(path)
        mode=stat.S_IFLNK|0o777 if path in self.alias else stat.S_IFDIR|0o755 if path in self.dirs else stat.S_IFREG|0o644
        size=len(self.alias[path]) if path in self.alias else 0 if path in self.dirs else len(self.data[path])
        inode=list(r.FILES).index(path)+100 if path in r.FILES else 1
        if path in self.changed:inode+=1
        return types.SimpleNamespace(st_dev=1,st_ino=inode,st_uid=0,st_gid=0,st_mode=mode,st_nlink=1,st_size=size,st_mtime_ns=1)
    def lstat(self,path):return self._s(path)
    def readlink(self,path):return self.alias[path]
    def open(self,path):
        fd=self.nextfd;self.nextfd+=1;self.fds[fd]=[path,0];return fd
    def fstat(self,fd):
        path=self.fds[fd][0];self.stat_counts[path]=self.stat_counts.get(path,0)+1
        if path in self.drift_after and self.stat_counts[path]>1:self.changed.add(path)
        return self._s(path)
    def read(self,fd,n):
        self.read_calls+=1;path,pos=self.fds[fd]
        if path in self.short:return b''
        data=self.data[path][pos:pos+n];self.fds[fd][1]+=len(data);return data
    def close(self,fd):
        self.close_calls+=1;path,_=self.fds.pop(fd)
        if path in self.close_fail:raise OSError(5,'close')
    def source(self,path):self.source_calls+=1;return self.source_bytes[path]

def fixture():
    ops=FakeOps()
    source={'head':'a'*40,'tree':'b'*40,'files':{p:r.digest(b) for p,b in ops.source_bytes.items()}}
    context={'eventName':'workflow_dispatch','repository':'CrispStrobe/bw-board','job':'qemu-setup-inventory',
             'runAttempt':'1','workflowSha':'c'*40,'workflowRef':'CrispStrobe/bw-board/.github/workflows/i80386-qemu-setup-inventory.yml@refs/heads/main','actor':'CrispStrobe'}
    req={'schema':r.SCHEMA+'request.v1','repository':'CrispStrobe/bw-board','source':source,
         'selection':{'packageVersion':'1:8.2.2+ds-0ubuntu1.18','architecture':'amd64',
                      'controlSha256':dict(r.SELECTION_SHA),'directDependencyNames':sorted(r.DIRECT_DEPS)},
         'context':context,'limits':dict(r.LIMITS)}
    env={'BW_EXPECTED_HEAD':source['head'],'BW_ACTUAL_HEAD':source['head'],
         'BW_EXPECTED_TREE':source['tree'],'BW_ACTUAL_TREE':source['tree'],
         'ImageOS':'ubuntu24','ImageVersion':'20261023','RUNNER_OS':'Linux','RUNNER_ARCH':'X64'}
    env.update({'GITHUB_'+name.upper():str(context[field]) for name,field in ()})
    env.update({'GITHUB_EVENT_NAME':context['eventName'],'GITHUB_REPOSITORY':context['repository'],
        'GITHUB_JOB':context['job'],'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':context['runAttempt'],
        'GITHUB_WORKFLOW_SHA':context['workflowSha'],'GITHUB_WORKFLOW_REF':context['workflowRef'],
        'GITHUB_ACTOR':context['actor']})
    return req,env,ops

class CollectorControls(unittest.TestCase):
    def setUp(self):self.old=r.INVT_ENABLED;r.INVT_ENABLED=True
    def tearDown(self):r.INVT_ENABLED=self.old
    def run_case(self,modify=None):
        req,env,ops=fixture()
        if modify:modify(req,env,ops)
        return r.collect(req,env,ops,FakeClock()),ops
    def test_valid_bounded_original(self):
        out,ops=self.run_case()
        self.assertIsNone(out['failure']);self.assertTrue(all(v is False for v in out['flags'].values()))
        self.assertEqual(out['status']['selected']['qemu-system-x86'][0]['provides'],'qemu-system')
        self.assertEqual(set(out['files']),set(r.FILES));self.assertGreater(ops.read_calls,0)
    def test_guard_before_any_ops(self):
        req,env,ops=fixture();r.INVT_ENABLED=False
        with self.assertRaises(r.Refusal):r.collect(req,env,ops,FakeClock())
        self.assertEqual((ops.source_calls,ops.read_calls), (0,0))
    def test_bad_source_before_files(self):
        req,env,ops=fixture();req['source']['files'][r.SOURCE5[0]]='0'*64
        with self.assertRaises(r.Refusal):r.collect(req,env,ops,FakeClock())
        self.assertEqual(ops.read_calls,0)
    def test_bad_context_before_files(self):
        req,env,ops=fixture();env['GITHUB_JOB']='wrong'
        with self.assertRaises(r.Refusal):r.collect(req,env,ops,FakeClock())
        self.assertEqual(ops.source_calls,0)
    def test_missing_image_refuses(self):
        out,_=self.run_case(lambda q,e,o:e.pop('ImageVersion'))
        self.assertEqual(out['failure']['code'],'missing')
    def test_alias_witness(self):
        out,_=self.run_case()
        self.assertEqual(out['files']['/etc/os-release']['kind'],'alias')
    def test_status_duplicate(self):
        def change(q,e,o):o.data['/var/lib/dpkg/status']*=2
        out,_=self.run_case(change)
        self.assertEqual(out['failure']['code'],'duplicate-package')
    def test_status_bad_utf8(self):
        out,_=self.run_case(lambda q,e,o:o.data.__setitem__('/var/lib/dpkg/status',b'Package: bad\xff\n\n'))
        self.assertEqual(out['failure']['code'],'utf8')
    def test_status_absent_is_partial(self):
        out,_=self.run_case(lambda q,e,o:o.absent.add('/var/lib/dpkg/status'))
        self.assertEqual(out['failure'],{'stage':'status','code':'missing'})
        self.assertIsNone(out['status'])
    def test_status_bad_continuation(self):
        out,_=self.run_case(lambda q,e,o:o.data.__setitem__('/var/lib/dpkg/status',b' bad\n\n'))
        self.assertEqual(out['failure']['code'],'continuation')
    def test_short_read(self):
        out,_=self.run_case(lambda q,e,o:o.short.add('/usr/lib/os-release'))
        self.assertEqual(out['failure']['code'],'short-read')
    def test_close_failure(self):
        out,_=self.run_case(lambda q,e,o:o.close_fail.add('/usr/lib/os-release'))
        self.assertEqual(out['failure']['code'],'close-5')
    def test_readback_drift_partial(self):
        out,_=self.run_case(lambda q,e,o:o.drift_after.add('/usr/lib/os-release'))
        self.assertEqual(out['failure']['code'],'readback-drift')
        part=out['files']['/usr/lib/os-release']['partial']
        self.assertTrue(part['closed']);self.assertGreater(part['bytesRead'],0)
    def test_primary_and_secondary_close(self):
        def change(q,e,o):o.short.add('/usr/lib/os-release');o.close_fail.add('/usr/lib/os-release')
        out,_=self.run_case(change)
        self.assertEqual(out['failure']['code'],'short-read')
        self.assertEqual(out['secondary'][0]['code'],'close-5')
        self.assertFalse(out['files']['/usr/lib/os-release']['partial']['closed'])
    def test_multiarch_retained(self):
        def change(q,e,o):
            o.data['/var/lib/dpkg/status']+=b'Package: qemu-system-x86\nArchitecture: i386\nVersion: 8.2.2\nStatus: install ok installed\n\n'
        out,_=self.run_case(change)
        self.assertEqual([v['architecture'] for v in out['status']['selected']['qemu-system-x86']],['amd64','i386'])
    def test_file_cap(self):
        out,_=self.run_case(lambda q,e,o:o.data.__setitem__('/usr/lib/os-release',b'A'*(r.LIMITS['fileBytes']+1)))
        self.assertEqual(out['failure']['code'],'extent-cap')
    def test_request_extra_field(self):
        req,env,ops=fixture();req['unexpected']=1
        with self.assertRaises(r.Refusal):r.collect(req,env,ops,FakeClock())
        self.assertEqual(ops.source_calls,0)
    def test_external_exact_request_hash(self):
        req,_,_=fixture();raw=r.canonical(req)
        self.assertEqual(r.parse_admitted_request(raw,r.digest(raw)),req)
        with self.assertRaises(r.Refusal):r.parse_admitted_request(raw,'0'*64)
        with self.assertRaises(r.Refusal):r.parse_admitted_request(raw+b'\n',r.digest(raw+b'\n'))
    def test_live_main_guard_before_request_io(self):
        r.INVT_ENABLED=False
        with mock.patch.object(r,'read_admitted_request',side_effect=AssertionError('request was opened')):
            with mock.patch.object(sys,'argv',['run.py','--request','/request','--expected-sha256','0'*64]):
                with self.assertRaises(r.Refusal):r.main()
    def test_bounded_wire_request_once_close(self):
        req,_,ops=fixture();raw=r.canonical(req);ops.data['/request']=raw
        self.assertEqual(r.read_admitted_request('/request',r.digest(raw),ops),req)
        self.assertEqual(ops.close_calls,1)
        ops=FakeOps();ops.data['/request']=raw
        with self.assertRaises(r.Refusal):r.read_admitted_request('/request','0'*64,ops)
        self.assertEqual(ops.close_calls,1)
    def test_request_oversize_refuses_before_open(self):
        _,_,ops=fixture();ops.data['/request']=b'x'*65537
        with self.assertRaises(r.Refusal):r.read_admitted_request('/request','0'*64,ops)
        self.assertEqual(ops.nextfd,10)
    def test_open_flags_nonblock_nofollow(self):
        with mock.patch.object(r.os,'open',return_value=7) as opened:
            self.assertEqual(r.LocalOps().open('/manufactured'),7)
        flags=opened.call_args.args[1]
        self.assertTrue(flags&os.O_NONBLOCK)
        self.assertTrue(flags&os.O_NOFOLLOW)
        self.assertTrue(flags&os.O_CLOEXEC)
    def test_entire_wire_cap_includes_lf(self):
        out,_=self.run_case()
        exact=len(r.canonical(out))+1
        self.assertEqual(len(r.canonical(r.bound_output(copy.deepcopy(out),exact)))+1,exact)
        cut=r.bound_output(copy.deepcopy(out),exact-1)
        self.assertEqual(cut['failure'],{'stage':'output','code':'cap'})
        self.assertIsNone(cut['status'])
        self.assertLessEqual(len(r.canonical(cut))+1,exact-1)
    def test_mock_main_wire_independent_reader(self):
        req,env,ops=fixture()
        req['context']['workflowSha']=req['source']['head']
        env['GITHUB_WORKFLOW_SHA']=req['source']['head']
        request_raw=r.canonical(req)
        ops.data['/owned-request']=request_raw
        capture=io.BytesIO()
        with mock.patch.object(r,'LocalOps',return_value=ops), \
             mock.patch.object(r,'Clock',return_value=FakeClock()), \
             mock.patch.object(r.os,'environ',env), \
             mock.patch.object(r.sys,'stdout',types.SimpleNamespace(buffer=capture)), \
             mock.patch.object(r.sys,'argv',['run.py','--request','/owned-request',
                                             '--expected-sha256',r.digest(request_raw)]):
            self.assertEqual(r.main(),0)
        wire=capture.getvalue()
        self.assertTrue(wire.endswith(b'\n'))
        self.assertEqual(wire.count(b'\n'),1)
        self.assertLessEqual(len(wire),r.LIMITS['outputBytes'])
        spec=importlib.util.spec_from_file_location('inventory_reader',Path(__file__).with_name('reader.py'))
        reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
        context=req['context']
        official={'repository':req['repository'],'head':req['source']['head'],
            'tree':req['source']['tree'],'workflowSha':context['workflowSha'],
            'workflowRef':context['workflowRef'],'runId':env['GITHUB_RUN_ID'],
            'runAttempt':context['runAttempt'],'jobId':'456','jobName':context['job'],
            'eventName':context['eventName'],'actor':context['actor'],'conclusion':'success'}
        expectation={'schema':r.SCHEMA+'expectation.v1','requestSha256':r.digest(request_raw),
                     'source':req['source'],'official':official}
        verdict=reader.audit(request_raw,wire,r.canonical(expectation))
        self.assertTrue(verdict['reportedComplete'])
        self.assertEqual(verdict['observedFileCount'],len(r.FILES))
        self.assertFalse(any(verdict[name] for name in r.FLAGS))
        self.assertFalse(verdict['officialJobAuthenticated'])


# This closed source-policy check reads only the repository workflow text. It
# neither dispatches Actions nor invokes the disabled collector.
def workflow_contract(raw):
    if type(raw) is not bytes or len(raw)>16384:
        raise AssertionError('workflow size')
    value=raw.decode('utf-8')
    marker='\n  qemu-setup-inventory:\n'
    if value.count(marker)!=1:raise AssertionError('one metadata job')
    job=value.split(marker,1)[1]
    guard_start='    if: >-\n';guard_end='    runs-on: ubuntu-24.04\n'
    if not job.startswith(guard_start) or guard_end not in job:raise AssertionError('metadata guard')
    guard=' '.join(job[len(guard_start):job.index(guard_end)].split())
    expected="${{ false && github.event_name == 'workflow_dispatch' && github.repository == 'CrispStrobe/bw-board' && github.actor == 'CrispStrobe' && github.run_attempt == 1 && github.event.repository.fork == false }}"
    if guard!=expected:raise AssertionError('literal false closed guard')
    required=('timeout-minutes: 5','ref: ${{ inputs.expected_head }}',
      'persist-credentials: false','assert base64.b64encode(raw).decode() == encoded',
      "assert hashlib.sha256(raw).hexdigest() == digest",
      "assert request['source']['head'] == head",
      "assert env['GITHUB_SHA'] == head == env['GITHUB_WORKFLOW_SHA']",
      "assert actual_head == head and actual_tree == tree",
      "assert observe('status', '--porcelain') == b''",
      'timeout-minutes: 2',
      '/usr/bin/python3 -I -S -B scripts/i80386-qemu-setup-inventory/run.py',
      '--request "$BW_REQUEST_FILE" --expected-sha256 "$BW_REQUEST_SHA256"',
      "if: ${{ always() && steps.seed.outcome == 'success' }}",
      'name: i80386-qemu-setup-input-${{ github.run_id }}-${{ github.run_attempt }}',
      'path: ${{ steps.seed.outputs.originals }}')
    if any(item not in job for item in required):raise AssertionError('metadata source policy')
    steps=('Check out admitted source','Admit immutable request and exact source',
           'Observe setup inputs without executing tools','Retain setup-input original')
    positions=[job.find('- name: '+name) for name in steps]
    if any(p<0 for p in positions) or positions!=sorted(positions):raise AssertionError('step order')
    if 'setup-node' in job or job.count('/usr/bin/python3 -I -S -B')!=2:
        raise AssertionError('unexpected metadata runtime')
    seed=job[positions[1]:positions[2]]
    indices=[seed.find(x) for x in ("assert hashlib.sha256(raw).hexdigest() == digest",
       "assert request['source']['head'] == head",
       "assert actual_head == head and actual_tree == tree",
       "root = pathlib.Path(tempfile.mkdtemp(")]
    if any(i<0 for i in indices) or indices!=sorted(indices):raise AssertionError('admission order')
    if "if: ${{ github.event_name != 'workflow_dispatch' }}" not in value.split(marker,1)[0]:
        raise AssertionError('controls event split')

class WorkflowPolicyControls(unittest.TestCase):
    def test_disabled_metadata_workflow_and_cuts(self):
        path=Path(__file__).parents[2]/'.github/workflows/i80386-qemu-setup-inventory.yml'
        raw=path.read_bytes();workflow_contract(raw)
        value=raw.decode()
        cuts=(
          ('${{ false && github.event_name','${{ true && github.event_name'),
          ("false && github.event_name == 'workflow_dispatch'", "false || github.event_name == 'workflow_dispatch'"),
          ('github.event.repository.fork == false','github.event.repository.fork == true'),
          ('github.run_attempt == 1','github.run_attempt == 2'),
          ('ref: ${{ inputs.expected_head }}','ref: ${{ github.ref }}'),
          ('assert hashlib.sha256(raw).hexdigest() == digest','assert raw'),
          ('assert actual_head == head and actual_tree == tree','assert actual_head == head'),
          ('--expected-sha256 "$BW_REQUEST_SHA256"','--unknown-sha256 "$BW_REQUEST_SHA256"'),
          ("always() && steps.seed.outcome == 'success'",'always()'),
          ('i80386-qemu-setup-input-${{ github.run_id }}-${{ github.run_attempt }}','i80386-qemu-setup-input'),
          ('timeout-minutes: 2','timeout-minutes: 5'),
          ('/usr/bin/python3 -I -S -B scripts/i80386-qemu-setup-inventory/run.py','/usr/bin/python3 -B scripts/i80386-qemu-setup-inventory/run.py'),
          ('      - name: Admit immutable request and exact source','      - uses: actions/setup-node@unreviewed\n      - name: Admit immutable request and exact source'),
        )
        for old,new in cuts:
            self.assertIn(old,value)
            changed=value.replace(old,new,1)
            with self.subTest(cut=old):
                with self.assertRaises(AssertionError):workflow_contract(changed.encode())

if __name__=='__main__':unittest.main()
