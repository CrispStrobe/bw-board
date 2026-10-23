#!/usr/bin/python3
"""Disabled, read-only QEMU setup-input inventory. No process execution."""
import base64
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import time
import zlib

INVT_ENABLED = False
ROOT = Path(__file__).parents[2]
SCHEMA = 'bw.i80386-qemu-setup-inventory-'
SOURCE5 = (
    'scripts/i80386-qemu-setup-inventory/run.py',
    'scripts/i80386-qemu-setup-inventory/reader.py',
    'scripts/i80386-qemu-setup-inventory/controls.py',
    'scripts/i80386-qemu-setup-inventory/README.md',
    '.github/workflows/i80386-qemu-setup-inventory.yml',
)
FILES = (
    '/usr/lib/os-release', '/etc/os-release', '/var/lib/dpkg/status',
    '/bin', '/bin/sh', '/usr/bin/sh', '/usr/bin/dash',
    '/usr/bin/deb-systemd-helper', '/usr/bin/deb-systemd-invoke',
    '/usr/bin/dpkg-maintscript-helper', '/usr/bin/systemctl',
    '/usr/sbin/invoke-rc.d', '/usr/sbin/update-rc.d',
    '/usr/sbin/policy-rc.d', '/run/systemd/system',
    '/var/lib/dpkg/info/dpkg.list',
    '/var/lib/dpkg/info/init-system-helpers.list',
    '/var/lib/dpkg/info/systemd.list',
    '/var/lib/dpkg/info/dash.list',
    '/usr/lib/systemd/system/qemu-kvm.service',
    '/lib/systemd/system/qemu-kvm.service', '/etc/init.d/qemu-kvm',
)
TEXT_FILES = frozenset(('/usr/lib/os-release','/etc/os-release','/var/lib/dpkg/status',
    '/usr/bin/deb-systemd-helper','/usr/bin/deb-systemd-invoke',
    '/usr/bin/dpkg-maintscript-helper','/usr/sbin/invoke-rc.d',
    '/usr/sbin/update-rc.d','/usr/sbin/policy-rc.d',
    '/var/lib/dpkg/info/dpkg.list',
    '/var/lib/dpkg/info/init-system-helpers.list',
    '/var/lib/dpkg/info/systemd.list',
    '/var/lib/dpkg/info/dash.list',
    '/usr/lib/systemd/system/qemu-kvm.service',
    '/lib/systemd/system/qemu-kvm.service','/etc/init.d/qemu-kvm'))
SELECTION_SHA = {
    'qemu-system-x86':'4075ae4d677d10506b036fd0a7736ad771ba13b179cd02f389ec60615f390e71',
    'qemu-system-common':'90475094295b1c50fbf48f0ff189824e34e92effc7334af5239e49eedc7fc8d5',
}
DIRECT_DEPS = tuple('''acl ipxe-qemu libaio1t64 libasound2t64 libbpf1 libbrlapi0.8 libc6 libcacard0 libcap-ng0 libfdt1 libfuse3-3 libglib2.0-0t64 libgmp10 libgnutls30t64 libhogweed6t64 libibverbs1 libjpeg8 libncursesw6 libnettle8t64 libnuma1 libpixman-1-0 libpmem1 libpng16-16t64 librdmacm1t64 libsasl2-2 libseccomp2 libslirp0 libtinfo6 libudev1 liburing2 libusb-1.0-0 libusbredirparser1t64 libzstd1 qemu-system-common qemu-system-data seabios zlib1g'''.split())
LIMITS = {'cpuSeconds':10,'wallSeconds':30,'fileBytes':8388608,
          'hashBytes':67108864,'outputBytes':2097152,'statusRecords':5000}
FLAGS = {'setupApproved':False,'runtimeCandidate':False,'actualRunApproved':False,
         'toolExecuted':False,'guestExecuted':False,'platformMutated':False}

class Refusal(Exception):
    def __init__(self, stage, code, partial=None, secondary=None):
        self.stage,self.code=stage,code
        self.partial=partial
        self.secondary=secondary or []
        super().__init__(stage+':'+code)

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode('utf-8')

def digest(data):
    return hashlib.sha256(data).hexdigest()

def keys(obj, expected, stage):
    if type(obj) is not dict or set(obj)!=set(expected):
        raise Refusal(stage,'fields')

def text(value, maximum, stage):
    if type(value) is not str or not value or len(value.encode('utf-8'))>maximum or '\x00' in value:
        raise Refusal(stage,'text')

def statrow(s):
    return {'dev':s.st_dev,'ino':s.st_ino,'uid':s.st_uid,'gid':s.st_gid,
            'mode':s.st_mode,'nlink':s.st_nlink,'size':s.st_size,'mtimeNs':s.st_mtime_ns}

def stable(a,b):
    return a==b

class LocalOps:
    """Only metadata/read operations; no shell or subprocess."""
    def lstat(self,path): return os.lstat(path)
    def readlink(self,path): return os.readlink(path)
    def open(self,path): return os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC|os.O_NONBLOCK)
    def fstat(self,fd): return os.fstat(fd)
    def read(self,fd,n): return os.read(fd,n)
    def close(self,fd): return os.close(fd)
    def source(self,path):
        p=ROOT/path
        try:fd=self.open(p)
        except OSError as e:raise Refusal('source','open-'+str(e.errno)) from e
        primary=None;secondary=[];raw=bytearray()
        try:
            before=statrow(self.fstat(fd))
            if not stat.S_ISREG(before['mode']) or before['size']>8388608 or before['nlink']!=1:
                raise Refusal('source','extent')
            while len(raw)<before['size']:
                chunk=self.read(fd,min(65536,before['size']-len(raw)))
                if not chunk:break
                raw.extend(chunk)
            if len(raw)!=before['size'] or statrow(self.fstat(fd))!=before or statrow(self.lstat(p))!=before:
                raise Refusal('source','changed')
        except Refusal as e:primary=(e.stage,e.code)
        except OSError as e:primary=('source','os-'+str(e.errno))
        finally:
            try:self.close(fd)
            except OSError as e:
                if primary:secondary.append({'stage':'source','code':'close-'+str(e.errno)})
                else:primary=('source','close-'+str(e.errno))
        if primary:raise Refusal(primary[0],primary[1],secondary=secondary)
        return bytes(raw)

class Clock:
    def __init__(self):self.wall=time.monotonic();self.cpu=time.process_time()
    def check(self):
        if time.monotonic()-self.wall>30 or time.process_time()-self.cpu>10:
            raise Refusal('budget','time')

def validate_request(r):
    keys(r,'schema repository source selection context limits'.split(),'request')
    if r['schema']!=SCHEMA+'request.v1' or r['repository']!='CrispStrobe/bw-board':
        raise Refusal('request','identity')
    src=r['source'];keys(src,'head tree files'.split(),'source')
    for field in ('head','tree'):
        value=src[field]
        if type(value) is not str or len(value)!=40 or any(c not in '0123456789abcdef' for c in value):
            raise Refusal('source','git-id')
    if type(src['files']) is not dict or set(src['files'])!=set(SOURCE5):raise Refusal('source','file-set')
    for value in src['files'].values():
        if type(value) is not str or len(value)!=64 or any(c not in '0123456789abcdef' for c in value):raise Refusal('source','hash')
    sel=r['selection'];keys(sel,'packageVersion architecture controlSha256 directDependencyNames'.split(),'selection')
    if sel['packageVersion']!='1:8.2.2+ds-0ubuntu1.18' or sel['architecture']!='amd64' or sel['controlSha256']!=SELECTION_SHA or sel['directDependencyNames']!=sorted(DIRECT_DEPS):raise Refusal('selection','pin')
    ctx=r['context'];keys(ctx,'eventName repository job runAttempt workflowSha workflowRef actor'.split(),'context')
    if ctx['eventName']!='workflow_dispatch' or ctx['repository']!='CrispStrobe/bw-board' or ctx['job']!='qemu-setup-inventory':raise Refusal('context','identity')
    for field in ('runAttempt',):
        if type(ctx[field]) is not str or not ctx[field].isdigit() or len(ctx[field])>20 or int(ctx[field])<=0:raise Refusal('context','numeric')
    if type(ctx['workflowSha']) is not str or len(ctx['workflowSha'])!=40 or any(c not in '0123456789abcdef' for c in ctx['workflowSha']):raise Refusal('context','workflow')
    if ctx['runAttempt']!='1':raise Refusal('context','attempt')
    for field in ('workflowRef','actor'):text(ctx[field],256,'context')
    if type(r['limits']) is not dict or set(r['limits'])!=set(LIMITS) or any(type(r['limits'][k]) is not int or r['limits'][k]!=v for k,v in LIMITS.items()):
        raise Refusal('limits','fixed')

def validate_env(ctx,env):
    expected={'GITHUB_EVENT_NAME':'eventName','GITHUB_REPOSITORY':'repository','GITHUB_JOB':'job',
              'GITHUB_RUN_ATTEMPT':'runAttempt','GITHUB_WORKFLOW_SHA':'workflowSha',
              'GITHUB_WORKFLOW_REF':'workflowRef','GITHUB_ACTOR':'actor'}
    for name,field in expected.items():
        if env.get(name)!=ctx[field]:raise Refusal('environment','mismatch-'+field)
    if env.get('BW_EXPECTED_HEAD')!=env.get('BW_ACTUAL_HEAD') or env.get('BW_EXPECTED_TREE')!=env.get('BW_ACTUAL_TREE'):
        raise Refusal('environment','git-context')
    run_id=env.get('GITHUB_RUN_ID')
    if type(run_id) is not str or not run_id.isdigit() or len(run_id)>20 or int(run_id)<=0:raise Refusal('environment','run-id')
    if env.get('RUNNER_OS')!='Linux' or env.get('RUNNER_ARCH')!='X64':raise Refusal('environment','runner-platform')
    for name in ('ImageOS','ImageVersion'):
        value=env.get(name)
        if value is not None:
            try:valid=type(value) is str and len(value.encode('utf-8'))<=256 and '\x00' not in value and '\n' not in value
            except UnicodeError:valid=False
            if not valid:raise Refusal('environment','image-field')
    return {'runId':run_id,'runnerOS':env.get('RUNNER_OS'), 'runnerArch':env.get('RUNNER_ARCH')}

def observe(path,ops,clock,budget):
    clock.check()
    partial={'namedBefore':None,'heldBefore':None,'heldAfter':None,'namedAfter':None,
             'bytesRead':0,'prefixSha256':digest(b''),'closeAttempted':False,'closed':False}
    try:before=ops.lstat(path)
    except FileNotFoundError:return {'kind':'absent'}
    except OSError as e:raise Refusal('file','lstat-'+str(e.errno),partial) from e
    first=statrow(before);partial['namedBefore']=first
    if stat.S_ISLNK(before.st_mode):
        try:
            target=ops.readlink(path)
            after=statrow(ops.lstat(path));partial['namedAfter']=after
            if not stable(first,after):raise Refusal('file','alias-drift',partial)
            try:target_bytes=target.encode('utf-8')
            except UnicodeError:raise Refusal('file','alias-utf8',partial)
            if len(target_bytes)>512:raise Refusal('file','alias-cap',partial)
            return {'kind':'alias','target':target,'namedBefore':first,'namedAfter':after}
        except OSError as e:raise Refusal('file','alias-os-'+str(e.errno),partial) from e
    if stat.S_ISDIR(before.st_mode):
        try:after=statrow(ops.lstat(path));partial['namedAfter']=after
        except OSError as e:raise Refusal('file','directory-os-'+str(e.errno),partial) from e
        if not stable(first,after):raise Refusal('file','directory-drift',partial)
        return {'kind':'directory','namedBefore':first,'namedAfter':after}
    if not stat.S_ISREG(before.st_mode) or before.st_nlink!=1:raise Refusal('file','type-or-links',partial)
    if before.st_size<0 or before.st_size>LIMITS['fileBytes'] or budget[0]+before.st_size>LIMITS['hashBytes']:
        raise Refusal('file','extent-cap',partial)
    fd=None;primary=None;secondary=[];raw=bytearray();prefix_hash=hashlib.sha256()
    try:
        fd=ops.open(path)
        held_before=statrow(ops.fstat(fd));partial['heldBefore']=held_before
        if held_before!=first:raise Refusal('file','named-held-drift')
        while len(raw)<before.st_size:
            clock.check()
            chunk=ops.read(fd,min(65536,before.st_size-len(raw)))
            if not chunk:raise Refusal('file','short-read')
            raw.extend(chunk)
            prefix_hash.update(chunk)
            partial['bytesRead']=len(raw);partial['prefixSha256']=prefix_hash.hexdigest()
        if len(raw)<LIMITS['fileBytes']:
            extra=ops.read(fd,1)
            if extra:
                raw.extend(extra)
                prefix_hash.update(extra)
                partial['bytesRead']=len(raw);partial['prefixSha256']=prefix_hash.hexdigest()
                raise Refusal('file','long-read')
        held_after=statrow(ops.fstat(fd));partial['heldAfter']=held_after
        named_after=statrow(ops.lstat(path));partial['namedAfter']=named_after
        if not(stable(first,held_after) and stable(first,named_after)):raise Refusal('file','readback-drift')
    except Refusal as e:primary=(e.stage,e.code)
    except OSError as e:primary=('file','os-'+str(e.errno))
    finally:
        if fd is not None:
            partial['closeAttempted']=True
            try:ops.close(fd);partial['closed']=True
            except OSError as e:
                if primary:secondary.append({'stage':'file','code':'close-'+str(e.errno)})
                else:primary=('file','close-'+str(e.errno))
    if primary:raise Refusal(primary[0],primary[1],partial,secondary)
    budget[0]+=len(raw)
    value=None
    if path in TEXT_FILES and path!='/var/lib/dpkg/status':
        try:value=bytes(raw).decode('utf-8')
        except UnicodeError:raise Refusal('file','utf8',partial)
        if len(raw)>131072:raise Refusal('file','text-cap',partial)
    return {'kind':'regular','namedBefore':first,'heldBefore':held_before,'heldAfter':held_after,
            'namedAfter':named_after,'closed':True,'sha256':prefix_hash.hexdigest(),'text':value},bytes(raw)

def parse_status(raw,clock=None):
    try:body=raw.decode('utf-8')
    except UnicodeError:raise Refusal('status','utf8')
    records=[];seen=set()
    for part in body.split('\n\n'):
        if clock is not None:clock.check()
        if not part.strip():continue
        fields={};name=None
        for line in part.splitlines():
            if line.startswith((' ','\t')):
                if name is None:raise Refusal('status','continuation')
                fields[name]+='\n'+line
                continue
            if ':' not in line:raise Refusal('status','field')
            name,value=line.split(':',1)
            if name in fields or not name or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-' for c in name):raise Refusal('status','duplicate-field')
            fields[name]=value.lstrip(' ')
        pkg=fields.get('Package');arch=fields.get('Architecture')
        if not pkg or not arch:raise Refusal('status','required')
        key=(pkg,arch)
        if key in seen:raise Refusal('status','duplicate-package')
        seen.add(key);records.append(fields)
        if len(records)>LIMITS['statusRecords']:raise Refusal('status','record-cap')
    if not records:raise Refusal('status','empty')
    selected={}
    for pkg in sorted(set(DIRECT_DEPS)|{'qemu-system-x86'}):
        matches=[f for f in records if f['Package']==pkg]
        selected[pkg]=[{k:f.get(k.title() if k!='preDepends' else 'Pre-Depends') for k in
                        ('package','architecture','version','status','depends','preDepends','recommends','provides')}
                       for f in sorted(matches,key=lambda row:row['Architecture'])]
    return selected

def collect(request,env,ops=None,clock=None):
    if not INVT_ENABLED:raise Refusal('entry','disabled')
    ops=ops or LocalOps();clock=clock or Clock()
    validate_request(request)
    if env.get('BW_EXPECTED_HEAD')!=request['source']['head'] or env.get('BW_EXPECTED_TREE')!=request['source']['tree']:
        raise Refusal('source','git-context')
    env_projection=validate_env(request['context'],env)
    source_bytes=0
    for path,expected in request['source']['files'].items():
        clock.check()
        raw_source=ops.source(path)
        if type(raw_source) is not bytes or len(raw_source)>LIMITS['fileBytes'] or source_bytes+len(raw_source)>LIMITS['hashBytes']:raise Refusal('source','extent-cap')
        source_bytes+=len(raw_source)
        if digest(raw_source)!=expected:raise Refusal('source','file-hash')
    result={'schema':SCHEMA+'original.v1','requestSha256':digest(canonical(request)),
            'source':request['source'],'context':{**request['context'],**env_projection},
            'image':{'imageOS':env.get('ImageOS'),'imageVersion':env.get('ImageVersion'),
                     'osRelease':'/usr/lib/os-release','etcOsRelease':'/etc/os-release'},
            'files':{},'status':None,'flags':dict(FLAGS),'failure':None,'secondary':[]}
    budget=[source_bytes]
    for path in FILES:
        try:
            got=observe(path,ops,clock,budget)
            if isinstance(got,tuple):row,raw=got
            else:row,raw=got,None
            result['files'][path]=row
            if path=='/var/lib/dpkg/status' and raw is not None:
                try:
                    chosen=parse_status(raw,clock)
                    packed=base64.b64encode(zlib.compress(raw,9)).decode('ascii')
                    clock.check()
                except Refusal as e:
                    result['failure']={'stage':e.stage,'code':e.code}
                    break
                result['status']={'encoding':'zlib+base64','rawBytes':len(raw),'sha256':digest(raw),
                    'packed':packed,'selected':chosen}
        except Refusal as e:
            result['files'][path]={'kind':'error','code':e.code,'partial':e.partial or {'namedBefore':None,'heldBefore':None,'heldAfter':None,'namedAfter':None,'bytesRead':0,'prefixSha256':digest(b''),'closeAttempted':False,'closed':False}}
            result['failure']={'stage':e.stage,'code':e.code}
            result['secondary'].extend(e.secondary)
            break
        except OSError as e:
            result['files'][path]={'kind':'error','code':'os-'+str(e.errno),'partial':{'namedBefore':None,'heldBefore':None,'heldAfter':None,'namedAfter':None,'bytesRead':0,'prefixSha256':digest(b''),'closeAttempted':False,'closed':False}}
            result['failure']={'stage':'file','code':'os-'+str(e.errno)}
            break
    if result['status'] is None and result['failure'] is None:
        result['failure']={'stage':'status','code':'missing'}
    if not env.get('ImageOS') or not env.get('ImageVersion'):
        result['failure']=result['failure'] or {'stage':'image','code':'missing'}
    return bound_output(result,LIMITS['outputBytes'])

def bound_output(result,wire_cap):
    if type(wire_cap) is not int or wire_cap<1:raise Refusal('output','bound')
    encoded=canonical(result)
    if len(encoded)+1>wire_cap:
        # Preserve the bounded file/status identity already obtained, but refuse the
        # overlarge packed body. The omission is explicit and cannot grade positive.
        result['status']=None
        error={'stage':'output','code':'cap'}
        if result['failure'] is None:result['failure']=error
        else:result['secondary'].append(error)
        if len(canonical(result))+1>wire_cap:
            # A selected text file can alone exceed the output bound. Retain its
            # identity and hash but no unbounded text body, with an explicit cut.
            for row in result['files'].values():
                if row['kind']=='regular' and row['text'] is not None:row['text']=None
            if len(canonical(result))+1>wire_cap:raise Refusal('output','unreportable-cap')
    return result

def parse_admitted_request(raw,expected):
    if type(raw) is not bytes or len(raw)>65536 or type(expected) is not str or len(expected)!=64 or any(c not in '0123456789abcdef' for c in expected):
        raise Refusal('request','expected-hash')
    if digest(raw)!=expected:raise Refusal('request','bytes-hash')
    try:request=json.loads(raw)
    except (ValueError,UnicodeError):raise Refusal('request','json')
    if canonical(request)!=raw:raise Refusal('request','noncanonical')
    validate_request(request)
    return request

def read_admitted_request(path,expected,ops=None):
    if not INVT_ENABLED:raise Refusal('entry','disabled')
    ops=ops or LocalOps()
    try:path_ok=type(path) is str and bool(path) and len(path.encode('utf-8'))<=4096 and '\x00' not in path
    except UnicodeError:path_ok=False
    if not path_ok:raise Refusal('request','path')
    if type(expected) is not str or len(expected)!=64 or any(c not in '0123456789abcdef' for c in expected):
        raise Refusal('request','expected-hash')
    try:named_before=statrow(ops.lstat(path))
    except OSError as e:raise Refusal('request','lstat-'+str(e.errno)) from e
    if not stat.S_ISREG(named_before['mode']) or named_before['nlink']!=1 or named_before['size']>65536:
        raise Refusal('request','type-or-extent')
    try:fd=ops.open(path)
    except OSError as e:raise Refusal('request','open-'+str(e.errno)) from e
    primary=None;secondary=[];raw=bytearray()
    try:
        held_before=statrow(ops.fstat(fd))
        if held_before!=named_before or not stat.S_ISREG(held_before['mode']):raise Refusal('request','named-held-drift')
        while len(raw)<65537:
            chunk=ops.read(fd,min(65537-len(raw),65536))
            if not chunk:break
            raw.extend(chunk)
        if len(raw)>65536:raise Refusal('request','extent')
        if len(raw)!=held_before['size'] or statrow(ops.fstat(fd))!=held_before or statrow(ops.lstat(path))!=named_before:
            raise Refusal('request','readback-drift')
    except Refusal as e:primary=(e.stage,e.code)
    except OSError as e:primary=('request','os-'+str(e.errno))
    finally:
        try:ops.close(fd)
        except OSError as e:
            if primary:secondary.append({'stage':'request','code':'close-'+str(e.errno)})
            else:primary=('request','close-'+str(e.errno))
    if primary:raise Refusal(primary[0],primary[1],secondary=secondary)
    return parse_admitted_request(bytes(raw),expected)

def main():
    if not INVT_ENABLED:raise Refusal('entry','disabled')
    if len(sys.argv)!=5 or sys.argv[1]!='--request' or sys.argv[3]!='--expected-sha256':
        raise Refusal('entry','argv')
    request=read_admitted_request(sys.argv[2],sys.argv[4])
    result=collect(request,os.environ)
    wire=canonical(result)+b'\n'
    if len(wire)>LIMITS['outputBytes']:raise Refusal('output','wire-cap')
    try:written=sys.stdout.buffer.write(wire)
    except OSError as e:raise Refusal('output','write-'+str(e.errno)) from e
    if written!=len(wire):raise Refusal('output','short-write')
    try:sys.stdout.buffer.flush()
    except OSError as e:raise Refusal('output','flush-'+str(e.errno)) from e
    return 0 if result['failure'] is None else 1

if __name__=='__main__':
    try:sys.exit(main())
    except Refusal as e:
        print(canonical({'failure':{'stage':e.stage,'code':e.code},
                         'secondary':e.secondary}).decode('utf-8'),file=sys.stderr)
        sys.exit(2)
