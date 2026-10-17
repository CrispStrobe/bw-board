#!/usr/bin/env python3
"""MIT. Fixed ring3 hosted controller. --controls uses inert edges only.

Source checkpoint: bounded child/resource functions are executable against the
mock interface below. The actual entry remains closed until the runtime graph,
privileged first-entry and workflow receive their separate source review.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import posixpath
import re
import resource
import selectors
import signal
import stat
import struct
import subprocess
import sys
import time
import urllib.request

PACKET = Path('build/i80386-ring3-int-iret')
ENV = {'LANG': 'C.UTF-8', 'HOME': '/nonexistent', 'PATH': '/usr/bin:/bin'}
LIMITS = {'cpuMax': '100000 100000', 'memoryMax': '1073741824', 'swapMax': '0', 'pidsMax': '64'}
CHILD_NS, DRAIN_NS = 120000000000, 2000000000
STREAM_CAP, JSON_CAP, PACKET_CAP = 131072, 1048576, 16777216
# Internal preparation transport only; existing guest/controller caps stay fixed.
PREPARATION_STREAMS = {'stdout':(256<<10)+44,'stderr':16<<10}
PREPARATION_MAGIC = b'R3PREv1\0'
SOURCE_PATHS = frozenset(('LICENSE package.json src/experimental/i80386.js '
    '.github/workflows/i80386-ring3-int-iret.yml docs/I80386-RING3-INT-IRET-RESULTS.md '
    'test/i80386-ring3-int-iret.test.mjs').split() +
    ['scripts/i80386-ring3-int-iret/'+name for name in
     ('fixture.mjs', 'probe.mjs', 'run.py', 'reader.py', 'controls.py', 'README.md')])
RUNTIME_CAPS = {'files':512,'aliases':256,'probes':16,'pathBytes':256,
    'probeStreamBytes':16384,'fileBytes':268435456,'graphFileBytes':1073741824}
RUNTIME_EXECUTABLES = {'node':'/opt/hostedtoolcache/node/22.23.3/x64/bin/node',
    'python':'/usr/bin/python3','qemu':'/usr/bin/qemu-system-i386'}
TCG_MODULE = '/usr/lib/x86_64-linux-gnu/qemu/accel-tcg-i386.so'
PACKAGE_NAMES = ('qemu-system-x86','qemu-system-common','qemu-system-data','seabios','ipxe-qemu')
ELF_INTERPRETERS = ('/lib/ld-linux.so.2','/lib64/ld-linux-x86-64.so.2','/libx32/ld-linux-x32.so.2')


def need(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)+'\n').encode()


def row(error, phase):
    return {'phase': phase, 'name': type(error).__name__, 'message': str(error)}


class ObservedFailure(RuntimeError):
    def __init__(self,first,secondary):
        super().__init__(first['message'])
        self.firstFailure,self.secondary=first,secondary


class FirstFailure:
    def __init__(self):
        self.first = None
        self.secondary = []

    def add(self, error, phase):
        value = error.firstFailure if isinstance(error,ObservedFailure) else row(error, phase)
        if self.first is None:
            self.first = value
        else:
            self.secondary.append(value)
        self.secondary.extend(getattr(error, 'ring3_secondary', []))
        if isinstance(error,ObservedFailure):self.secondary.extend(error.secondary)

    def adopt(self, primary, secondary):
        if primary is not None:
            if self.first is None: self.first = primary
            else: self.secondary.append(primary)
        self.secondary.extend(secondary)


def close_owned(descriptor, first=None, phase='owned-descriptor-close'):
    """Close once; never mask the earlier operation's exception."""
    try: os.close(descriptor)
    except Exception as error:
        if first is None: return error
        first.ring3_secondary = getattr(first, 'ring3_secondary', [])+[row(error, phase)]
    return first


def bounded_read(path, cap, *, with_mode=False):
    """Regular-file data only; no blocking FIFO or followed final symlink."""
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    first = None; data = bytearray()
    try:
        info = os.fstat(descriptor)
        need(stat.S_ISREG(info.st_mode) and 0 <= info.st_size <= cap, 'bounded regular input')
        while True:
            part = os.read(descriptor, min(65536, cap+1-len(data)))
            if not part: break
            data.extend(part)
            need(len(data) <= cap, 'input grew beyond cap')
        after = os.fstat(descriptor)
        need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns) ==
             (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) and len(data) == info.st_size,
             'stable input identity and extent')
        if with_mode: need(info.st_mode == after.st_mode, 'stable source mode')
    except Exception as error: first = error
    finally: first = close_owned(descriptor, first, 'input-descriptor-close')
    if first is not None: raise first
    return (bytes(data),'100755' if info.st_mode & 0o111 else '100644') if with_mode else bytes(data)


def write_new(path, data, cap):
    need(len(data) <= cap, 'retained role encoding cap')
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    first = None; stream = None
    try:
        stream = os.fdopen(descriptor, 'wb')
        need(stream.write(data) == len(data), 'complete retained role write')
    except Exception as error: first = error
    finally:
        if stream is None: first = close_owned(descriptor, first, 'retention-descriptor-close')
        else:
            try: stream.close()
            except Exception as error:
                if first is None: first = error
                else: first.ring3_secondary = getattr(first, 'ring3_secondary', [])+[row(error, 'retention-stream-close')]
    if first is not None: raise first


def runtime_facts(template, read_file, read_alias, probe=None, stage='after-guests'):
    """Observe every named key, retaining changed/error facts rather than hiding
    them. Probes are historical PRELAUNCH originals, executed only when probe
    is supplied. After readback always rehashes all files and rereads all aliases.
    Actual graph discovery/approval remains separate and is not exposed as an
    arbitrary executable or path CLI.
    """
    result = json.loads(json.dumps(template)); failure = FirstFailure()
    package = result.get('qemuPackage',result)  # Failure-only partial discovery has no positive runtime schema.
    for path, old in package['files'].items():
        try:
            data = read_file(path, 268435456)
            package['files'][path] = {'bytes':len(data), 'sha256':sha(data), 'kind':old['kind']}
        except Exception as error:
            failure.add(error, 'runtime-file-readback')
            package['files'][path] = {'kind':old['kind'], 'firstFailure':row(error,'runtime-file-readback')}
    for path in package['aliases']:
        try: package['aliases'][path] = read_alias(path)
        except Exception as error:
            failure.add(error, 'runtime-alias-readback')
            package['aliases'][path] = {'firstFailure':row(error,'runtime-alias-readback')}
    if probe is not None:
        for index, original in enumerate(package['probes']):
            try: package['probes'][index] = probe(original)
            except Exception as error:
                failure.add(error, 'runtime-prelaunch-probe')
                package['probes'][index] = {'role':original['role'],'firstFailure':row(error,'runtime-prelaunch-probe')}
    for name, executable in result.get('executables',{}).items():
        observed = package['files'][executable['path']]
        result['executables'][name] = {'path':executable['path'], **{k:observed.get(k) for k in ('bytes','sha256')}}
    if probe is None and result != template and failure.first is None:
        need(stage in ('after-guests','before-guests'),'fixed runtime readback stage')
        failure.add(ValueError('runtime file or alias changed '+stage), 'runtime-after-drift' if stage=='after-guests' else 'runtime-before-drift')
    return result, failure


def runtime_path(path):
    need(type(path) is str and 0 < len(path.encode()) <= 256 and
         re.fullmatch(r'/[A-Za-z0-9_.+/-]+',path) and posixpath.normpath(path) == path and
         not path.startswith('//'), 'bounded canonical runtime path')
    return path


class RuntimeFiles:
    """Read-only named file/alias observations; no tool or guest execution."""
    def resolve(self, path, seen=()):
        runtime_path(path)
        need(path not in seen and len(seen) < 16, 'bounded runtime alias chain')
        aliases = {}
        parts = Path(path).parts
        for index in range(1,len(parts)):
            prefix = str(Path(*parts[:index+1]))
            info = os.lstat(prefix)
            if stat.S_ISLNK(info.st_mode):
                text = os.readlink(prefix)
                need(0 < len(text.encode()) <= 256 and re.fullmatch(r'[A-Za-z0-9_.+/-]+',text), 'bounded symlink text')
                target = posixpath.normpath(posixpath.join(posixpath.dirname(prefix),text))
                final,nested = self.resolve(target,seen+(path,))
                aliases.update(nested); aliases[prefix] = {'linkText':text,'target':final}
                rest = str(Path(final,*parts[index+1:]))
                resolved,later = self.resolve(rest,seen+(path,)) if rest != final else (final,{})
                aliases.update(later)
                return resolved,aliases
        return path,aliases

    def read(self,path,cap):
        need(str(Path(path).resolve(strict=True)) == path, 'read admitted canonical file')
        data = bounded_read(path,cap)
        need(str(Path(path).resolve(strict=True)) == path, 'canonical file resolution drift')
        return data

    def alias(self,path):
        first = os.lstat(path); need(stat.S_ISLNK(first.st_mode),'observed alias remains a symlink')
        text = os.readlink(path); target,_ = self.resolve(posixpath.normpath(posixpath.join(posixpath.dirname(path),text)))
        after = os.lstat(path)
        need((first.st_dev,first.st_ino,first.st_mtime_ns) == (after.st_dev,after.st_ino,after.st_mtime_ns), 'stable alias read')
        return {'linkText':text,'target':target}

    def is_file(self,path): return Path(path).is_file()

    def python_files(self):
        result = set(); checkout = Path.cwd().resolve()
        for module in tuple(sys.modules.values()):
            for name in ('__file__','__cached__'):
                path = getattr(module,name,None)
                if not isinstance(path,str) or not Path(path).is_absolute(): continue
                absolute = Path(path).resolve()
                if absolute.is_relative_to(checkout) or not absolute.is_file(): continue
                result.add(str(absolute))
        need(len(result) <= 256,'selected Python module-file census cap')
        return sorted(result)

    def mapped_libraries(self):
        descriptor = os.open('/proc/self/maps',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        first = None; data = b''
        try:
            while True:
                chunk=os.read(descriptor,65537-len(data))
                if not chunk:break
                data+=chunk;need(len(data)<=65536,'bounded Python mapped-library census')
        except Exception as error: first=error
        finally: first=close_owned(descriptor,first,'maps-descriptor-close')
        if first is not None: raise first
        paths = set()
        for line in data.decode('utf-8').splitlines():
            fields=line.split(None,5)
            if len(fields)<6 or not fields[5].startswith('/'):continue
            path=fields[5]
            need(not path.endswith(' (deleted)'),'mapped runtime file deleted')
            if '.so' in Path(path).name or Path(path).name.startswith('ld-'):paths.add(runtime_path(path))
        need(len(paths)<=128,'selected Python mapped-library count')
        return sorted(paths)

    def platform(self):
        value=platform.uname()
        need(value.system=='Linux' and value.machine=='x86_64','fixed hosted runtime platform')
        return {'sysname':value.system,'release':value.release,'machine':value.machine}


class RuntimeDiscovery:
    """One fixed observation plan. No arbitrary command/path/URL fallback.

    The data census is a package-file superset for the fixed custom-ROM argv;
    its completeness still needs external source/runtime admission. These
    selected observations do not attest every file on the host.
    """
    PRIORITY = {'shared-library':0,'qemu-data':1,'python-stdlib':2,'observation-tool':3,
                'tool-interpreter':3,'tcg-module':4,'elf-interpreter':4,
                'qemu-binary':5,'node-binary':5,'python-binary':5}

    def __init__(self,files,probe):
        self.ops,self.probe=files,probe
        self.files,self.aliases,self.probes={},{},[]
        self.partial=None

    def add(self,path,kind):
        need(kind in self.PRIORITY,'closed runtime file kind')
        canonical,aliases=self.ops.resolve(runtime_path(path))
        runtime_path(canonical)
        for name,record in aliases.items():
            need(name not in self.aliases or self.aliases[name]==record,'alias changed during discovery')
            if name not in self.aliases:need(len(self.aliases)<256,'runtime alias count cap')
            self.aliases[name]=record
        need(len(self.aliases)<=256,'runtime alias count cap')
        if canonical not in self.files:
            need(len(self.files)<512,'runtime file count cap')
            data=self.ops.read(canonical,268435456)
            need(0<len(data)<=268435456,'runtime file extent')
            if kind.endswith('-binary') or kind in ('shared-library','elf-interpreter','tcg-module','tool-interpreter'):
                need(data.startswith(b'\x7fELF'),'observed named ELF file bytes')
            self.files[canonical]={'bytes':len(data),'sha256':sha(data),'kind':kind}
            need(sum(item['bytes'] for item in self.files.values())<=1073741824,'runtime graph byte cap')
        elif self.PRIORITY[kind]>self.PRIORITY[self.files[canonical]['kind']]:
            self.files[canonical]['kind']=kind
        return canonical

    def observe(self,role,argv):
        need(len(self.probes)<16 and role not in {item['role'] for item in self.probes},'fixed runtime probe count/uniqueness')
        original,failure=self.probe(role,argv)
        for stream in ('stdout','stderr'):
            text=original.get(stream)
            if isinstance(text,str) and len(text.encode('utf-8','surrogateescape'))>16384:
                original=dict(original)
                original[stream]=text.encode('utf-8','surrogateescape')[:16384].decode('utf-8','surrogateescape')
                failure.add(ValueError('runtime original '+stream+' cap'),'runtime-probe-cap')
        self.probes.append(original)  # Preserve partial original even on refusal.
        if failure.first is not None:
            raise ObservedFailure(failure.first,failure.secondary)
        need(original=={'role':role,'argv':argv,'environment':dict(ENV),'exitCode':0,
                        'stdout':original['stdout'],'stderr':''},'successful closed original probe')
        need(type(original['exitCode']) is int,'original probe integer status')
        need(type(original['stdout']) is str and len(original['stdout'].encode())<=16384,'runtime original stdout cap')
        return original['stdout']

    def ldd(self,role,path):
        output=self.observe(role,['/usr/bin/ldd',path]);count=0
        for line in output.splitlines():
            line=line.strip()
            if re.fullmatch(r'linux-vdso\.so\.\d+ \(0x[0-9a-f]+\)',line):continue
            match=re.fullmatch(r'(?:([^/\s]+) => )?(/[^\s]+) \(0x[0-9a-f]+\)',line)
            need(match is not None,'resolved named ldd dependency; no missing/static fallback')
            self.add(match[2],'shared-library' if match[1] else 'elf-interpreter');count+=1
        need(count>0,'actual ELF dependencies observed')

    def discover(self):
        executables={name:self.add(path,name+'-binary') for name,path in RUNTIME_EXECUTABLES.items()}
        self.add('/usr/bin/ldd','observation-tool');self.add('/usr/bin/dpkg-query','observation-tool')
        shell=self.add('/usr/bin/bash','tool-interpreter')
        # Bind the actual fixed ldd script interpreter; no shell/env fallback.
        script=self.ops.read('/usr/bin/ldd',65536)
        need(script.startswith((b'#!/bin/bash\n',b'#!/usr/bin/bash\n')),'reviewed ldd shell interface')
        declared_shell=script.splitlines()[0][2:].decode()
        need(self.add(declared_shell,'tool-interpreter')==shell,'original ldd interpreter alias/identity')
        for path in ELF_INTERPRETERS:
            if self.ops.is_file(path):self.add(path,'elf-interpreter')
        self.ldd('ldd-shell','/usr/bin/bash');self.ldd('ldd-dpkg-query','/usr/bin/dpkg-query')
        for name,path in executables.items():self.ldd('ldd-'+name,path)
        versions_output=self.observe('package-version',['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES])
        rows=[line.split('\t') for line in versions_output.splitlines()]
        need(len(rows)==5 and all(len(item)==3 for item in rows) and {item[0] for item in rows}==set(PACKAGE_NAMES),'exact installed package roster')
        package_version=next(item[1] for item in rows if item[0]=='qemu-system-x86')
        architecture=next(item[2] for item in rows if item[0]=='qemu-system-x86')
        need(re.fullmatch(r'(?:\d+:)?8\.2\.2(?:[+~.-][^\s]*)?',package_version) and architecture=='amd64','observed package profile')
        file_output=self.observe('package-files',['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES])
        listed=file_output.splitlines();need(listed and all(path.startswith('/') for path in listed),'original package file roster')
        need(TCG_MODULE in listed and self.ops.is_file(TCG_MODULE),'required named installed i386 TCG module')
        module=self.add(TCG_MODULE,'tcg-module');self.ldd('ldd-tcg',module)
        data_count=0
        for path in sorted(set(listed)):
            if path.startswith(('/usr/share/qemu/','/usr/share/seabios/','/usr/share/ipxe/','/usr/share/ipxe-qemu/')) and self.ops.is_file(path):
                self.add(runtime_path(path),'qemu-data');data_count+=1
        need(data_count>0,'observed package/data file superset')
        for path in self.ops.python_files():self.add(path,'python-stdlib')
        for path in self.ops.mapped_libraries():self.add(path,'shared-library')
        versions={}
        for name,path in executables.items():
            original=self.observe(name+'-version',[path,'--version'])
            need(original.splitlines(),'original version output');versions[name]=original.splitlines()[0]
        need(versions['node']=='v22.23.3' and re.fullmatch(r'Python 3\.\d+\.\d+',versions['python']) and
             re.fullmatch(r'QEMU emulator version 8\.2\.2(?:[ (][^\r\n]*)?',versions['qemu']),'observed exact runtime versions')
        value={'schema':'bw.ring3.runtime.v2','observationPolicy':'prelaunch-probes-and-before-after-file-readback',
            'platform':self.ops.platform(),'executables':{name:{'path':path,**{key:self.files[path][key] for key in ('bytes','sha256')}} for name,path in executables.items()},
            'versions':versions,'qemuPackage':{'name':'qemu-system-x86','version':package_version,'architecture':architecture,
                'files':self.files,'aliases':self.aliases,'probes':self.probes}}
        self.partial=value
        need(len(encode(value))<=JSON_CAP,'complete retained runtime JSON cap')
        # After discovery, reread EVERY file/alias before any guest. This does
        # not rerun ldd/version/package probes or erase their exact originals.
        checked,failure=runtime_facts(value,self.ops.read,self.ops.alias,stage='before-guests')
        self.partial=checked
        if failure.first is not None:
            raise ObservedFailure(failure.first,failure.secondary)
        return checked

    def originals(self):
        """Failure-only partial facts; never fabricate absent success fields."""
        return self.partial if self.partial is not None else {'files':self.files,'aliases':self.aliases,'probes':self.probes}


def retain_failure(failure, write, diagnostic):
    """Retention failure is secondary; even failed diagnostics cannot replace primary."""
    try:
        write({'firstFailure': failure.first, 'secondary': failure.secondary})
    except Exception as error:
        failure.add(error, 'failure-retention')
        try:
            data = encode({'firstFailure': failure.first, 'secondary': failure.secondary})
            need(len(data) <= 16384, 'structured diagnostic cap')
            diagnostic(data)
        except Exception as secondary:
            failure.add(secondary, 'failure-diagnostic')
    return failure


def capture_source(head, command, read=bounded_read):
    """Fixed Git/live closure, never fetched or inferred from a producer verdict."""
    need(re.fullmatch('[0-9a-f]{40}', head), 'exact expected source head')
    git = ['git', '--no-replace-objects', '-c', 'gc.auto=0', '-c', 'maintenance.auto=false']
    need(command(git+['rev-parse', 'HEAD'], 1024).strip().decode() == head, 'checkout head drift')
    tree = command(git+['rev-parse', 'HEAD^{tree}'], 1024).strip().decode()
    need(re.fullmatch('[0-9a-f]{40}', tree), 'source tree identity')
    listing = command(git+['ls-tree', '-r', 'HEAD', '--', *sorted(SOURCE_PATHS)], 16384).decode()
    files = {}
    for line in listing.splitlines():
        metadata, path = line.split('\t'); mode, kind, blob = metadata.split()
        need(path in SOURCE_PATHS and path not in files and mode == '100644' and kind == 'blob' and
             re.fullmatch('[0-9a-f]{40}', blob), 'fixed regular source census')
        data = read(path, 4 << 20)
        actual_blob = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        need(actual_blob == blob, 'live source/Git object mismatch')
        files[path] = {'bytes': len(data), 'sha256': sha(data), 'mode': mode, 'blob': blob}
    need(set(files) == SOURCE_PATHS, 'complete fixed source/import/data closure')
    # The ordinary CPU file has no dependencies. Node's ESM interpretation also
    # binds package.json; only fixture/probe and this single CPU are local code.
    cpu = read('src/experimental/i80386.js', 4 << 20).decode()
    need(not re.search(r'\b(?:import\s|require\s*\(|import\s*\()', cpu), 'CPU import closure changed')
    return {'schema': 'bw.ring3.source.v1', 'head': head, 'tree': tree, 'files': files}


def expected_cgroup(environ):
    run, attempt = environ.get('GITHUB_RUN_ID', ''), environ.get('GITHUB_RUN_ATTEMPT', '')
    need(re.fullmatch('[1-9][0-9]{0,19}', run) and attempt == '1', 'official first-attempt owned cgroup name')
    return Path('/sys/fs/cgroup') / ('bw-ring3-'+run+'-1')


class Cgroups:
    """Only the four fixed leaves under one admitted exact run root."""
    FILES = {'cpuMax': 'cpu.max', 'memoryMax': 'memory.max', 'swapMax': 'memory.swap.max', 'pidsMax': 'pids.max'}

    def __init__(self, root, uid, environ):
        need(Path(root) == expected_cgroup(environ) and type(uid) is int and uid > 0, 'fixed owned cgroup root')
        self.root, self.uid, self.identities = Path(root), uid, {}
        self.last_discovery_census=None

    def path(self, role):
        need(role in ('enclosing', 'controller', 'js', 'qemu'), 'closed cgroup role')
        path = self.root if role == 'enclosing' else self.root / role
        need(not path.is_symlink() and path.resolve() == path, 'canonical owned cgroup directory')
        info = path.stat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == self.uid and
             info.st_dev == Path('/sys/fs/cgroup').stat().st_dev, 'delegated cgroup owner/filesystem')
        identity = {'device': info.st_dev, 'inode': info.st_ino}
        need(role not in self.identities or self.identities[role] == identity, 'owned cgroup identity drift')
        self.identities[role] = identity
        return path

    def text(self, path):
        # cgroup pseudo-files report st_size0, so their read rule is distinct
        # from regular source files: finite read, final symlink refused.
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        first = None; data = b''
        try:
            data = os.read(descriptor, 4097)
            need(len(data) <= 4096, 'kernel observation cap')
            data = data.decode('ascii')
        except Exception as error: first = error
        finally: first = close_owned(descriptor, first, 'kernel-descriptor-close')
        if first is not None: raise first
        return data

    def observe(self, role):
        path = self.path(role)
        limits = {key: self.text(path/name).strip() for key, name in self.FILES.items()}
        need(limits == LIMITS, 'observed fixed envelope limits')
        raw = {key: self.text(path/name) for key, name in
               (('memoryEvents','memory.events'),('cpuStat','cpu.stat'),('cgroupEvents','cgroup.events'),
                ('memoryCurrent','memory.current'),('memoryPeak','memory.peak'),('pidsCurrent','pids.current'))}
        procs = self.text(path/'cgroup.procs').splitlines()
        need(all(re.fullmatch('[1-9][0-9]*', value) for value in procs), 'raw local PID census')
        return {'identity': self.identities[role], 'limits': limits, 'raw': raw, 'procs': sorted(map(int, procs))}

    def move_child(self, role, pid):
        need(role in ('js', 'qemu') and pid == os.getpid(), 'only self enters fixed child leaf')
        path = self.path(role)
        with (path/'cgroup.procs').open('w') as stream: stream.write(str(pid))

    def kill_child(self, role):
        need(role in ('js', 'qemu'), 'only owned child cleanup')
        with (self.path(role)/'cgroup.kill').open('w') as stream: stream.write('1')

    def discovery_member(self, parent, child):
        need(child==os.getpid() and type(parent) is int and parent>0 and parent!=child,'fixed discovery parent/child identity')
        controller=self.observe('controller')
        need(controller['procs']==sorted((parent,child)) and
             controller['raw']['pidsCurrent'].strip()=='2' and
             'populated 1' in controller['raw']['cgroupEvents'].splitlines(),
             'discovery child must inherit admitted controller membership')

    def discovery_idle(self, parent):
        need(type(parent) is int and parent==os.getpid(),'current discovery controller identity')
        snapshots={};self.last_discovery_census=snapshots
        for name in ('controller','js','qemu'):snapshots[name]=self.observe(name)
        for name,snapshot in snapshots.items():
            active=name=='controller'
            need(snapshot['procs']==([parent] if active else []) and
                 snapshot['raw']['pidsCurrent'].strip()==('1' if active else '0') and
                 ('populated '+('1' if active else '0')) in snapshot['raw']['cgroupEvents'].splitlines(),
                 'discovery requires parent-only controller and empty guest leaves: '+name)
        return snapshots


ENTRY_FILE = PACKET / '.entry.json'
ENTRY_FAILURE = PACKET / '.entry-failure.json'
RUN_FILE = 'scripts/i80386-ring3-int-iret/run.py'


def entry_json(raw):
    def pairs(values):
        result = {}
        for key, value in values:
            need(key not in result, 'duplicate internal entry JSON key')
            result[key] = value
        return result
    def reject(value):
        raise ValueError('noninteger or nonfinite internal entry JSON number')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=reject, parse_float=reject)


def entry_proc(path):
    need(path in ('/proc/self/status','/proc/self/cgroup'), 'fixed entry kernel observation path')
    return Cgroups.text(None,Path(path))  # Existing 4096-byte NOFOLLOW/nonblocking read, first error retained.


def entry_snapshot(snapshot):
    need(type(snapshot) is dict and set(snapshot) == {'identity','limits','raw','procs'} and
         type(snapshot['identity']) is dict and set(snapshot['identity']) == {'device','inode'} and
         all(type(value) is int and value > 0 for value in snapshot['identity'].values()) and
         snapshot['limits'] == LIMITS and type(snapshot['raw']) is dict and
         set(snapshot['raw']) == {'memoryEvents','cpuStat','cgroupEvents','memoryCurrent','memoryPeak','pidsCurrent'} and
         all(type(value) is str and len(value.encode('ascii')) <= 4096 for value in snapshot['raw'].values()),
         'closed frozen entry snapshot')
    entry_empty(snapshot)


def entry_empty(snapshot):
    need(snapshot['procs'] == [] and snapshot['raw']['pidsCurrent'].strip() == '0' and
         'populated 0' in snapshot['raw']['cgroupEvents'].splitlines(), 'entry cgroup must be empty')


def entry_ids(uid, gid):
    need(os.getresuid() == (uid,)*3 and os.getresgid() == (gid,)*3 and os.getgroups() == [],
         'all real/effective/saved IDs and supplementary groups must be dropped')
    status = entry_proc('/proc/self/status')
    for field in ('CapInh', 'CapPrm', 'CapEff', 'CapAmb'):
        value = re.search(r'^'+field+r':\s*([0-9a-fA-F]+)\s*$', status, re.M)
        need(value is not None and int(value[1], 16) == 0, 'nonzero or absent dropped capability '+field)


class BootstrapOps:
    """Closed same-file entry slice; not exposed by main or a hosted workflow.

    Root only reads held files, moves itself once and drops privileges. Entry
    facts are an internal bounded preparation file, never an extra packet role.
    Runtime probes, Git commands, archive handling and guests are forbidden here.
    """
    def __init__(self, environ=None):
        self.environ = dict(os.environ if environ is None else environ)
        self.invoker = self.owner = self.groups = None

    def validate(self):
        need(os.getresuid() == (0,)*3 and os.getresgid() == (0,)*3, 'privileged bootstrap entry required')
        # Establish the trusted sudo invoker before any fallible path/owner
        # validation, so failures can be retained only after a safe UID drop.
        ids = [self.environ.get('SUDO_'+name, '') for name in ('UID', 'GID')]
        need(all(re.fullmatch('[1-9][0-9]{0,9}', value) and int(value) < 2**31 for value in ids),
             'trusted positive sudo invoker unavailable')
        self.invoker = dict(zip(('uid', 'gid'), map(int, ids)))
        root = expected_cgroup(self.environ)
        for key in ('BW_EXPECTED_HEAD', 'BW_EXPECTED_TREE'):
            need(re.fullmatch('[0-9a-f]{40}', self.environ.get(key, '')), 'exact entry source binding')
        checkout = Path.cwd()
        for directory in (checkout, checkout/'build', checkout/PACKET):
            info = directory.lstat()
            need(directory.resolve(strict=True) == directory and stat.S_ISDIR(info.st_mode) and
                 (info.st_uid,info.st_gid) == (self.invoker['uid'],self.invoker['gid']),
                 'canonical invoker-owned checkout and packet directories')
        need(ENTRY_FILE.resolve(strict=True) == checkout/ENTRY_FILE and
             (PACKET/'source.before.json').resolve(strict=True) == checkout/PACKET/'source.before.json',
             'canonical fixed entry facts paths')
        info = ENTRY_FILE.lstat()
        need(stat.S_ISREG(info.st_mode) and (info.st_uid, info.st_gid) ==
             (self.invoker['uid'], self.invoker['gid']), 'invoker-owned regular entry facts')
        owner = entry_json(bounded_read(ENTRY_FILE, JSON_CAP))
        need(type(owner) is dict and set(owner) == {'schema','uid','gid','root','sourceSha256','python','cgroups'} and
             owner['schema'] == 'bw.ring3.entry.v1' and
             all(type(owner[k]) is int and owner[k] == self.invoker[k] for k in ('uid','gid')) and
             owner['root'] == str(root), 'closed entry facts and invoker identity')
        self.owner = owner
        need(type(owner['cgroups']) is dict and set(owner['cgroups']) == {'enclosing','controller','js','qemu'},
             'four fixed entry cgroups')
        self.groups = Cgroups(root, owner['uid'], self.environ)
        identities = set()
        for role in ('enclosing','controller','js','qemu'):
            snapshot = self.groups.observe(role); entry_empty(snapshot)
            frozen = owner['cgroups'][role]
            entry_snapshot(frozen)
            need(snapshot['identity'] == frozen['identity'] and snapshot['limits'] == frozen['limits'] == LIMITS,
                 'entry cgroup identity or limits drift')
            entry_empty(frozen)
            identity = tuple(snapshot['identity'][name] for name in ('device','inode'))
            need(identity not in identities and self.groups.path(role).stat().st_gid == owner['gid'],
                 'distinct invoker-owned entry cgroups')
            identities.add(identity)
        raw = bounded_read(PACKET/'source.before.json', JSON_CAP)
        source = entry_json(raw)
        need(sha(raw) == owner['sourceSha256'] and type(source) is dict and
             set(source) == {'schema','head','tree','files'} and source['schema'] == 'bw.ring3.source.v1' and
             source['head'] == self.environ['BW_EXPECTED_HEAD'] and source['tree'] == self.environ['BW_EXPECTED_TREE'] and
             type(source['files']) is dict and set(source['files']) == SOURCE_PATHS, 'exact held entry source closure')
        need(Path(__file__).resolve(strict=True) == checkout/RUN_FILE, 'held entry script location')
        for name, frozen in source['files'].items():
            need(type(frozen) is dict and set(frozen) == {'bytes','sha256','mode','blob'} and
                 type(frozen['bytes']) is int and 0 < frozen['bytes'] <= 4 << 20 and frozen['mode'] == '100644' and
                 re.fullmatch('[0-9a-f]{64}', frozen['sha256']) and re.fullmatch('[0-9a-f]{40}', frozen['blob']),
                 'closed fixed source row')
            path = Path(name)
            need(path.resolve(strict=True) == checkout/name and stat.S_ISREG(path.lstat().st_mode),
                 'canonical regular held source path')
            data = bounded_read(path, 4 << 20)
            need(len(data) == frozen['bytes'] and sha(data) == frozen['sha256'] and
                 hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() == frozen['blob'],
                 'held entry source bytes drift')
        python = owner['python']
        need(type(python) is dict and set(python) == {'path','bytes','sha256'} and
             type(python['bytes']) is int and 0 < python['bytes'] <= RUNTIME_CAPS['fileBytes'] and
             re.fullmatch('[0-9a-f]{64}', python['sha256']), 'closed entry Python identity')
        files = RuntimeFiles()
        canonical, _ = files.resolve(RUNTIME_EXECUTABLES['python'])
        need(python['path'] == canonical and files.resolve(sys.executable)[0] == canonical and
             Path(canonical).stat().st_mode & 0o6000 == 0, 'exact non-setid entry Python selection')
        data = files.read(canonical, RUNTIME_CAPS['fileBytes'])
        need(len(data) == python['bytes'] and sha(data) == python['sha256'], 'entry Python bytes drift')
        return owner

    def entered(self):
        need(entry_proc('/proc/self/cgroup') ==
             '0::/'+self.groups.root.name+'/controller\n', 'entry controller membership path')
        snapshot = self.groups.observe('controller')
        need(snapshot['identity'] == self.owner['cgroups']['controller']['identity'] and
             snapshot['procs'] == [os.getpid()] and snapshot['raw']['pidsCurrent'].strip() == '1' and
             'populated 1' in snapshot['raw']['cgroupEvents'].splitlines(), 'entry sole controller PID and leaf identity')

    def enter(self):
        path = self.groups.path('controller')/'cgroup.procs'
        descriptor = os.open(path, os.O_WRONLY | os.O_NOFOLLOW)
        first = None
        try:
            data = str(os.getpid()).encode('ascii')
            need(os.write(descriptor, data) == len(data), 'complete privileged self migration')
        except Exception as error: first = error
        finally: first = close_owned(descriptor, first, 'entry-migration-close')
        if first is not None: raise first
        self.entered()

    def drop(self):
        need(self.invoker is not None, 'trusted invoker required before drop')
        uid, gid = self.invoker['uid'], self.invoker['gid']
        os.setgroups([]); os.setresgid(gid,gid,gid); os.setresuid(uid,uid,uid)
        entry_ids(uid,gid)

    def execute(self):
        entry_ids(self.invoker['uid'],self.invoker['gid']); self.entered()
        python = self.owner['python']['path']
        environment = dict(ENV, **{name:self.environ[name] for name in
            ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')})
        os.execve(python, [python,'-I','-B',RUN_FILE,'--controller'], environment)
        raise RuntimeError('entry exec unexpectedly returned')

    def retain(self, failure):
        # Never write owned evidence as root, including failures before owner
        # validation. Unknown invoker/failed drop means bounded stderr only.
        try:
            need(self.invoker is not None, 'trusted invoker unavailable for entry retention')
            if os.getresuid() != (self.invoker['uid'],)*3 or os.getresgid() != (self.invoker['gid'],)*3 or os.getgroups():
                self.drop()
            entry_ids(self.invoker['uid'],self.invoker['gid'])
            retain_failure(failure, lambda facts:write_new(ENTRY_FAILURE,encode(facts),JSON_CAP),
                           lambda data:sys.stderr.buffer.write(data))
        except BaseException as error:
            failure.add(error,'entry-retention')
            try:
                data = encode({'firstFailure':failure.first,'secondary':failure.secondary})
                need(len(data) <= 16384,'entry diagnostic cap'); sys.stderr.buffer.write(data)
            except BaseException as secondary: failure.add(secondary,'entry-diagnostic')


def controller_bootstrap(ops=None):
    """Source/mock ordered entry only; main intentionally cannot invoke this."""
    ops = BootstrapOps() if ops is None else ops
    failure = FirstFailure()
    try:
        ops.validate(); ops.enter(); ops.drop(); ops.execute()
        raise RuntimeError('entry execution unexpectedly returned')
    except BaseException as error:
        failure.add(error,'bootstrap')
        try: ops.retain(failure)
        except BaseException as secondary: failure.add(secondary,'entry-retention-wrapper')
    return failure


class LinuxChild:
    """OS edges for one fresh serial guest; controls replace every edge."""
    def __init__(self, groups, role, argv):
        self.groups, self.role, self.argv = groups, role, argv
        self.environment = dict(ENV)
        self.process, self.selector, self.descriptors = None, None, {}

    def now(self): return time.monotonic_ns()

    read_chunk_bytes=65536

    def preexec(self, identity_fd):
        self.groups.move_child(self.role, os.getpid())
        self.limits_and_identity(identity_fd)

    def limits_and_identity(self, identity_fd):
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        resource.setrlimit(resource.RLIMIT_FSIZE, (JSON_CAP, JSON_CAP))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        # Popen setsid precedes preexec. Capture identity before exec/quick exit,
        # avoiding the raced parent /proc read that old controllers encountered.
        fields = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()
        packet = struct.pack('<QQQ', os.getpid(), os.getpgrp(), int(fields[19]))
        need(os.write(identity_fd, packet) == 24, 'complete before-exec identity packet')
        os.close(identity_fd)

    def spawn(self):
        # The loop deadline cannot preempt Popen/preexec or the identity read.
        # The reviewed outer owner/job deadline is separately required, and the
        # reader grades the observed TOTAL spawn-to-reap <=120s. No hard OS
        # creation-preemption or continuous-ownership claim is made here.
        read_fd, write_fd = os.pipe2(os.O_CLOEXEC)
        first = None; identity = None
        try:
            self.process = subprocess.Popen(self.argv, cwd=Path.cwd(), env=self.environment,
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                start_new_session=True, close_fds=True, pass_fds=(write_fd,),
                preexec_fn=lambda: self.preexec(write_fd))
            # Own BOTH created streams before identity parsing, nonblocking
            # setup or selector registration can fail.
            self.descriptors = {'stdout':self.process.stdout, 'stderr':self.process.stderr}
            descriptor = write_fd; write_fd = -1
            failure = close_owned(descriptor)
            if failure is not None: raise failure
            packet = os.read(read_fd, 25)
            need(len(packet) == 24, 'exact pre-exec child identity extent')
            pid, pgid, ticks = struct.unpack('<QQQ', packet)
            need(pid == self.process.pid and pgid == pid and ticks > 0, 'fresh pre-exec process identity')
            self.selector = selectors.DefaultSelector()
            for stream, name in ((self.process.stdout, 'stdout'), (self.process.stderr, 'stderr')):
                os.set_blocking(stream.fileno(), False)
                self.selector.register(stream, selectors.EVENT_READ, name)
                self.descriptors[name] = stream
            identity = {'pid': pid, 'pgid': pgid, 'parentPid': os.getpid(), 'startTicks': ticks}
        except Exception as error: first = error
        finally:
            first = close_owned(read_fd, first, 'identity-read-pipe-close')
            if write_fd >= 0: first = close_owned(write_fd, first, 'identity-write-pipe-close')
        if first is not None: raise first
        return identity

    def read_available(self, timeout):
        chunks = []
        if self.selector is None: return chunks
        for key, _ in self.selector.select(timeout):
            try: data = os.read(key.fileobj.fileno(), self.read_chunk_bytes)
            except BlockingIOError: continue
            if data: chunks.append((key.data, data))
            else: self.selector.unregister(key.fileobj)
        return chunks

    def reap(self):
        if self.process is None: return None
        pid, status, usage = os.wait4(self.process.pid, os.WNOHANG)
        if not pid: return None
        self.process.returncode = os.waitstatus_to_exitcode(status)
        return {'waitStatus': status, 'exitCode': os.WEXITSTATUS(status) if os.WIFEXITED(status) else None,
                'signal': os.WTERMSIG(status) if os.WIFSIGNALED(status) else None,
                'rusage': {'userSeconds': usage.ru_utime, 'systemSeconds': usage.ru_stime, 'maxRssKiB': usage.ru_maxrss}}

    def kill(self): self.groups.kill_child(self.role)

    def close(self):
        failure = None
        selector, streams = self.selector, self.descriptors
        self.selector, self.descriptors = None, {}
        if selector is not None:
            try: selector.close()
            except Exception as error: failure = error
        for stream in streams.values():
            try: stream.close()
            except Exception as error:
                if failure is None: failure = error
                else: failure.ring3_secondary = getattr(failure, 'ring3_secondary', [])+[row(error, 'stream-close')]
        if failure: raise failure


class LinuxTool(LinuxChild):
    """Named discovery tools remain charged to the controller, never guests.

    PID reservation requires the selected CPython default-wait reset and a sole
    controller waiter. Reset before creation, retain it throughout the lifetime,
    and refuse a nondefault Python disposition at kill time. That last check
    alone cannot inspect SA_NOCLDWAIT. Once wait4 reaps the leader, cleanup of
    unexpected descendants belongs to the outside owner.
    """
    read_chunk_bytes=16385

    def __init__(self,groups,argv,parent):
        super().__init__(groups,'discovery',argv)
        self.parent=parent

    def spawn(self):
        # Unconditional: seeing SIG_DFL via getsignal would not exclude an
        # inherited SA_NOCLDWAIT. The admitted CPython sigaction reset clears
        # that flag. A non-main-thread/reset failure refuses before creation.
        # Do not restore the previous disposition while/after this child lives.
        signal.signal(signal.SIGCHLD,signal.SIG_DFL)
        return super().spawn()

    def preexec(self,identity_fd):
        self.groups.discovery_member(self.parent,os.getpid())
        self.limits_and_identity(identity_fd)

    def kill(self):
        if self.process is None:return
        need(type(self.process.pid) is int and self.process.pid>0 and self.process.returncode is None,
             'no discovery process-group signal after owned leader reap')
        need(signal.getsignal(signal.SIGCHLD)==signal.SIG_DFL,
             'default SIGCHLD wait policy required before discovery signal')
        os.killpg(self.process.pid,signal.SIGKILL)


class LinuxController(LinuxTool):
    """The outside owner launches only the held same-Python entry descriptor."""
    def __init__(self, bootstrap):
        need(bootstrap.owner is not None and bootstrap.groups is not None and bootstrap.invoker is not None,
             'admitted controller entry facts required')
        python = bootstrap.owner['python']['path']
        super().__init__(bootstrap.groups,[python,'-I','-B',RUN_FILE,'--bootstrap'],os.getpid())
        self.role = 'controller'
        self.environment = dict(ENV, **{name:bootstrap.environ[name] for name in
            ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},
            SUDO_UID=str(bootstrap.invoker['uid']), SUDO_GID=str(bootstrap.invoker['gid']))

    def preexec(self, identity_fd):
        # Remain outside the manual subtree. Only the held entry child may
        # migrate itself after validating the exact source/owner facts.
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
        resource.setrlimit(resource.RLIMIT_FSIZE,(JSON_CAP,JSON_CAP))
        resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
        fields = Cgroups.text(None,Path('/proc/self/stat')).rsplit(')',1)[1].split()
        packet = struct.pack('<QQQ',os.getpid(),os.getpgrp(),int(fields[19]))
        need(os.write(identity_fd,packet) == 24,'complete outside child identity packet')
        os.close(identity_fd)


def collect_child(ops, role, argv, *, profile='guest'):
    """Actual bounded orchestration, also called unmodified by inert controls."""
    need(profile in ('guest','discovery','controller','preparation'),'closed child profile')
    need(role in ('js','qemu') if profile=='guest' else role==profile,'fixed child role/profile')
    wall_ns,stream_cap=(CHILD_NS,STREAM_CAP) if profile=='guest' else (
        (10000000000,16384) if profile=='discovery' else (600000000000,16384) if profile=='controller' else (CHILD_NS,PREPARATION_STREAMS['stdout']))
    stream_caps=PREPARATION_STREAMS if profile=='preparation' else {'stdout':stream_cap,'stderr':stream_cap}
    failure = FirstFailure(); started = ops.now(); deadline = started+wall_ns
    output = {'stdout': bytearray(), 'stderr': bytearray()}
    process = {'schema': 'bw.ring3.process.v1', 'role': role, 'argv': argv,
        'cwdRole': 'checkout', 'environment': dict(getattr(ops,'environment',ENV)), 'pid': None, 'pgid': None, 'parentPid': None,
        'startTicks': None, 'spawnMonoNs': started, 'reapMonoNs': None, 'exitCode': None, 'signal': None,
        'waitStatus': None, 'timedOut': False, 'rusage': None, 'firstFailure': None, 'secondary': []}
    reaped = False; killed = False; cleanup_deadline = None

    def admit(chunks):
        for name, data in chunks:
            need(name in output and type(data) is bytes, 'closed original stream chunk')
            remaining = stream_caps[name]-len(output[name])
            output[name].extend(data[:remaining])  # preserve bounded original prefix, including on overflow
            need(len(data) <= remaining, 'original '+name+' byte cap')

    def record_terminal(terminal):
        nonlocal reaped
        process.update(terminal); process['reapMonoNs'] = ops.now(); reaped = True
        # A terminal result can already be late when first observed, including
        # after blocking creation/identity. Never signal that reaped PID.
        if process['reapMonoNs'] > deadline and not process['timedOut']:
            process['timedOut'] = True
            failure.add(TimeoutError('owned '+role+' child wall bound'),role+'-lifetime')

    try:
        process.update(ops.spawn())
        while not reaped:
            try:
                admit(ops.read_available(0.02))
                terminal = ops.reap()
                if terminal is not None:
                    record_terminal(terminal)
                    break
                now = ops.now()
                if now >= deadline and not killed:
                    process['timedOut'] = True
                    raise TimeoutError('owned '+role+' child wall bound')
                if cleanup_deadline is not None and now >= cleanup_deadline:
                    raise TimeoutError('owned child reap uncertainty after kill')
            except Exception as error:
                failure.add(error, role+'-lifetime')
                if killed: break
                try: ops.kill()
                except Exception as secondary: failure.add(secondary, role+'-owned-kill')
                killed = True; cleanup_deadline = ops.now()+DRAIN_NS
        # No dependency on pipe EOF after reaping. Drain available originals to
        # EAGAIN, with a finite iteration bound; retained grandchildren fail the
        # separate terminal cgroup census instead of hanging this reader.
        if reaped:
            for _ in range(8):
                chunks = ops.read_available(0)
                if not chunks: break
                try: admit(chunks)
                except Exception as error: failure.add(error, role+'-final-drain'); break
            else: failure.add(ValueError('post-reap drain bound'), role+'-final-drain')
            wanted = 1 if profile=='guest' and role=='qemu' else 0
            if process['exitCode'] != wanted or process['signal'] is not None:
                failure.add(ValueError('unexpected engine terminal status'), role+'-terminal')
    except Exception as error:
        failure.add(error, role+'-spawn')
        # Spawn may have created the process before identity/FD registration
        # failed. Cleanup is scoped to the already admitted owned leaf.
        try: ops.kill()
        except Exception as secondary: failure.add(secondary, role+'-owned-kill')
        # Creation may succeed before later identity/FD setup refuses. A single
        # WNOHANG call is not a reap guarantee; boundedly observe owned cleanup.
        cleanup_end = ops.now()+DRAIN_NS
        for _ in range(128):
            try:
                terminal = ops.reap()
                if terminal is not None:
                    record_terminal(terminal); break
                if ops.now() >= cleanup_end: break
                admit(ops.read_available(0.02))
            except Exception as secondary:
                failure.add(secondary, role+'-reap'); break
        if not reaped: failure.add(TimeoutError('owned spawn-failure reap uncertainty'), role+'-reap')
    finally:
        try: ops.close()
        except Exception as error: failure.add(error, role+'-stream-close')
    if not reaped and failure.first is None:
        failure.add(ValueError('unreaped owned child'), role+'-reap')
    process['firstFailure'], process['secondary'] = failure.first, failure.secondary
    return process, {name: bytes(data) for name, data in output.items()}


class OutsideOwner:
    """Privileged observer; no probes, guest parsing or archive handling.

    Internal observations are not positive packet roles. The actual command
    remains closed, and a job backstop for blocking operations is not wired.
    """
    def __init__(self, bootstrap=None):
        self.bootstrap = BootstrapOps() if bootstrap is None else bootstrap
        self.child = None; self.admitted = False; self.partial = {}; self.last_finish = self.last_finish_failure = None

    def outside(self):
        text = entry_proc('/proc/self/cgroup')
        need(text.startswith('0::/') and text.endswith('\n') and text.count('\n') == 1,
             'outside unified cgroup membership')
        membership = text[3:-1]
        root = '/'+self.bootstrap.groups.root.name
        need(membership != root and not membership.startswith(root+'/'), 'observer must remain outside owned subtree')
        return text

    def validate(self):
        self.bootstrap.validate()  # Reads only; root parent never enters/drops here.
        self.outside()
        self.admitted = True

    def create_child(self):
        need(self.admitted, 'outside owner not admitted')
        self.outside()
        self.child = LinuxController(self.bootstrap)
        return self.child

    def census(self):
        self.partial = {}
        for role in ('enclosing','controller','js','qemu'):
            value = self.bootstrap.groups.observe(role)
            self.partial[role] = value  # Preserve original partial observations on refusal.
            need(value['identity'] == self.bootstrap.owner['cgroups'][role]['identity'],
                 'outside observed cgroup identity drift')
        return self.partial

    def kill_enclosing(self):
        self.outside()
        path = self.bootstrap.groups.path('enclosing')
        need(self.bootstrap.groups.identities['enclosing'] == self.bootstrap.owner['cgroups']['enclosing']['identity'],
             'owned enclosing identity required before cleanup')
        directory = os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
        first = None; descriptor = None
        try:
            info = os.fstat(directory)
            need(stat.S_ISDIR(info.st_mode) and {'device':info.st_dev,'inode':info.st_ino} ==
                 self.bootstrap.owner['cgroups']['enclosing']['identity'] and
                 (info.st_uid,info.st_gid) == (self.bootstrap.invoker['uid'],self.bootstrap.invoker['gid']),
                 'held enclosing directory identity and owner required')
            descriptor = os.open('cgroup.kill',os.O_WRONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
            need(os.write(descriptor,b'1') == 1,'complete owned enclosing cleanup write')
        except Exception as error: first = error
        finally:
            if descriptor is not None: first = close_owned(descriptor,first,'outside-cleanup-close')
            first = close_owned(directory,first,'outside-directory-close')
        if first is not None: raise first

    def now(self): return time.monotonic_ns()
    def pause(self): time.sleep(0.02)

    def finish(self, process):
        """Always attempted by the wrapper; successful cleanup never erases a defect."""
        failure = FirstFailure()
        facts = {'beforeCleanup':None,'afterCleanup':None,'sessionSignalAttempted':False,
                 'cgroupKillAttempted':False,'cleanupTerminal':None,'polls':0}
        self.last_finish = facts
        self.last_finish_failure = failure
        if not self.admitted:
            failure.add(ValueError('outside ownership not established; cleanup unavailable'),'outside-ownership')
            return facts,failure
        outside_ok = False; before_empty = False
        try: self.outside(); outside_ok = True
        except Exception as error: failure.add(error,'outside-membership')
        try:
            facts['beforeCleanup'] = self.census()
            for value in facts['beforeCleanup'].values(): entry_empty(value)
            before_empty = True
        except Exception as error:
            facts['beforeCleanup'] = self.partial
            failure.add(error,'outside-precleanup-census')
        terminal_known = process is not None and process['waitStatus'] is not None
        if not terminal_known:
            failure.add(ValueError('controller terminal status unknown before cleanup'),'outside-terminal')
        if not terminal_known and self.child is not None and self.child.process is not None and self.child.process.returncode is None:
            facts['sessionSignalAttempted'] = True
            try: self.child.kill()  # Guarded default-wait, fresh unreaped leader only.
            except Exception as error: failure.add(error,'outside-session-kill')
        if not before_empty and outside_ok:
            facts['cgroupKillAttempted'] = True
            try: self.kill_enclosing()
            except Exception as error: failure.add(error,'outside-enclosing-kill')
        deadline = self.now()+DRAIN_NS
        for attempt in range(128):
            facts['polls'] = attempt+1
            if not terminal_known and self.child is not None and self.child.process is not None and self.child.process.returncode is None:
                try:
                    terminal = self.child.reap()
                    if terminal is not None:
                        facts['cleanupTerminal'] = dict(terminal,reapMonoNs=self.now()); terminal_known = True
                except Exception as error: failure.add(error,'outside-cleanup-reap')
            empty = False
            try:
                facts['afterCleanup'] = self.census()
                for value in facts['afterCleanup'].values(): entry_empty(value)
                empty = True
            except Exception as error:
                facts['afterCleanup'] = self.partial
                failure.add(error,'outside-postcleanup-census')
            if empty and terminal_known: break
            if self.now() >= deadline: break
            self.pause()
        else: failure.add(TimeoutError('outside cleanup census iteration bound'),'outside-cleanup')
        if not empty or not terminal_known:
            failure.add(TimeoutError('outside cleanup emptiness or reap unestablished'),'outside-cleanup')
        try: self.outside()
        except Exception as error: failure.add(error,'outside-final-membership')
        return facts,failure

    def retain(self, failure, facts, streams):
        try:
            need(self.bootstrap.invoker is not None,'trusted invoker unavailable for outside retention')
            self.bootstrap.drop()  # All observation/cleanup precedes this irreversible drop.
            entry_ids(self.bootstrap.invoker['uid'],self.bootstrap.invoker['gid'])
            def write(errors):
                value = dict(facts,**errors,streamsHex={name:data.hex() for name,data in streams.items()})
                write_new(PACKET/'.outside.json',encode(value),JSON_CAP)
            retain_failure(failure,write,lambda data:sys.stderr.buffer.write(data))
        except BaseException as error:
            failure.add(error,'outside-retention')
            try:
                data=encode({'firstFailure':failure.first,'secondary':failure.secondary})
                need(len(data)<=16384,'outside diagnostic cap');sys.stderr.buffer.write(data)
            except BaseException as secondary: failure.add(secondary,'outside-diagnostic')


def outside_controller(ops=None):
    """Dedicated fixed observer slice; deliberately not reachable from main."""
    ops = OutsideOwner() if ops is None else ops
    failure = FirstFailure(); process = None; streams = {'stdout':b'','stderr':b''}
    facts = {'process':None,'cleanup':None}
    try:
        ops.validate()
        child = ops.create_child()
        process,streams = collect_child(child,'controller',child.argv,profile='controller')
        facts['process'] = process
        failure.adopt(process['firstFailure'],process['secondary'])
    except BaseException as error: failure.add(error,'outside-controller')
    finally:
        try:
            facts['cleanup'],cleanup_failure = ops.finish(process)
            failure.adopt(cleanup_failure.first,cleanup_failure.secondary)
        except BaseException as error:
            facts['cleanup'] = getattr(ops,'last_finish',None)
            earlier = getattr(ops,'last_finish_failure',None)
            if isinstance(earlier,FirstFailure): failure.adopt(earlier.first,earlier.secondary)
            failure.add(error,'outside-finish')
        try: ops.retain(failure,facts,streams)
        except BaseException as error: failure.add(error,'outside-retention-wrapper')
    return facts,failure


class RuntimeProbeCallback:
    """Only the eleven fixed runtime observations; no arbitrary command API.

    Transient process facts/partial streams stay available on this owner even
    when the six-field runtime row refuses. No actual command calls this yet.
    """
    def __init__(self,groups,files,factory=None):
        self.groups,self.files,self.parent=groups,files,os.getpid()
        self.factory=factory if factory is not None else lambda argv:LinuxTool(groups,argv,self.parent)
        self.last_process=None
        self.last_census=None

    def argv(self,role):
        if role in ('node-version','python-version','qemu-version'):
            name=role[:-8];path,_=self.files.resolve(RUNTIME_EXECUTABLES[name])
            return [path,'--version']
        if role in ('ldd-node','ldd-python','ldd-qemu'):
            path,_=self.files.resolve(RUNTIME_EXECUTABLES[role[4:]])
            return ['/usr/bin/ldd',path]
        if role=='ldd-shell':return ['/usr/bin/ldd','/usr/bin/bash']
        if role=='ldd-dpkg-query':return ['/usr/bin/ldd','/usr/bin/dpkg-query']
        if role=='ldd-tcg':
            path,_=self.files.resolve(TCG_MODULE)
            return ['/usr/bin/ldd',path]
        if role=='package-version':return ['/usr/bin/dpkg-query','-W','-f=${Package}\t${Version}\t${Architecture}\n',*PACKAGE_NAMES]
        if role=='package-files':return ['/usr/bin/dpkg-query','-L',*PACKAGE_NAMES]
        raise ValueError('unadmitted runtime observation role')

    def __call__(self,role,argv):
        failure=FirstFailure();attempted=False
        original={'role':role,'argv':argv,'environment':dict(ENV),'exitCode':None,'stdout':'','stderr':''}
        self.last_process=None;self.last_census=None
        try:
            need(type(argv) is list and argv==self.argv(role),'exact named runtime observation argv')
            self.last_census=self.groups.discovery_idle(self.parent)
            attempted=True
            process,streams=collect_child(self.factory(argv),'discovery',argv,profile='discovery')
            self.last_process=process
            failure.adopt(process['firstFailure'],process['secondary'])
            original['exitCode']=process['exitCode']  # None stays unknown, never fabricated as zero.
            for name in ('stdout','stderr'):
                try:original[name]=streams[name].decode('utf-8')
                except UnicodeDecodeError as error:
                    original[name]=streams[name].decode('utf-8','surrogateescape')
                    failure.add(error,'runtime-probe-'+name+'-encoding')
            if original['stderr']:failure.add(ValueError('unexpected runtime probe stderr'),'runtime-probe-stderr')
        except Exception as error:failure.add(error,'runtime-probe-callback')
        finally:
            if attempted:
                try:self.last_census=self.groups.discovery_idle(self.parent)
                except Exception as error:
                    self.last_census=getattr(self.groups,'last_discovery_census',None)
                    failure.add(error,'runtime-probe-controller-census')
        return original,failure


def controller_runtime_discovery(groups):
    """Real callback wiring, still behind the deliberately closed actual entry."""
    files=RuntimeFiles()
    return RuntimeDiscovery(files,RuntimeProbeCallback(groups,files))


def run_serial(roles, execute, retain, terminal, failure):
    """First child failure wins before any fallible retention/terminal read."""
    need(tuple(roles) == ('js', 'qemu'), 'fixed JS then QEMU order')
    for role in roles:
        process, streams = execute(role)
        failure.adopt(process['firstFailure'], process['secondary'])
        try: retain(role, process, streams)
        except Exception as error: failure.add(error, role+'-retention')
        try: terminal(role)
        except Exception as error: failure.add(error, role+'-terminal-census')
        if failure.first is not None: break
    return failure


ROM_SHA = 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529'
FIXTURE_JSON_SHA = '5784090f18b0c114e5723ea9234173c040a0d290d94c0211b99b12b1161cd670'
# Separately held launch descriptor. Production never imports the reader.
JS_DRIVER = """import {writeFileSync as w} from 'node:fs';
import {executeFixture} from './scripts/i80386-ring3-int-iret/probe.mjs';
const r=await executeFixture(),p='build/i80386-ring3-int-iret/js/';
for(const [n,v] of Object.entries({'report.json':r.report,'observations.json':r.observations,'writes.json':r.writes}))w(p+n,JSON.stringify(v)+'\\n',{flag:'wx'});
w(p+'memory.before.bin',r.memoryBefore,{flag:'wx'});w(p+'memory.after.bin',r.memoryAfter,{flag:'wx'});
process.stdout.write(r.stdout);process.exitCode=r.report.firstFailure?1:0;
"""


def guest_argv(role, runtime):
    need(role in ('js','qemu'),'fixed serial guest descriptor')
    if role == 'js':return [runtime['executables']['node']['path'],'--input-type=module','--eval',JS_DRIVER]
    return [runtime['executables']['qemu']['path'], '-no-user-config', '-nodefaults', '-machine', 'pc', '-accel', 'tcg', '-cpu', '486',
        '-m', '16M', '-bios', PACKET.as_posix()+'/inputs/fixture.rom', '-display', 'none', '-serial', 'none',
        '-monitor', 'none', '-nic', 'none', '-vga', 'none', '-debugcon', 'stdio', '-global',
        'isa-debugcon.iobase=0xe9', '-device', 'isa-debug-exit,iobase=0xf4,iosize=0x04', '-no-reboot', '-no-shutdown']


def source_facts(template, read=None, *, stage='after'):
    """All twelve actual files; HEAD/tree are prepared bindings, not fresh Git observations."""
    need(stage in ('before','after'),'fixed live source stage')
    read = (lambda path:bounded_read(path,4<<20,with_mode=True)) if read is None else read
    result = {'schema':'bw.ring3.source.v1','head':template['head'],'tree':template['tree'],'files':{}}
    failure = FirstFailure()
    for path in sorted(SOURCE_PATHS):
        try:
            data,mode = read(path)
            need(type(data) is bytes and len(data)<=4<<20 and mode in ('100644','100755'),'bounded actual source read')
            result['files'][path] = {'bytes':len(data),'sha256':sha(data),'mode':mode,
                'blob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}
        except Exception as error:
            result['files'][path] = {'firstFailure':row(error,'source-'+stage+'-file')}
            failure.add(error,'source-'+stage+'-file')
    if result != template and failure.first is None:
        failure.add(ValueError('actual source bytes or mode changed '+stage),'source-'+stage+'-drift')
    return result,failure


def input_facts(template=None, read=None):
    read=bounded_read if read is None else read
    originals = {}; failure = FirstFailure()
    for name,cap in (('fixture.rom',65536),('fixture.json',JSON_CAP)):
        try:
            data=read(PACKET/'inputs'/name,cap);originals[name]=data
            if name=='fixture.rom':need(len(data)==65536 and sha(data)==ROM_SHA,'frozen authored ROM input')
            else:need(sha(encode(entry_json(data))[:-1])==FIXTURE_JSON_SHA,'frozen entire fixture metadata')
        except Exception as error:failure.add(error,'input-'+name)
    if template is not None and originals != template:
        failure.add(ValueError('actual fixture input readback changed'),'input-drift')
    return originals,failure


class ControllerOps:
    """Unprivileged serial source slice. Actual mode and final packet remain closed."""
    JS_FILES = ('report.json','observations.json','writes.json','memory.before.bin','memory.after.bin')

    def __init__(self,environ=None):
        self.environ=dict(os.environ if environ is None else environ)
        self.bootstrap=BootstrapOps(self.environ);self.groups=None;self.unprivileged=False;self.paths_admitted=False
        self.source_before={'schema':'bw.ring3.source.v1','head':self.environ.get('BW_EXPECTED_HEAD'),
                            'tree':self.environ.get('BW_EXPECTED_TREE'),'files':{}}
        self.source_after=None;self.inputs_before={};self.inputs_after={}
        self.plan=None;self.runtime_before=None;self.runtime_after=None
        self.before=None;self.last_census={};self.barrier_facts={};self.raw_js={};self.processes={};self.streams={}
        self.child_factory=LinuxChild

    def admit(self):
        uid,gid=os.getresuid()[0],os.getresgid()[0]
        need(uid>0 and gid>0,'controller must be unprivileged');entry_ids(uid,gid)
        self.unprivileged=True
        root=expected_cgroup(self.environ);checkout=Path.cwd()
        for directory in (checkout,checkout/'build',checkout/PACKET,*[checkout/PACKET/name for name in ('inputs','js','qemu')]):
            info=directory.lstat()
            need(directory.resolve(strict=True)==directory and stat.S_ISDIR(info.st_mode) and
                 (info.st_uid,info.st_gid)==(uid,gid),'canonical controller preparation directories')
        self.paths_admitted=True
        owner=entry_json(bounded_read(ENTRY_FILE,JSON_CAP))
        need(type(owner) is dict and set(owner)=={'schema','uid','gid','root','sourceSha256','python','cgroups'} and
             owner['schema']=='bw.ring3.entry.v1' and type(owner['uid']) is int and type(owner['gid']) is int and
             (owner['uid'],owner['gid'])==(uid,gid) and owner['root']==str(root),'controller prepared entry binding')
        need(set(owner['cgroups'])=={'enclosing','controller','js','qemu'},'four prepared controller groups')
        for value in owner['cgroups'].values():entry_snapshot(value)
        self.bootstrap.owner=owner;self.bootstrap.invoker={'uid':uid,'gid':gid}
        self.groups=self.bootstrap.groups=Cgroups(root,uid,self.environ)
        self.bootstrap.entered()
        raw=bounded_read(PACKET/'source.before.json',JSON_CAP);source=entry_json(raw)
        need(type(source) is dict and set(source)=={'schema','head','tree','files'} and
             source['schema']=='bw.ring3.source.v1' and sha(raw)==owner['sourceSha256'] and
             source['head']==self.environ.get('BW_EXPECTED_HEAD') and source['tree']==self.environ.get('BW_EXPECTED_TREE') and
             all(re.fullmatch('[0-9a-f]{40}',str(source[k])) for k in ('head','tree')) and
             set(source['files'])==SOURCE_PATHS,'prepared source12 envelope binding')
        self.source_before=source  # Existing source.before is never rewritten.
        checked,failure=source_facts(source,stage='before');self.barrier_facts['admitSource']=checked
        self.inputs_before,input_failure=input_facts();failure.adopt(input_failure.first,input_failure.secondary)
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)

    def discover(self):
        self.plan=controller_runtime_discovery(self.groups)
        self.runtime_before=self.plan.discover()  # Exactly one discovery; AFTER never reruns its probes.

    def census(self):
        result=self.last_census={};pid=os.getpid()
        for role in ('enclosing','controller','js','qemu'):
            value=self.groups.observe(role);result[role]=value
            need(value['identity']==self.bootstrap.owner['cgroups'][role]['identity'],'controller cgroup identity drift')
            active=role in ('enclosing','controller')
            need(value['procs']==([pid] if role=='controller' else []) and value['raw']['pidsCurrent'].strip()==str(int(active)) and
                 'populated '+str(int(active)) in value['raw']['cgroupEvents'].splitlines(),'controller-only BEFORE/serial census')
        return result

    def barrier(self):
        failure=FirstFailure()
        for name,observe in (
            ('source',lambda:source_facts(self.source_before,stage='before')),
            ('inputs',lambda:input_facts(self.inputs_before)),
            ('runtime',lambda:runtime_facts(self.runtime_before,RuntimeFiles().read,RuntimeFiles().alias,stage='before-guests'))):
            try:
                value,found=observe();self.barrier_facts[name]=value;failure.adopt(found.first,found.secondary)
            except Exception as error:failure.add(error,'barrier-'+name)
        try:self.before=self.census()
        except Exception as error:
            self.before=self.last_census
            failure.add(error,'barrier-census')
        # Every BEFORE observation/retention finishes before any guest factory.
        for path,value in ((PACKET/'runtime.before.json',self.runtime_before),
                           (PACKET/'.controller.before.json',{'pid':os.getpid(),'before':self.before})):
            try:write_new(path,encode(value),JSON_CAP)
            except Exception as error:failure.add(error,'barrier-retention')
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)

    def execute_guest(self,role):
        self.census()
        argv=guest_argv(role,self.runtime_before)
        return collect_child(self.child_factory(self.groups,role,argv),role,argv)

    def retain_guest(self,role,process,streams):
        self.processes[role]=process;self.streams[role]=streams
        failure=FirstFailure()
        for name,original,cap in (('process.json',process,JSON_CAP),('stdout',streams['stdout'],STREAM_CAP),('stderr',streams['stderr'],STREAM_CAP)):
            try:
                data=encode(original) if name=='process.json' else original
                write_new(PACKET/role/name,data,cap)
            except Exception as error:failure.add(error,role+'-retention')
        if role=='js':
            for name in self.JS_FILES:
                try:
                    cap=1<<20 if name.endswith('.bin') else JSON_CAP
                    data=bounded_read(PACKET/'js'/name,cap);self.raw_js[name]=data
                    need(len(data)==cap if name.endswith('.bin') else len(data)>0,'original JS role extent')
                except Exception as error:failure.add(error,'js-original-'+name)
            if 'report.json' in self.raw_js:
                try:
                    report=entry_json(self.raw_js['report.json'])
                    need(type(report) is dict and report.get('schema')=='bw.ring3.js-probe.v1' and 'firstFailure' in report,'original JS report envelope')
                    if report['firstFailure'] is not None:
                        primary=report['firstFailure']
                        need(type(primary) is dict and all(type(primary.get(k)) is str for k in ('phase','name','message')),'original JS error row')
                        failure.adopt(primary,[])
                except Exception as error:failure.add(error,'js-report-original')
        else:
            report={'schema':'bw.ring3.qemu.v1','fixtureSha256':ROM_SHA,'outputSha256':sha(streams['stdout']),
                    'firstFailure':process['firstFailure'],'secondary':process['secondary']}
            try:write_new(PACKET/'qemu/report.json',encode(report),JSON_CAP)
            except Exception as error:failure.add(error,'qemu-report-retention')
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)

    def terminal_guest(self,role):self.census()  # This is not the final outside AFTER census.

    def after_all(self,failure):
        if not self.unprivileged or not self.paths_admitted:return
        for name,observe in (
            ('source',lambda:source_facts(self.source_before)),
            ('inputs',lambda:input_facts(self.inputs_before)),
            ('runtime',lambda:runtime_facts(self.runtime_before or self.plan.originals(),RuntimeFiles().read,RuntimeFiles().alias))):
            try:
                value,found=observe();setattr(self,name+'_after',value);failure.adopt(found.first,found.secondary)
                if name!='inputs':write_new(PACKET/(name+'.after.json'),encode(value),JSON_CAP)
            except Exception as error:failure.add(error,'controller-after-'+name)

    def retain_control(self,failure):
        if not self.unprivileged or not self.paths_admitted:return
        def references(values):return {name:{'bytes':len(data),'sha256':sha(data)} for name,data in values.items()}
        facts={'pid':os.getpid(),'before':self.before,'barrier':{key:value for key,value in self.barrier_facts.items() if key!='inputs'},
               'inputsBefore':references(self.inputs_before),'inputsAfter':references(self.inputs_after),
               'barrierInputs':references(self.barrier_facts.get('inputs',{})),
               'lastCensus':self.last_census,'jsOriginals':references(self.raw_js),'processes':self.processes}
        retain_failure(failure,lambda errors:write_new(PACKET/'.controller.json',encode(dict(facts,**errors)),JSON_CAP),
                       lambda data:sys.stderr.buffer.write(data))


def controller_execute(ops=None):
    """Serial execution glue only; no actual CLI or packet finalization entry."""
    ops=ControllerOps() if ops is None else ops;failure=FirstFailure()
    try:
        ops.admit();ops.discover();ops.barrier()
        run_serial(('js','qemu'),ops.execute_guest,ops.retain_guest,ops.terminal_guest,failure)
    except BaseException as error:failure.add(error,'controller-execution')
    finally:
        try:ops.after_all(failure)
        except BaseException as error:failure.add(error,'controller-after-wrapper')
        try:ops.retain_control(failure)
        except BaseException as error:failure.add(error,'controller-retention-wrapper')
    return ops,failure


PACKET_ROLES = frozenset(('audit.json source.before.json source.after.json runtime.before.json '
    'runtime.after.json inputs/fixture.rom inputs/fixture.json resources.json '
    'js/report.json js/observations.json js/writes.json js/memory.before.bin '
    'js/memory.after.bin js/stdout js/stderr js/process.json qemu/report.json '
    'qemu/stdout qemu/stderr qemu/process.json').split())
AUDIT_CAPS = {'packetBytes':16<<20,'jsonBytes':1<<20,'streamBytes':128<<10,'ramBytes':1<<20,
    'romBytes':65536,'calls':2000000,'childMs':120000,'controllerMs':600000,'jobMinutes':15,'writes':4096}
INTERNAL_NAMES = ('.entry.json','.controller.before.json','.controller.json','.outside.json','.entry-failure.json')
EXPORT = Path('build/i80386-ring3-int-iret-export')
GIT_TRACE_CAP = 256<<10


def final_json(raw):
    """Internal process facts include finite rusage floats; duplicates never pass."""
    def pairs(values):
        result={}
        for key,value in values:
            need(key not in result,'duplicate finalization JSON key');result[key]=value
        return result
    def number(token):
        value=float(token);need(-float('inf')<value<float('inf'),'finite finalization number');return value
    def reject(token):raise ValueError('nonfinite finalization JSON')
    need(len(raw)<=JSON_CAP,'bounded finalization JSON')
    return json.loads(raw,object_pairs_hook=pairs,parse_float=number,parse_constant=reject)


def same_json(left,right):
    """Canonical JSON joins preserve number types; bool/int/float aliases differ."""
    return encode(left)==encode(right)


def role_cap(name):
    need(name in PACKET_ROLES,'closed original role name')
    return JSON_CAP if name.endswith('.json') else 1<<20 if name.endswith('.bin') else 65536 if name.endswith('.rom') else STREAM_CAP


def emit_originals(originals, emit, failure, flush):
    """Exact raw originals in bounded official-log chunks, never a packet role.

    Progress is retained on a short/failed emission. No retry/completion claim
    is made after a partial line; original owned files remain untouched.
    """
    progress={'items':0,'chunks':0,'encodedBytes':0,'complete':False}
    emitted_all=False;flushed=False
    try:
        allowed=set(INTERNAL_NAMES)|{'git.before.json','git.after.json','preparation.phase.json','generation.phase.json','launch-plan.original.json'}
        need(set(originals)<=allowed,'closed log-original names')
        need(sum(len(data) for data in originals.values())<=5<<20,'aggregate raw log-original cap')
        for name in sorted(originals):
            raw=originals[name];cap=GENERATION_CAP if name=='generation.phase.json' else GIT_TRACE_CAP if name.startswith('git.') else JSON_CAP
            need(type(raw) is bytes and len(raw)<=cap,'individual log-original cap')
            encoded=base64.b64encode(raw).decode('ascii');count=max(1,(len(encoded)+3071)//3072)
            need(count<=456,'finite original chunk count')
            for index in range(count):
                line=b'RING3_ORIGINAL '+encode({'name':name,'index':index,'count':count,'bytes':len(raw),
                    'sha256':sha(raw),'data':encoded[index*3072:(index+1)*3072]})
                need(progress['encodedBytes']+len(line)<=8<<20 and progress['chunks']<2600,'encoded log-original cap')
                written=emit(line)
                need(type(written) is int and written==len(line),'complete original log-line emission')
                progress['encodedBytes']+=len(line);progress['chunks']+=1
            progress['items']+=1
        emitted_all=True
    except BaseException as error:failure.add(error,'original-log-retention')
    finally:
        try:flush();flushed=True
        except BaseException as error:failure.add(error,'original-log-flush')
    progress['complete']=emitted_all and flushed
    return progress


def outside_unprivileged(environ):
    uid,gid=os.getresuid()[0],os.getresgid()[0]
    need(uid>0 and gid>0,'finalization requires an unprivileged invoker');entry_ids(uid,gid)
    root=expected_cgroup(environ);text=entry_proc('/proc/self/cgroup')
    need(text.startswith('0::/') and text.endswith('\n') and text.count('\n')==1 and
         text[3:-1]!='/'+root.name and not text[3:-1].startswith('/'+root.name+'/'),
         'unprivileged finalizer must be outside manual subtree')
    checkout=Path.cwd()
    for directory in (checkout,checkout/'build',checkout/PACKET):
        info=directory.lstat()
        need(directory.resolve(strict=True)==directory and stat.S_ISDIR(info.st_mode) and
             (info.st_uid,info.st_gid)==(uid,gid),'canonical unprivileged finalizer directories')
    return uid,gid


class OutsideGit(LinuxTool):
    """Only fixed local Git metadata; outside the guest runtime.v2 graph."""
    def __init__(self,argv):
        super().__init__(None,argv,os.getpid())
    preexec=LinuxController.preexec  # Finite identity/limits, no manual-cgroup migration.


class GitObservation:
    def __init__(self,environ,phase,factory=None):
        need(phase in ('before','after'),'fixed outside Git phase')
        self.environ=dict(environ);self.phase=phase;self.factory=OutsideGit if factory is None else factory
        git=['git','--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
        self.allowed=[git+['rev-parse','HEAD'],git+['rev-parse','HEAD^{tree}'],git+['ls-tree','-r','HEAD','--',*sorted(SOURCE_PATHS)]]
        self.commands=[]

    def command(self,argv,cap):
        outside_unprivileged(self.environ)
        need(argv in self.allowed and len(self.commands)<3,'three exact outside Git descriptors')
        actual=['/usr/bin/git',*argv[1:]]
        process,streams=collect_child(self.factory(actual),'discovery',actual,profile='discovery')
        self.commands.append({'process':process,'stdoutHex':streams['stdout'].hex(),'stderrHex':streams['stderr'].hex()})
        need(len(encode(self.commands))<=GIT_TRACE_CAP,'bounded outside Git trace')
        if process['firstFailure'] is not None:raise ObservedFailure(process['firstFailure'],process['secondary'])
        need(streams['stderr']==b'' and len(streams['stdout'])<=cap,'outside Git original output bounds')
        return streams['stdout']

    def capture(self,head):
        failure=FirstFailure();source=None
        try:source=capture_source(head,self.command,read=bounded_read)
        except BaseException as error:failure.add(error,'outside-git-'+self.phase)
        raw=encode({'schema':'bw.ring3.git.v1','phase':self.phase,'source':source,'commands':self.commands,
                    'firstFailure':failure.first,'secondary':failure.secondary})
        need(len(raw)<=GIT_TRACE_CAP,'complete outside Git trace cap')
        return raw,failure


def require_fields(value,names,message):
    need(type(value) is dict and set(value)==set(names.split()),message)


def finalizer_tree():
    """Four fixed directories only; no recursive discovery or hidden-file fallback."""
    allowed=set(PACKET_ROLES)|set(INTERNAL_NAMES)
    for suffix in ('','inputs','js','qemu'):
        directory=PACKET/suffix
        count=0
        for path in directory.iterdir():
            count+=1;need(count<=32,'finite finalization directory census')
            relative=path.relative_to(PACKET).as_posix();info=path.lstat()
            if relative in ('inputs','js','qemu'):
                need(stat.S_ISDIR(info.st_mode) and path.resolve(strict=True)==Path.cwd()/path,'fixed packet directory')
            else:
                need(relative not in ('audit.json','resources.json'),'stale derived finalization product')
                need(relative in allowed and stat.S_ISREG(info.st_mode),'unknown or nonregular packet path')


def read_final_original(name,cap):
    need(name in PACKET_ROLES or name in INTERNAL_NAMES,'fixed original read allowlist')
    path=PACKET/name
    need(path.resolve(strict=True)==Path.cwd()/path and stat.S_ISREG(path.lstat().st_mode),'canonical regular finalization original')
    return bounded_read(path,cap)


def check_git_trace(raw,phase,source,outer):
    need(type(raw) is bytes and len(raw)<=GIT_TRACE_CAP,'required bounded original Git trace')
    trace=final_json(raw)
    require_fields(trace,'schema phase source commands firstFailure secondary','closed original Git trace')
    need(trace['schema']=='bw.ring3.git.v1' and trace['phase']==phase and same_json(trace['source'],source) and
         trace['firstFailure'] is None and trace['secondary']==[] and type(trace['commands']) is list and len(trace['commands'])==3,
         'fresh successful original Git observation')
    descriptors=GitObservation({},phase).allowed
    previous=0;outputs=[]
    for command,argv in zip(trace['commands'],descriptors):
        require_fields(command,'process stdoutHex stderrHex','closed Git command original')
        process=command['process']
        require_fields(process,'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary','closed original Git process')
        need(process['schema']=='bw.ring3.process.v1' and process['cwdRole']=='checkout' and
             all(type(process[key]) is int and process[key]>0 for key in ('pid','pgid','parentPid','startTicks')) and process['pid']==process['pgid'] and
             same_json(process['argv'],['/usr/bin/git',*argv[1:]]) and same_json(process['environment'],ENV) and process['role']=='discovery' and
             process['firstFailure'] is None and process['secondary']==[] and process['timedOut'] is False and
             type(process['waitStatus']) is int and process['waitStatus']==0 and type(process['exitCode']) is int and process['exitCode']==0 and
             process['signal'] is None,'original finite Git terminal facts')
        start,end=process['spawnMonoNs'],process['reapMonoNs']
        need(type(start) is int and type(end) is int and previous<=start<=end and end-start<=10000000000,'finite ordered Git originals')
        previous=end
        need(end<=outer['spawnMonoNs'] if phase=='before' else start>=outer['reapMonoNs'],'PRE/POST Git chronology')
        need(type(command['stdoutHex']) is str and len(bytes.fromhex(command['stdoutHex']))<=16384 and command['stderrHex']=='','Git raw original extent')
        outputs.append(bytes.fromhex(command['stdoutHex']))
    need(outputs[0].strip().decode()==source['head'] and outputs[1].strip().decode()==source['tree'],'raw Git HEAD/tree source join')
    listing={}
    for line in outputs[2].decode().splitlines():
        metadata,path=line.split('\t');mode,kind,blob=metadata.split()
        need(path in SOURCE_PATHS and path not in listing and kind=='blob','closed original Git tree rows')
        listing[path]=(mode,blob)
    need(set(listing)==SOURCE_PATHS and all(listing[path]==(source['files'][path]['mode'],source['files'][path]['blob']) for path in listing),
         'raw Git tree/source mode and blob joins')
    return trace


def check_preparation_original(raw,pre_git,outside_result,entry,environ):
    """Unprivileged joins of frozen preparation originals; no expected oracle.

    External source, runtime and sibling identity admission remains separate.
    The root parent never uses this parser on the opaque PRE body.
    """
    need(type(raw) is bytes and 0<len(raw)<=JSON_CAP,'bounded frozen preparation original')
    value=final_json(raw)
    require_fields(value,'schema runId attempt head tree python invoker captureMonoNs process stdout stderr ownership preGit firstFailure secondary',
                   'closed preparation original')
    need(raw==encode(value) and value['schema']=='bw.ring3.preparation-original.v1' and
         value['runId']==environ['GITHUB_RUN_ID'] and re.fullmatch('[1-9][0-9]*',value['runId']) is not None and
         type(value['attempt']) is int and value['attempt']==1 and environ['GITHUB_RUN_ATTEMPT']=='1' and
         value['head']==environ['BW_EXPECTED_HEAD'] and value['tree']==environ['BW_EXPECTED_TREE'] and
         same_json(value['python'],entry['python']) and same_json(value['invoker'],{'uid':entry['uid'],'gid':entry['gid']}) and
         value['firstFailure'] is None and value['secondary']==[], 'preparation source/invoker/error joins')
    streams={}
    for name in ('stdout','stderr'):
        item=value[name];require_fields(item,'bytes sha256 base64','closed preparation stream original')
        need(type(item['bytes']) is int and 0<=item['bytes']<=PREPARATION_STREAMS[name] and
             type(item['base64']) is str,'bounded preparation stream encoding')
        data=base64.b64decode(item['base64'],validate=True)
        need(base64.b64encode(data).decode('ascii')==item['base64'] and len(data)==item['bytes'] and
             sha(data)==item['sha256'],'preparation stream original extent/hash')
        streams[name]=data
    need(streams['stderr']==b'' and preparation_body(streams['stdout'])==pre_git and
         same_json(value['preGit'],{'bytes':len(pre_git),'sha256':sha(pre_git)}),'original PRE framed-body join')
    process=value['process'];outer=outside_result['process']
    require_fields(process,'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary',
                   'closed preparation process original')
    need(process['schema']=='bw.ring3.process.v1' and process['role']=='preparation' and process['cwdRole']=='checkout' and
         all(type(process[key]) is int and process[key]>0 for key in ('pid','pgid','parentPid','startTicks')) and
         process['pid']==process['pgid'] and type(outer['parentPid']) is int and process['parentPid']==outer['parentPid'] and
         same_json(process['argv'],[entry['python']['path'],'-I','-B',RUN_FILE,'--prepare']) and
         same_json(process['environment'],dict(ENV,**{name:environ[name] for name in
            ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},SUDO_UID=str(entry['uid']),SUDO_GID=str(entry['gid']))) and
         process['timedOut'] is False and type(process['exitCode']) is int and process['exitCode']==0 and
         type(process['waitStatus']) is int and process['waitStatus']==0 and process['signal'] is None and
         process['firstFailure'] is None and process['secondary']==[],'natural preparation descriptor/parent terminal joins')
    start,end,captured=process['spawnMonoNs'],process['reapMonoNs'],value['captureMonoNs']
    need(all(type(item) is int for item in (start,end,captured,outer['spawnMonoNs'])) and
         0<start<=end<=captured<=outer['spawnMonoNs'] and end-start<=120000000000,'preparation/capture/outside interval chain')
    trace=final_json(pre_git)
    need(type(trace.get('commands')) is list and len(trace['commands'])==3,'three original PRE Git children')
    previous=start
    for command in trace['commands']:
        git=command['process'];begin,finish=git['spawnMonoNs'],git['reapMonoNs']
        need(type(git['parentPid']) is int and git['parentPid']==process['pid'] and
             type(begin) is int and type(finish) is int and previous<=begin<=finish<=end and
             finish-begin<=10000000000,'serial PRE Git children contained by preparation lifetime')
        previous=finish
    ownership=value['ownership']
    require_fields(ownership,'schema path identity owner before beforeCleanup afterCleanup spawnAttempted sessionSignalAttempted killAttempted cleanupTerminal polls closeAttempted closeSucceeded partial',
                   'closed preparation ownership original')
    need(ownership['schema']=='bw.ring3.preparation-ownership.v1' and
         ownership['path']==str(expected_cgroup(environ))+'-preparation' and
         same_json(ownership['owner'],{'uid':0,'gid':0}) and
         type(ownership['identity']) is dict and set(ownership['identity'])=={'device','inode'} and
         all(type(item) is int and item>0 for item in ownership['identity'].values()) and
         ownership['spawnAttempted'] is True and ownership['sessionSignalAttempted'] is False and
         ownership['killAttempted'] is False and ownership['cleanupTerminal'] is None and
         type(ownership['polls']) is int and 1<=ownership['polls']<=128 and
         ownership['closeAttempted'] is True and ownership['closeSucceeded'] is True and
         same_json(ownership['partial'],ownership['afterCleanup']),'natural closed preparation ownership')
    previous=None
    for key in ('before','beforeCleanup','afterCleanup'):
        snapshot=ownership[key]
        require_fields(snapshot,'identity owner limits raw procs','closed preparation ownership census')
        need(same_json(snapshot['identity'],ownership['identity']) and same_json(snapshot['owner'],ownership['owner']) and
             same_json(snapshot['limits'],LIMITS) and type(snapshot['raw']) is dict and
             set(snapshot['raw'])==set(PreparationOwnership.FILES) and
             all(type(item) is str and len(item.encode('ascii'))<=4096 for item in snapshot['raw'].values()) and
             snapshot['raw']['cgroupProcs']=='','original root-owned preparation census identity/cap join')
        entry_empty(snapshot)
        need(all(snapshot['raw'][key].strip()==item for key,item in LIMITS.items()),'original preparation raw caps')
        counters={}
        for line in snapshot['raw']['memoryEvents'].splitlines():
            pair=line.split();need(len(pair)==2 and pair[0] not in counters and re.fullmatch('[0-9]+',pair[1]) is not None,
                                   'original bounded preparation memory counter')
            counters[pair[0]]=int(pair[1])
        need({'oom','oom_kill'}<=set(counters) and len(counters)<=32,'original preparation OOM counter keys')
        if previous is not None:
            need(set(previous)==set(counters) and all(counters[key]>=previous[key] for key in previous) and
                 all(counters[key]==previous[key] for key in previous if key in ('oom','oom_kill','oom_group_kill')),
                 'original preparation OOM/counter drift')
        previous=counters
    return value


def check_generated_phase(raw,generation_raw,pre_git,outside_result,entry,environ,*,launch_plan_sha256=None):
    """Unprivileged joins of frozen preparation originals; no expected oracle.

    External source, runtime and sibling identity admission remains separate.
    The root parent never uses this parser on the opaque PRE body.
    """
    need(type(raw) is bytes and 0<len(raw)<=JSON_CAP,'bounded frozen preparation original')
    value=final_json(raw)
    require_fields(value,'schema runId attempt head tree python invoker captureMonoNs process stdout stderr ownership preGit firstFailure secondary',
                   'closed preparation original')
    admitted=launch_plan_sha256 is not None
    if admitted:
        need(type(launch_plan_sha256) is str and re.fullmatch('[0-9a-f]{64}',launch_plan_sha256),
             'independent admitted phase launch-plan digest')
    need(raw==encode(value) and value['schema']==('bw.ring3.preparation-original.v3' if admitted else 'bw.ring3.preparation-original.v2') and
         value['runId']==environ['GITHUB_RUN_ID'] and re.fullmatch('[1-9][0-9]*',value['runId']) is not None and
         type(value['attempt']) is int and value['attempt']==1 and environ['GITHUB_RUN_ATTEMPT']=='1' and
         value['head']==environ['BW_EXPECTED_HEAD'] and value['tree']==environ['BW_EXPECTED_TREE'] and
         same_json(value['python'],entry['python']) and same_json(value['invoker'],{'uid':entry['uid'],'gid':entry['gid']}) and
         value['firstFailure'] is None and value['secondary']==[], 'preparation source/invoker/error joins')
    streams={}
    for name in ('stdout','stderr'):
        item=value[name];require_fields(item,'bytes sha256 base64','closed preparation stream original')
        need(type(item['bytes']) is int and 0<=item['bytes']<=PREPARATION_STREAMS[name] and
             type(item['base64']) is str,'bounded preparation stream encoding')
        data=base64.b64decode(item['base64'],validate=True)
        need(base64.b64encode(data).decode('ascii')==item['base64'] and len(data)==item['bytes'] and
             sha(data)==item['sha256'],'preparation stream original extent/hash')
        streams[name]=data
    need(streams['stderr']==b'' and generation_parts(streams['stdout'])==(generation_raw,pre_git) and
         same_json(value['preGit'],{'bytes':len(pre_git),'sha256':sha(pre_git)}),'original PRE framed-body join')
    process=value['process'];outer=outside_result['process']
    require_fields(process,'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary',
                   'closed preparation process original')
    need(process['schema']=='bw.ring3.process.v1' and process['role']=='preparation' and process['cwdRole']=='checkout' and
         all(type(process[key]) is int and process[key]>0 for key in ('pid','pgid','parentPid','startTicks')) and
         process['pid']==process['pgid'] and type(outer['parentPid']) is int and process['parentPid']==outer['parentPid'] and
         same_json(process['argv'],[entry['python']['path'],'-I','-B',RUN_FILE,'--prepare-admitted-generated' if admitted else '--prepare-generated']) and
         same_json(process['environment'],dict(ENV,**{name:environ[name] for name in
            ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},SUDO_UID=str(entry['uid']),SUDO_GID=str(entry['gid']),
            **({'BW_LAUNCH_PLAN_SHA256':launch_plan_sha256} if admitted else {}))) and
         process['timedOut'] is False and type(process['exitCode']) is int and process['exitCode']==0 and
         type(process['waitStatus']) is int and process['waitStatus']==0 and process['signal'] is None and
         process['firstFailure'] is None and process['secondary']==[],'natural preparation descriptor/parent terminal joins')
    start,end,captured=process['spawnMonoNs'],process['reapMonoNs'],value['captureMonoNs']
    need(all(type(item) is int for item in (start,end,captured,outer['spawnMonoNs'])) and
         0<start<=end<=captured<=outer['spawnMonoNs'] and end-start<=120000000000,'preparation/capture/outside interval chain')
    trace=final_json(pre_git)
    need(type(trace.get('commands')) is list and len(trace['commands'])==3,'three original PRE Git children')
    previous=start
    for command in trace['commands']:
        git=command['process'];begin,finish=git['spawnMonoNs'],git['reapMonoNs']
        need(type(git['parentPid']) is int and git['parentPid']==process['pid'] and
             type(begin) is int and type(finish) is int and previous<=begin<=finish<=end and
             finish-begin<=10000000000,'serial PRE Git children contained by preparation lifetime')
        previous=finish
    ownership=value['ownership']
    require_fields(ownership,'schema path identity owner before beforeCleanup afterCleanup spawnAttempted sessionSignalAttempted killAttempted cleanupTerminal polls closeAttempted closeSucceeded partial',
                   'closed preparation ownership original')
    need(ownership['schema']=='bw.ring3.preparation-ownership.v1' and
         ownership['path']==str(expected_cgroup(environ))+'-preparation' and
         same_json(ownership['owner'],{'uid':0,'gid':0}) and
         type(ownership['identity']) is dict and set(ownership['identity'])=={'device','inode'} and
         all(type(item) is int and item>0 for item in ownership['identity'].values()) and
         ownership['spawnAttempted'] is True and ownership['sessionSignalAttempted'] is False and
         ownership['killAttempted'] is False and ownership['cleanupTerminal'] is None and
         type(ownership['polls']) is int and 1<=ownership['polls']<=128 and
         ownership['closeAttempted'] is True and ownership['closeSucceeded'] is True and
         same_json(ownership['partial'],ownership['afterCleanup']),'natural closed preparation ownership')
    previous=None
    for key in ('before','beforeCleanup','afterCleanup'):
        snapshot=ownership[key]
        require_fields(snapshot,'identity owner limits raw procs','closed preparation ownership census')
        need(same_json(snapshot['identity'],ownership['identity']) and same_json(snapshot['owner'],ownership['owner']) and
             same_json(snapshot['limits'],LIMITS) and type(snapshot['raw']) is dict and
             set(snapshot['raw'])==set(PreparationOwnership.FILES) and
             all(type(item) is str and len(item.encode('ascii'))<=4096 for item in snapshot['raw'].values()) and
             snapshot['raw']['cgroupProcs']=='','original root-owned preparation census identity/cap join')
        entry_empty(snapshot)
        need(all(snapshot['raw'][key].strip()==item for key,item in LIMITS.items()),'original preparation raw caps')
        counters={}
        for line in snapshot['raw']['memoryEvents'].splitlines():
            pair=line.split();need(len(pair)==2 and pair[0] not in counters and re.fullmatch('[0-9]+',pair[1]) is not None,
                                   'original bounded preparation memory counter')
            counters[pair[0]]=int(pair[1])
        need({'oom','oom_kill'}<=set(counters) and len(counters)<=32,'original preparation OOM counter keys')
        if previous is not None:
            need(set(previous)==set(counters) and all(counters[key]>=previous[key] for key in previous) and
                 all(counters[key]==previous[key] for key in previous if key in ('oom','oom_kill','oom_group_kill')),
                 'original preparation OOM/counter drift')
        previous=counters
    return value


def check_generated_originals(phase_raw,generation_raw,pre_git,outside_result,entry,originals,environ,*,launch_plan_sha256=None):
    """Original-to-original joins only. External prelaunch pinning is not here."""
    need(type(generation_raw) is bytes and 0<len(generation_raw)<=GENERATION_CAP,'bounded generator original')
    phase=check_generated_phase(phase_raw,generation_raw,pre_git,outside_result,entry,environ,launch_plan_sha256=launch_plan_sha256)
    value=final_json(generation_raw)
    require_fields(value,'schema runId attempt head tree invoker captureMonoNs process stdout stderr before after outputs firstFailure secondary',
                   'closed generator original')
    need(generation_raw==encode(value) and value['schema']=='bw.ring3.generation-original.v1' and
         value['runId']==environ['GITHUB_RUN_ID'] and type(value['attempt']) is int and value['attempt']==1 and
         value['head']==environ['BW_EXPECTED_HEAD'] and value['tree']==environ['BW_EXPECTED_TREE'] and
         same_json(value['invoker'],{'uid':entry['uid'],'gid':entry['gid']}) and
         value['firstFailure'] is None and value['secondary']==[],'generator source/invoker/error joins')
    for name in ('stdout','stderr'):
        require_fields(value[name],'bytes sha256 base64','closed original generator stream')
        need(same_json(value[name],{'bytes':0,'sha256':sha(b''),'base64':''}),'natural silent original generator streams')
    source=final_json(originals['source.before.json']);runtime=final_json(originals['runtime.before.json'])
    node_path=RUNTIME_EXECUTABLES['node'];node=runtime['qemuPackage']['files'][node_path]
    files={'node':{'path':node_path,'bytes':node['bytes'],'sha256':node['sha256']}}
    for role,name in (('fixture','fixture.mjs'),('runner','run.py')):
        path='scripts/i80386-ring3-int-iret/'+name;row=source['files'][path]
        files[role]={'path':path,'bytes':row['bytes'],'sha256':row['sha256']}
    for name in ('before','after'):
        require_fields(value[name],'monoNs files','closed timed generator identities')
        need(type(value[name]['monoNs']) is int and value[name]['monoNs']>0 and same_json(value[name]['files'],files),
             'generator observed Node/source original joins; external pins still required')
    expected={name:{'bytes':len(originals['inputs/'+name]),'sha256':sha(originals['inputs/'+name])} for name in ('fixture.rom','fixture.json')}
    need(same_json(value['outputs'],expected),'generator original output/packet-input joins')
    process=value['process'];prep=phase['process']
    require_fields(process,'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary',
                   'closed original generator process')
    need(process['schema']=='bw.ring3.process.v1' and process['role']=='discovery' and process['cwdRole']=='checkout' and
         all(type(process[key]) is int and process[key]>0 for key in ('pid','pgid','parentPid','startTicks')) and
         process['pid']==process['pgid'] and process['pid'] not in (prep['pid'],prep['parentPid']) and process['parentPid']==prep['pid'] and
         same_json(process['argv'],[node_path,'--input-type=module','--eval',STAGING_DRIVER]) and same_json(process['environment'],ENV) and
         process['firstFailure'] is None and process['secondary']==[] and process['timedOut'] is False and
         type(process['exitCode']) is int and process['exitCode']==0 and type(process['waitStatus']) is int and
         process['waitStatus']==0 and process['signal'] is None,'natural fixed original generator process')
    before,after,captured=value['before']['monoNs'],value['after']['monoNs'],value['captureMonoNs']
    start,end=process['spawnMonoNs'],process['reapMonoNs'];first_git=final_json(pre_git)['commands'][0]['process']['spawnMonoNs']
    need(all(type(item) is int for item in (start,end,captured)) and
         prep['spawnMonoNs']<=before<=start<=end<=after<=captured<=first_git and end-start<=10000000000,
         'preparation/identity/generator/capture/PRE causal chain')
    return value


def check_admitted_generated_originals(plan_raw,expected_sha256,phase_raw,generation_raw,pre_git,outside_result,entry,originals,environ):
    """Dropped-only caller supplies its retained plan and independent digest."""
    plan,source_raw=admit_launch_plan(plan_raw,expected_sha256,environ)
    need(originals['source.before.json']==source_raw,'packet source original joins independently pinned launch plan')
    value=check_generated_originals(phase_raw,generation_raw,pre_git,outside_result,entry,originals,environ,
                                    launch_plan_sha256=expected_sha256)
    extent,digest=GENERATION_NODE_PIN
    expected={'path':RUNTIME_EXECUTABLES['node'],'bytes':extent,'sha256':digest}
    for name in ('before','after'):
        need(same_json(value[name]['files']['node'],expected),'admitted generator matches independent selected Node pin')
    return value


def join_final_resources(internal,originals,outside_result,environ):
    entry=internal['.entry.json'];before=internal['.controller.before.json'];controller=internal['.controller.json'];outer=internal['.outside.json']
    require_fields(entry,'schema uid gid root sourceSha256 python cgroups','closed final entry original')
    require_fields(before,'pid before','closed controller BEFORE original')
    require_fields(outer,'process cleanup firstFailure secondary streamsHex','closed outside original')
    need(same_json(outer['process'],outside_result['process']) and same_json(outer['cleanup'],outside_result['cleanup']),'in-memory outside original join')
    process=outer['process'];cleanup=outer['cleanup'];pid=process['pid']
    require_fields(process,'schema role argv cwdRole environment pid pgid parentPid startTicks spawnMonoNs reapMonoNs exitCode signal waitStatus timedOut rusage firstFailure secondary','closed original outside process')
    need(type(pid) is int and pid>0 and type(process['pgid']) is int and process['pgid']==pid and
         process['role']=='controller' and process['firstFailure'] is None and process['secondary']==[] and
         process['timedOut'] is False and type(process['exitCode']) is int and process['exitCode']==0 and
         type(process['waitStatus']) is int and process['waitStatus']==0 and process['signal'] is None and
         type(process['spawnMonoNs']) is int and type(process['reapMonoNs']) is int and
         0<process['spawnMonoNs']<=process['reapMonoNs']<=process['spawnMonoNs']+600000000000,'natural finite original controller terminal')
    need(same_json(process['argv'],[entry['python']['path'],'-I','-B',RUN_FILE,'--bootstrap']) and
         entry['root']==str(expected_cgroup(environ)) and type(entry['uid']) is int and type(entry['gid']) is int and
         entry['uid']>0 and entry['gid']>0 and same_json(process['environment'],dict(ENV,**{name:environ[name] for name in
            ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},SUDO_UID=str(entry['uid']),SUDO_GID=str(entry['gid']))),
         'outside run/source/Python/invoker binding')
    need(type(before['pid']) is int and type(controller['pid']) is int and before['pid']==controller['pid']==pid and same_json(before['before'],controller['before']) and
         outer['firstFailure'] is None and outer['secondary']==[] and controller['firstFailure'] is None and controller['secondary']==[],
         'controller and outside original error/PID joins')
    require_fields(cleanup,'beforeCleanup afterCleanup sessionSignalAttempted cgroupKillAttempted cleanupTerminal polls','closed outside terminal observations')
    need(cleanup['sessionSignalAttempted'] is False and cleanup['cgroupKillAttempted'] is False and cleanup['cleanupTerminal'] is None and
         type(cleanup['polls']) is int and 1<=cleanup['polls']<=128,'no cleaned emptiness substituted for terminal evidence')
    roles={'enclosing','controller','js','qemu'}
    need(set(before['before'])==set(cleanup['beforeCleanup'])==set(cleanup['afterCleanup'])==set(entry['cgroups'])==roles,'four exact resource roles')
    for role in roles:
        for when in ('beforeCleanup','afterCleanup'):
            snap=cleanup[when][role];entry_snapshot(snap)
            need(same_json(snap['identity'],entry['cgroups'][role]['identity']),'stable outside terminal identity')
        snap=before['before'][role]
        need(same_json(snap['identity'],entry['cgroups'][role]['identity']) and same_json(snap['limits'],LIMITS) and
             same_json(snap['procs'],[pid] if role=='controller' else []) and
             snap['raw']['pidsCurrent'].strip()==('1' if role in ('enclosing','controller') else '0') and
             'populated '+('1' if role in ('enclosing','controller') else '0') in snap['raw']['cgroupEvents'].splitlines(),
             'controller-alive BEFORE census source')
    source=final_json(originals['source.before.json'])
    need(entry['sourceSha256']==sha(originals['source.before.json']) and source['head']==environ['BW_EXPECTED_HEAD'] and
         source['tree']==environ['BW_EXPECTED_TREE'] and same_json(final_json(originals['source.after.json']),source),'source file-readback and prepared binding join')
    need(same_json(final_json(originals['runtime.before.json']),final_json(originals['runtime.after.json'])),'runtime observed readback equality only')
    for role in ('js','qemu'):
        guest=final_json(originals[role+'/process.json'])
        need(same_json(controller['processes'][role],guest) and type(guest['parentPid']) is int and type(guest['pid']) is int and guest['pid']>0 and guest['parentPid']==pid and guest['pid']!=pid,'original guest parent/controller joins')
    need(controller['processes']['js']['pid']!=controller['processes']['qemu']['pid'],'fresh serial engine PIDs')
    js,qemu=(controller['processes'][role] for role in ('js','qemu'))
    need(all(type(guest[key]) is int for guest in (js,qemu) for key in ('spawnMonoNs','reapMonoNs')) and
         all(0<=guest['reapMonoNs']-guest['spawnMonoNs']<=CHILD_NS for guest in (js,qemu)),
         'exact finite original guest intervals')
    need(process['spawnMonoNs']<=js['spawnMonoNs']<=js['reapMonoNs']<=qemu['spawnMonoNs']<=qemu['reapMonoNs']<=process['reapMonoNs'],
         'serial original guests contained by controller lifetime')
    def refs(names,prefix):return {name:{'bytes':len(originals[prefix+name]),'sha256':sha(originals[prefix+name])} for name in names}
    input_refs=refs(('fixture.rom','fixture.json'),'inputs/')
    need(all(same_json(controller[key],input_refs) for key in ('inputsBefore','barrierInputs','inputsAfter')) and
         same_json(controller['jsOriginals'],refs(ControllerOps.JS_FILES,'js/')),'internal original input/JS references')
    return {'schema':'bw.ring3.resources.v1','enclosing':{'before':before['before']['enclosing'],'after':cleanup['beforeCleanup']['enclosing']},
        'controller':{'pid':pid,'before':before['before']['controller'],'after':cleanup['beforeCleanup']['controller']},
        'children':{role:{'before':before['before'][role],'after':cleanup['beforeCleanup'][role]} for role in ('js','qemu')},
        'firstFailure':None,'secondary':[]}


def finalize_packet(outside_result,outside_failure,pre_git,environ=None,*,post_observer=None,emit=None,flush=None,preparation_original=None,generation_original=None,launch_plan_original=None,launch_plan_sha256=None):
    """Unprivileged original assembly. No actual CLI/job or standalone-reader authority."""
    environ=dict(os.environ if environ is None else environ);failure=outside_failure
    need(isinstance(failure,FirstFailure),'authoritative in-memory outside failure required')
    originals={};raw_internal={};internal={};progress=None;staged=[];post_git=None
    try:
        outside_unprivileged(environ)
        try:finalizer_tree()
        except Exception as error:failure.add(error,'finalizer-tree')
        for name in INTERNAL_NAMES:
            try:
                raw=read_final_original(name,JSON_CAP);raw_internal[name]=raw;internal[name]=final_json(raw)
            except FileNotFoundError as error:
                if name!='.entry-failure.json':failure.add(error,'finalizer-internal')
            except Exception as error:failure.add(error,'finalizer-internal')
        # Existing outside failure stays authoritative. No phase-string or
        # chronology guesses reorder it; child originals remain secondary.
        for name in ('.entry-failure.json','.controller.json'):
            value=internal.get(name,{})
            if value.get('firstFailure') is not None:failure.secondary.append(value['firstFailure'])
            failure.secondary.extend(value.get('secondary',[]))
        if failure.secondary:
            failure.secondary.append({'phase':'finalizer-ordering','name':'ObservationLimit','message':'cross-phase first-error timing not inferred'})
            if failure.first is None:failure.add(ValueError('internal failure envelope refused'),'finalizer-errors')
        for name in sorted(PACKET_ROLES-{'audit.json','resources.json'}):
            try:originals[name]=read_final_original(name,role_cap(name))
            except Exception as error:failure.add(error,'finalizer-original-'+name)
        observer=GitObservation(environ,'after') if post_observer is None else post_observer
        try:
            post_git,found=observer.capture(environ['BW_EXPECTED_HEAD']);failure.adopt(found.first,found.secondary)
        except Exception as error:failure.add(error,'finalizer-post-git')
        try:
            resources=join_final_resources(internal,originals,outside_result,environ)
            if launch_plan_original is not None or launch_plan_sha256 is not None:
                check_admitted_generated_originals(launch_plan_original,launch_plan_sha256,preparation_original,
                    generation_original,pre_git,outside_result,internal['.entry.json'],originals,environ)
            elif generation_original is not None:
                check_generated_originals(preparation_original,generation_original,pre_git,outside_result,internal['.entry.json'],originals,environ)
            elif preparation_original is not None:
                check_preparation_original(preparation_original,pre_git,outside_result,internal['.entry.json'],environ)
            for phase,raw in (('before',pre_git),('after',post_git)):
                check_git_trace(raw,phase,final_json(originals['source.'+phase+'.json']),outside_result['process'])
            need('.entry-failure.json' not in internal,'entry failure cannot produce a positive packet')
            originals['resources.json']=encode(resources)
        except Exception as error:failure.add(error,'finalizer-join')
        log_originals=dict(raw_internal)
        if type(launch_plan_original) is bytes:log_originals['launch-plan.original.json']=launch_plan_original
        if type(generation_original) is bytes:log_originals['generation.phase.json']=generation_original
        if type(preparation_original) is bytes:log_originals['preparation.phase.json']=preparation_original
        if type(pre_git) is bytes:log_originals['git.before.json']=pre_git
        if type(post_git) is bytes:log_originals['git.after.json']=post_git
        progress=emit_originals(log_originals,sys.stdout.buffer.write if emit is None else emit,failure,
                                sys.stdout.buffer.flush if flush is None else flush)
        EXPORT.mkdir(mode=0o700)  # Exclusive directory; no overwrite or retry.
        for directory in ('inputs','js','qemu'):(EXPORT/directory).mkdir(mode=0o700)
        for name in sorted(originals):
            try:
                data=originals[name];need(len(data)<=role_cap(name),'staged original role cap')
                write_new(EXPORT/name,data,role_cap(name));staged.append(name)
            except Exception as error:failure.add(error,'finalizer-stage-'+name)
        rows=[{'path':name,'bytes':len(originals[name]),'sha256':sha(originals[name])} for name in sorted(staged)]
        if set(staged)!=PACKET_ROLES-{'audit.json'}:failure.add(ValueError('incomplete closed original packet'),'finalizer-roles')
        source=final_json(originals['source.before.json']) if 'source.before.json' in originals else {}
        audit={'schema':'bw.ring3.audit.v1','head':environ.get('BW_EXPECTED_HEAD'),'sourceTree':environ.get('BW_EXPECTED_TREE'),
            'workflowSha256':source.get('files',{}).get('.github/workflows/i80386-ring3-int-iret.yml',{}).get('sha256'),
            'roles':rows,'caps':AUDIT_CAPS,'firstFailure':failure.first,'secondary':failure.secondary}
        raw=encode(audit);need(len(raw)<=JSON_CAP and sum(item['bytes'] for item in rows)+len(raw)<=PACKET_CAP,'expanded packet including audit cap')
        write_new(EXPORT/'audit.json',raw,JSON_CAP);staged.append('audit.json')
    except BaseException as error:
        failure.add(error,'finalizer')
        try:
            diagnostic=encode({'firstFailure':failure.first,'secondary':failure.secondary})
            need(len(diagnostic)<=16384,'finalizer failure diagnostic cap');sys.stderr.buffer.write(diagnostic)
        except BaseException as secondary:failure.add(secondary,'finalizer-diagnostic')
    return {'staged':staged,'log':progress,'pass':failure.first is None and failure.secondary==[] and set(staged)==PACKET_ROLES},failure



class PreparationOps:
    """Unprivileged, fixed entry preparation; no controller creation or guest.

    The two supplied immutable byte strings must match the authored fixture.
    Generating them and admitting an actual event remain separate launch work.
    """
    def __init__(self,inputs,environ=None,observer=None):
        self.environ=dict(os.environ if environ is None else environ)
        self.inputs=dict(inputs);self.observer=observer
        self.uid=self.gid=None;self.directory_admitted=False;self.groups=None
        self.source=self.entry=self.pre_git=None
        self.partial={'source':None,'sourceReadback':None,'inputsReadback':None,
                      'pythonBefore':None,'pythonReadback':None,'cgroupsBefore':{},'cgroupsReadback':{}}

    def directory(self,path):
        path=Path(path);info=path.lstat()
        need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and
             (info.st_uid,info.st_gid)==(self.uid,self.gid),'canonical invoker-owned preparation directory')

    def packet_path(self,path):
        path=Path(path)
        need(path in (PACKET/'inputs/fixture.rom',PACKET/'inputs/fixture.json',PACKET/'source.before.json',ENTRY_FILE,ENTRY_FAILURE),
             'fixed preparation original path')
        self.directory(Path.cwd()/PACKET)
        if path.parent!=PACKET:self.directory(Path.cwd()/path.parent)
        return path

    def read(self,path,cap):
        path=self.packet_path(path)
        need(path.resolve(strict=True)==Path.cwd()/path and stat.S_ISREG(path.lstat().st_mode),'canonical prepared original read')
        return bounded_read(path,cap)

    def write(self,path,raw,cap):
        write_new(self.packet_path(path),raw,cap)

    def source_read(self,path,cap=4<<20,*,with_mode=False):
        name=str(path);need(name in SOURCE_PATHS,'fixed preparation source path')
        path=Path(name)
        need(path.resolve(strict=True)==Path.cwd()/path and stat.S_ISREG(path.lstat().st_mode),
             'canonical regular preparation source path')
        return bounded_read(path,cap,with_mode=with_mode)

    def admit(self):
        uid,gid=os.getresuid()[0],os.getresgid()[0]
        need(type(uid) is int and type(gid) is int and uid>0 and gid>0,'unprivileged preparation invoker')
        entry_ids(uid,gid);self.uid,self.gid=uid,gid
        root=expected_cgroup(self.environ)
        need(all(re.fullmatch('[0-9a-f]{40}',self.environ.get(k,'')) for k in ('BW_EXPECTED_HEAD','BW_EXPECTED_TREE')),
             'fixed preparation head and tree')
        membership=entry_proc('/proc/self/cgroup')
        need(membership.startswith('0::/') and membership.endswith('\n') and membership.count('\n')==1 and
             not membership[4:-1].startswith(root.name+'/') and membership[4:-1]!=root.name,
             'preparation must remain outside owned subtree')
        self.directory(Path.cwd());self.directory(Path.cwd()/'build')
        need(Path(__file__).resolve(strict=True)==Path.cwd()/RUN_FILE,'held preparation script location')
        # Admit every fixed source pathname before the Git adapter reads any
        # bytes. Readback repeats these checks; this is not a continuous lease.
        for name in sorted(SOURCE_PATHS):
            path=Path(name)
            need(path.resolve(strict=True)==Path.cwd()/path and stat.S_ISREG(path.lstat().st_mode),
                 'canonical regular preparation source path')
        need(set(self.inputs)=={'fixture.rom','fixture.json'} and
             all(type(data) is bytes and len(data)<= (65536 if name=='fixture.rom' else JSON_CAP)
                 for name,data in self.inputs.items()),'closed frozen preparation inputs')
        _,failure=input_facts(read=lambda path,cap:self.inputs[Path(path).name])
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)
        PACKET.mkdir(mode=0o700)  # Existing directory, including a symlink, refuses.
        self.directory(Path.cwd()/PACKET);self.directory_admitted=True
        for name in ('inputs','js','qemu'):
            (PACKET/name).mkdir(mode=0o700);self.directory(Path.cwd()/PACKET/name)
        self.groups=Cgroups(root,uid,self.environ)

    def originals(self):
        failure=FirstFailure()
        for name in ('fixture.rom','fixture.json'):
            try:self.write(PACKET/'inputs'/name,self.inputs[name],65536 if name=='fixture.rom' else JSON_CAP)
            except Exception as error:failure.add(error,'prepare-input-'+name)
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)
        observer=GitObservation(self.environ,'before') if self.observer is None else self.observer
        self.pre_git,found=observer.capture(self.environ['BW_EXPECTED_HEAD'])
        if found.first is not None:raise ObservedFailure(found.first,found.secondary)
        trace=final_json(self.pre_git);source=entry_json(encode(trace['source']));self.partial['source']=source
        # This is an observed PRE completion boundary, not an invented outer
        # spawn record. The real finalizer will join the future outer original.
        check_git_trace(self.pre_git,'before',source,{'spawnMonoNs':time.monotonic_ns()})
        need(source['head']==self.environ['BW_EXPECTED_HEAD'] and source['tree']==self.environ['BW_EXPECTED_TREE'] and
             type(source['files']) is dict and set(source['files'])==SOURCE_PATHS,'fixed preparation Git binding')
        checked,failure=source_facts(source,read=lambda path:self.source_read(path,with_mode=True),stage='before')
        self.partial['sourceReadback']=checked
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)
        self.source=entry_json(encode(source))
        self.write(PACKET/'source.before.json',encode(self.source),JSON_CAP)

    def python(self):
        files=RuntimeFiles();path,_=files.resolve(RUNTIME_EXECUTABLES['python'])
        need(files.resolve(sys.executable)[0]==path and stat.S_ISREG(Path(path).stat().st_mode) and
             Path(path).stat().st_mode & 0o6000==0,'canonical non-setid preparation Python')
        data=files.read(path,RUNTIME_CAPS['fileBytes'])
        need(type(data) is bytes and 0<len(data)<=RUNTIME_CAPS['fileBytes'],'bounded observed preparation Python')
        return {'path':path,'bytes':len(data),'sha256':sha(data)}

    def resources(self,target):
        identities=set();device=None
        for role in ('enclosing','controller','js','qemu'):
            snap=self.groups.observe(role);target[role]=snap;entry_snapshot(snap)
            need(self.groups.path(role).stat().st_gid==self.gid,'preparation cgroup group owner')
            identity=tuple(snap['identity'][key] for key in ('device','inode'))
            need(identity not in identities and (device is None or identity[0]==device),'distinct same-filesystem preparation groups')
            identities.add(identity);device=identity[0]
        return target

    def barrier(self):
        self.partial['pythonBefore']=self.python()
        self.resources(self.partial['cgroupsBefore'])
        failure=FirstFailure()
        try:
            source,found=source_facts(self.source,read=lambda path:self.source_read(path,with_mode=True),stage='before')
            self.partial['sourceReadback']=source;failure.adopt(found.first,found.secondary)
        except Exception as error:failure.add(error,'prepare-source-readback')
        try:
            raw=self.read(PACKET/'source.before.json',JSON_CAP)
            need(raw==encode(self.source),'prepared source original readback')
        except Exception as error:failure.add(error,'prepare-source-original-readback')
        try:
            data,found=input_facts(self.inputs,read=self.read);self.partial['inputsReadback']={name:{'bytes':len(raw),'sha256':sha(raw)} for name,raw in data.items()}
            failure.adopt(found.first,found.secondary)
        except Exception as error:failure.add(error,'prepare-input-readback')
        try:
            self.partial['pythonReadback']=self.python()
            need(same_json(self.partial['pythonBefore'],self.partial['pythonReadback']),'preparation Python readback drift')
        except Exception as error:failure.add(error,'prepare-python-readback')
        try:
            self.resources(self.partial['cgroupsReadback'])
            for role in ('enclosing','controller','js','qemu'):
                before=self.partial['cgroupsBefore'][role];after=self.partial['cgroupsReadback'][role]
                need(same_json(before['identity'],after['identity']) and same_json(before['limits'],after['limits']),
                     'preparation cgroup identity or limits readback drift')
        except Exception as error:failure.add(error,'prepare-cgroup-readback')
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)
        entry_ids(self.uid,self.gid)
        for directory in (Path.cwd(),Path.cwd()/'build',Path.cwd()/PACKET,*[Path.cwd()/PACKET/name for name in ('inputs','js','qemu')]):self.directory(directory)
        self.entry={'schema':'bw.ring3.entry.v1','uid':self.uid,'gid':self.gid,'root':str(self.groups.root),
            'sourceSha256':sha(encode(self.source)),'python':self.partial['pythonReadback'],
            'cgroups':self.partial['cgroupsReadback']}

    def commit(self):
        raw=encode(self.entry);self.write(ENTRY_FILE,raw,JSON_CAP)
        need(self.read(ENTRY_FILE,JSON_CAP)==raw,'exclusive prepared entry readback')

    def retain(self,failure):
        # No privileged retention, no new role, no overwrite of earlier facts.
        try:
            need(self.directory_admitted,'preparation packet was not admitted')
            entry_ids(self.uid,self.gid);self.directory(Path.cwd()/PACKET)
            retain_failure(failure,lambda facts:self.write(ENTRY_FAILURE,encode(facts),JSON_CAP),sys.stderr.buffer.write)
        except Exception as error:
            failure.add(error,'prepare-retention')
            try:
                raw=encode({'firstFailure':failure.first,'secondary':failure.secondary})
                need(len(raw)<=16384,'preparation diagnostic cap');sys.stderr.buffer.write(raw)
            except Exception as secondary:failure.add(secondary,'prepare-diagnostic')


def prepare_entry(ops):
    """Fixed source/input/resource preparation only. No launch side effects."""
    failure=FirstFailure();complete=False
    try:ops.admit();ops.originals();ops.barrier();ops.commit();complete=True
    except BaseException as error:failure.add(error,'entry-preparation')
    if failure.first is not None:ops.retain(failure)
    return {'preGit':ops.pre_git,'entry':ops.entry,'facts':ops.partial,'pass':complete and failure.first is None},failure


STAGED_INPUTS = Path('build/i80386-ring3-int-iret-staged')



STAGING_DRIVER = r"""import fs from 'node:fs';
import path from 'node:path';
import {buildFixture} from './scripts/i80386-ring3-int-iret/fixture.mjs';
const uid=process.getuid(),gid=process.getgid(),root=process.cwd();
const staged=path.resolve('build/i80386-ring3-int-iret-staged');
function directory(name){const s=fs.lstatSync(name);if(!s.isDirectory()||s.uid!==uid||s.gid!==gid||(s.mode&0o022)||fs.realpathSync(name)!==name)throw Error('canonical owned staging directory');}
function parents(){for(const name of [root,path.join(root,'build'),staged])directory(name);}
parents();if(uid<=0||gid<=0)throw Error('unprivileged staging only');
const directoryHandle=fs.opendirSync(staged);let directoryError=null;
try{if(directoryHandle.readSync()!==null)throw Error('empty staging only');}catch(e){directoryError=e;}
try{directoryHandle.closeSync();}catch(e){if(directoryError)directoryError.ring3Secondary=[String(e)];else directoryError=e;}
if(directoryError)throw directoryError;
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v!==null&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const fixture=buildFixture();
function write(name,data){
  if(!['fixture.rom','fixture.json'].includes(name))throw Error('fixed staging output');
  parents();const target=path.join(staged,name);
  const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);let first=null;
  try{const s=fs.fstatSync(fd);if(!s.isFile()||s.uid!==uid||s.gid!==gid||s.size!==0)throw Error('owned empty regular staging descriptor');
    if(fs.writeSync(fd,data,0,data.length)!==data.length)throw Error('complete staging write');
    if(fs.fstatSync(fd).size!==data.length)throw Error('staging descriptor extent');
  }catch(e){first=e;}
  try{fs.closeSync(fd);}catch(e){if(first)first.ring3Secondary=[String(e)];else first=e;}
  if(first)throw first;
}
const rom=Buffer.from(fixture.rom),metadata=Buffer.from(stable(fixture.manifest)+'\n');
if(rom.length!==65536||metadata.length>1048576)throw Error('bounded authored staging extent');
write('fixture.rom',rom);write('fixture.json',metadata);
"""


class LinuxStaging(LinuxTool):
    """Fixed pure builder, inherited preparation group; no controller migration."""
    def __init__(self,owner):
        self.owner=owner
        super().__init__(None,[RUNTIME_EXECUTABLES['node'],'--input-type=module','--eval',STAGING_DRIVER],os.getpid())

    def spawn(self):
        self.owner.spawn_attempted=True
        return super().spawn()

    def preexec(self,identity_fd):
        self.owner.member();LinuxController.preexec(self,identity_fd)


class StagingOps:
    """Separate dropped-child source interface. No actual invocation is wired."""
    def __init__(self,environ=None):
        self.environ=dict(os.environ if environ is None else environ)
        self.uid=self.gid=None;self.admitted=False;self.spawn_attempted=False
        self.directories={};self.facts={'before':{},'after':{},'outputs':{},'outputFacts':{}}

    def member(self):
        entry_ids(self.uid,self.gid)
        root=expected_cgroup(self.environ)
        need(entry_proc('/proc/self/cgroup')=='0::/'+root.name+'-preparation\n','staging requires dropped preparation sibling membership')

    def directory(self,path,initial=False):
        info=path.lstat()
        need(path.resolve(strict=True)==path and stat.S_ISDIR(info.st_mode) and
             (info.st_uid,info.st_gid)==(self.uid,self.gid) and info.st_mode&0o022==0,'canonical owned staging directory')
        identity=(info.st_dev,info.st_ino,info.st_uid,info.st_gid)
        if initial:self.directories[str(path)]=identity
        else:need(self.directories.get(str(path))==identity,'staging directory identity readback')

    def empty(self):
        entries=os.scandir(Path.cwd()/STAGED_INPUTS);first=None
        try:need(next(entries,None) is None,'staging directory must initially be empty')
        except BaseException as error:first=error
        try:entries.close()
        except BaseException as error:
            if first is None:first=error
            else:first.ring3_secondary=getattr(first,'ring3_secondary',[])+[row(error,'staging-directory-close')]
        if first is not None:raise first

    def admit(self):
        self.uid,self.gid=os.getresuid()[0],os.getresgid()[0]
        need(type(self.uid) is int and type(self.gid) is int and self.uid>0 and self.gid>0,'unprivileged staging invoker')
        self.member()
        for path in (Path.cwd(),Path.cwd()/'build',Path.cwd()/STAGED_INPUTS):self.directory(path,True)
        self.empty()
        self.admitted=True

    def observe(self,stage,failure):
        for role in ('node','fixture','runner'):
            try:
                if role=='node':
                    files=RuntimeFiles();path,_=files.resolve(RUNTIME_EXECUTABLES['node'])
                    need(path==RUNTIME_EXECUTABLES['node'],'fixed canonical staging Node')
                    info=Path(path).lstat()
                    need(stat.S_ISREG(info.st_mode) and info.st_mode&0o6000==0,'ordinary canonical staging Node')
                    data=files.read(path,RUNTIME_CAPS['fileBytes']);cap=RUNTIME_CAPS['fileBytes']
                else:
                    path='scripts/i80386-ring3-int-iret/'+('fixture.mjs' if role=='fixture' else 'run.py')
                    target=Path.cwd()/path;info=target.lstat()
                    need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
                         (info.st_uid,info.st_gid)==(self.uid,self.gid),'canonical owned staging source')
                    data=bounded_read(target,4<<20);cap=4<<20
                need(type(data) is bytes and 0<len(data)<=cap,'bounded observed staging identity')
                self.facts[stage][role]={'path':path,'bytes':len(data),'sha256':sha(data)}
            except BaseException as error:failure.add(error,'staging-'+stage+'-'+role)
        if stage=='after':
            for role in ('node','fixture','runner'):
                try:need(same_json(self.facts['before'][role],self.facts['after'][role]),'observed staging identity drift: '+role)
                except BaseException as error:failure.add(error,'staging-identity-readback')

    def create(self):
        self.member()
        for path in (Path.cwd(),Path.cwd()/'build',Path.cwd()/STAGED_INPUTS):self.directory(path)
        self.empty()
        return LinuxStaging(self)

    def outputs(self,failure):
        for name,cap in (('fixture.rom',65536),('fixture.json',JSON_CAP)):
            try:
                self.directory(Path.cwd()/STAGED_INPUTS)
                path=Path.cwd()/STAGED_INPUTS/name;info=path.lstat()
                need(path.resolve(strict=True)==path and stat.S_ISREG(info.st_mode) and
                     (info.st_uid,info.st_gid)==(self.uid,self.gid) and type(info.st_size) is int and 0<=info.st_size<=cap,
                     'canonical owned bounded staging output')
                raw=bounded_read(path,cap);self.facts['outputs'][name]=raw
                self.facts['outputFacts'][name]={'bytes':len(raw),'sha256':sha(raw)}
            except BaseException as error:failure.add(error,'staging-output-'+name)
        _,found=input_facts(read=lambda path,cap:self.facts['outputs'][Path(path).name])
        failure.adopt(found.first,found.secondary)


def stage_preparation_inputs(ops=None):
    """Source-only generation callable, separate from preparation_child defaults.

    Observed identities are not external pins; generation-original transport
    and source/runtime-before-generation admission remain activation work.
    """
    ops=StagingOps() if ops is None else ops;failure=FirstFailure();process=None
    streams={'stdout':b'','stderr':b''}
    try:
        ops.admit();ops.observe('before',failure)
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)
        child=ops.create();process,streams=collect_child(child,'discovery',child.argv,profile='discovery')
        failure.adopt(process['firstFailure'],process['secondary'])  # Before any output/readback fault.
        need(type(process['exitCode']) is int and process['exitCode']==0 and type(process['waitStatus']) is int and
             process['waitStatus']==0 and process['signal'] is None and process['timedOut'] is False and
             streams=={'stdout':b'','stderr':b''},'natural silent staging generator terminal')
    except BaseException as error:failure.add(error,'staging-generation')
    finally:
        if ops.spawn_attempted:
            try:ops.outputs(failure)
            except BaseException as error:failure.add(error,'staging-output-retention')
        if ops.admitted:
            try:ops.observe('after',failure)
            except BaseException as error:failure.add(error,'staging-after-retention')
    return {'pass':failure.first is None and failure.secondary==[],'process':process,'streams':streams,
            'spawnAttempted':ops.spawn_attempted,'facts':ops.facts},failure


GENERATION_MAGIC=b'R3GENv1\0'
GENERATION_CAP=128<<10


def generation_frame(generation,pre_git):
    need(type(generation) is bytes and 0<len(generation)<=GENERATION_CAP and
         type(pre_git) is bytes and len(pre_git)<=GIT_TRACE_CAP,'bounded generation/PRE originals')
    body=struct.pack('>II',len(generation),len(pre_git))+generation+pre_git
    need(len(body)<=GIT_TRACE_CAP,'shared generation/PRE body cap')
    return GENERATION_MAGIC+struct.pack('>I',len(body))+hashlib.sha256(body).digest()+body


def generation_parts(frame):
    """Root decodes framing only. Neither original JSON body is parsed here."""
    need(type(frame) is bytes and 52<len(frame)<=PREPARATION_STREAMS['stdout'] and
         frame[:8]==GENERATION_MAGIC,'fixed bounded generated-preparation frame')
    size=struct.unpack('>I',frame[8:12])[0];body=frame[44:]
    need(8<size<=GIT_TRACE_CAP and len(body)==size and hashlib.sha256(body).digest()==frame[12:44],
         'exact generated-preparation frame extent/digest')
    generation_size,pre_size=struct.unpack('>II',body[:8])
    need(0<generation_size<=GENERATION_CAP and pre_size<=GIT_TRACE_CAP and len(body)==8+generation_size+pre_size,
         'exact generated-preparation original parts')
    return body[8:8+generation_size],body[8+generation_size:]


class RecordingStagingOps(StagingOps):
    """Observation completion clocks; the old staging interface stays unchanged."""
    def __init__(self,environ=None):
        super().__init__(environ);self.observation_times={'before':None,'after':None}

    def observe(self,stage,failure):
        try:super().observe(stage,failure)
        except BaseException as error:failure.add(error,'recording-staging-'+stage)
        try:
            observed=time.monotonic_ns();need(type(observed) is int and observed>0,'generation identity observation clock')
            self.observation_times[stage]=observed
        except BaseException as error:failure.add(error,'recording-staging-clock')


def admit_generation_source(raw,expected_sha256,expected_head,expected_tree):
    """Compare separately retained source admission, never derive its authority.

    The external event plan must select all four arguments independently of
    generation. This primitive cannot authenticate a caller-selected manifest.
    """
    need(type(raw) is bytes and 0<len(raw)<=JSON_CAP,'bounded immutable admitted source original')
    for value,size in ((expected_sha256,64),(expected_head,40),(expected_tree,40)):
        need(type(value) is str and re.fullmatch('[0-9a-f]{'+str(size)+'}',value),
             'explicit external source digest/head/tree')
    need(sha(raw)==expected_sha256,'external source original digest')
    source=final_json(raw)
    require_fields(source,'schema head tree files','closed admitted source original')
    need(source['schema']=='bw.ring3.source.v1' and source['head']==expected_head and
         source['tree']==expected_tree,'external admitted source head/tree')
    need(type(source['files']) is dict and set(source['files'])==SOURCE_PATHS,'admitted source twelve-path roster')
    for item in source['files'].values():
        require_fields(item,'bytes sha256 mode blob','closed admitted source file')
        need(type(item['bytes']) is int and 0<=item['bytes']<=4<<20 and item['mode']=='100644',
             'admitted source extent and regular mode')
        for key,size in (('sha256',64),('blob',40)):
            need(type(item[key]) is str and re.fullmatch('[0-9a-f]{'+str(size)+'}',item[key]),
                 'admitted source file digest')
    need(encode(source)==raw,'canonical admitted source original')
    return raw


# Selected-file identity admitted from the separate CLI646 original. This is
# not a dependency-graph, upstream-authenticity or host-ownership assertion.
GENERATION_NODE_PIN=(124827920,'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48')


class PinnedRecordingStagingOps(RecordingStagingOps):
    """Unwired identity-comparison primitive, separate from generated defaults.

    Full twelve-file observations remain in memory. GEN v1 retains only its
    existing three identities; neither it nor later PRE proves all twelve live
    before observations independently. External launch-plan admission is pending.
    """
    def __init__(self,source_original,source_sha256,expected_head,expected_tree,environ=None):
        self._source_original=admit_generation_source(source_original,source_sha256,expected_head,expected_tree)
        self._expected_head,self._expected_tree=expected_head,expected_tree
        super().__init__(environ);self.source_observations={}

    def admit(self):
        need(self.environ.get('BW_EXPECTED_HEAD')==self._expected_head and
             self.environ.get('BW_EXPECTED_TREE')==self._expected_tree,'staging environment joins external source admission')
        super().admit()

    def source_read(self,path):
        need(path in SOURCE_PATHS,'fixed pinned staging source path')
        target=Path.cwd()/path;info=target.lstat()
        need(target.resolve(strict=True)==target and stat.S_ISREG(info.st_mode) and
             (info.st_uid,info.st_gid)==(self.uid,self.gid),'canonical owned pinned staging source')
        return bounded_read(target,4<<20,with_mode=True)

    def observe(self,stage,failure):
        source=final_json(self._source_original)  # Fresh copy; public observations are not authority.
        try:
            observed,found=source_facts(source,self.source_read,stage=stage)
            self.source_observations[stage]=observed;failure.adopt(found.first,found.secondary)
        except BaseException as error:failure.add(error,'pinned-staging-source-'+stage)
        try:StagingOps.observe(self,stage,failure)
        except BaseException as error:failure.add(error,'pinned-staging-'+stage)
        for role,name in (('fixture','fixture.mjs'),('runner','run.py')):
            try:
                path='scripts/i80386-ring3-int-iret/'+name;item=source['files'][path]
                need(same_json(self.facts[stage][role],{'path':path,'bytes':item['bytes'],'sha256':item['sha256']}),
                     'staging observed identity joins admitted source: '+role)
            except BaseException as error:failure.add(error,'pinned-staging-'+stage+'-'+role)
        try:
            extent,digest=GENERATION_NODE_PIN
            need(same_json(self.facts[stage]['node'],{'path':RUNTIME_EXECUTABLES['node'],'bytes':extent,'sha256':digest}),
                 'staging observed Node matches independent selected-file pin')
        except BaseException as error:failure.add(error,'pinned-staging-'+stage+'-node')
        try:
            observed=time.monotonic_ns();need(type(observed) is int and observed>0,'generation identity observation clock')
            self.observation_times[stage]=observed
        except BaseException as error:failure.add(error,'pinned-staging-clock')


def launch_plan_path(environ):
    return Path('/run')/(expected_cgroup(environ).name+'-admission')/'launch-plan.json'


def read_launch_plan(environ,expected_sha256):
    """Bounded opaque read; external reviewed installation remains required.

    Each reader checks its own held file and paths. Equal pinned bytes do not
    establish a parent-to-child inode lease or independent metadata original.
    """
    need(type(expected_sha256) is str and re.fullmatch('[0-9a-f]{64}',expected_sha256),
         'independently selected launch-plan SHA-256')
    path=launch_plan_path(environ);parents=(Path('/'),Path('/run'),path.parent)
    def identity(info):
        return tuple(getattr(info,key) for key in ('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns'))
    def directory(parent):
        info=parent.lstat()
        need(parent.resolve(strict=True)==parent and stat.S_ISDIR(info.st_mode) and
             (info.st_uid,info.st_gid)==(0,0) and info.st_mode&0o022==0,'canonical root-owned launch-plan ancestors')
        return identity(info)
    before={parent:directory(parent) for parent in parents}
    initial=path.lstat()
    need(path.resolve(strict=True)==path and stat.S_ISREG(initial.st_mode) and
         (initial.st_uid,initial.st_gid)==(0,0) and stat.S_IMODE(initial.st_mode)==0o444 and
         initial.st_nlink==1 and type(initial.st_size) is int and 0<initial.st_size<=JSON_CAP,
         'canonical readonly single-link root-owned launch plan')
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);first=None;raw=bytearray()
    try:
        need(identity(os.fstat(descriptor))==identity(initial),'held launch-plan file identity')
        while True:
            chunk=os.read(descriptor,min(65536,JSON_CAP+1-len(raw)))
            if not chunk:break
            raw.extend(chunk);need(len(raw)<=JSON_CAP,'launch-plan read extent cap')
        need(len(raw)==initial.st_size and identity(os.fstat(descriptor))==identity(initial) and
             identity(path.lstat())==identity(initial) and path.resolve(strict=True)==path,
             'stable held launch-plan identity and extent')
        need(all(directory(parent)==before[parent] for parent in parents),'launch-plan ancestor readback identity')
        need(sha(raw)==expected_sha256,'independently selected launch-plan digest')
    except BaseException as error:first=error
    finally:first=close_owned(descriptor,first,'launch-plan-descriptor-close')
    if first is not None:raise first
    return bytes(raw)


def admit_launch_plan(raw,expected_sha256,environ):
    """Closed original/event/source joins, not proof of external approval."""
    need(type(raw) is bytes and 0<len(raw)<=JSON_CAP and type(expected_sha256) is str and
         re.fullmatch('[0-9a-f]{64}',expected_sha256) and sha(raw)==expected_sha256,'bounded pinned launch-plan original')
    expected_cgroup(environ)
    need(all(type(environ.get(key)) is str and re.fullmatch('[0-9a-f]{40}',environ[key]) for key in
             ('BW_EXPECTED_HEAD','BW_EXPECTED_TREE')),'external launch-plan head/tree bindings')
    plan=final_json(raw);require_fields(plan,'schema runId attempt head tree source','closed launch-plan original')
    need(raw==encode(plan) and plan['schema']=='bw.ring3.launch-plan.v1' and
         plan['runId']==environ['GITHUB_RUN_ID'] and type(plan['attempt']) is int and plan['attempt']==1 and
         plan['head']==environ['BW_EXPECTED_HEAD'] and plan['tree']==environ['BW_EXPECTED_TREE'],
         'launch-plan official run/attempt/head/tree joins')
    item=plan['source'];require_fields(item,'bytes sha256 base64','closed launch-plan source original')
    need(type(item['bytes']) is int and 0<item['bytes']<=JSON_CAP and type(item['base64']) is str,
         'bounded launch-plan source encoding')
    source=base64.b64decode(item['base64'],validate=True)
    need(base64.b64encode(source).decode('ascii')==item['base64'] and len(source)==item['bytes'],
         'exact launch-plan source original encoding')
    admit_generation_source(source,item['sha256'],plan['head'],plan['tree'])
    return plan,source


def admitted_generated_preparation_child(environ=None,*,observer=None,emit=None,flush=None):
    """Unwired dropped child: fixed-path plan admission before pinned staging."""
    environ=dict(os.environ if environ is None else environ);failure=FirstFailure();raw=None
    try:
        ids=[environ.get('SUDO_'+key,'') for key in ('UID','GID')]
        need(all(type(value) is str and re.fullmatch('[1-9][0-9]{0,9}',value) and int(value)<2**31 for value in ids),
             'admitted child fixed dropped invoker')
        entry_ids(*map(int,ids))  # Actual IDs/groups/capabilities BEFORE plan read or decode.
        need(entry_proc('/proc/self/cgroup')=='0::/'+expected_cgroup(environ).name+'-preparation\n',
             'admitted child dropped preparation sibling membership')
        expected=environ.get('BW_LAUNCH_PLAN_SHA256')
        raw=read_launch_plan(environ,expected);plan,source=admit_launch_plan(raw,expected,environ)
        ops=PinnedRecordingStagingOps(source,plan['source']['sha256'],plan['head'],plan['tree'],environ)
        result,found=generated_preparation_child(environ,staging_ops=ops,observer=observer,emit=emit,flush=flush)
        failure.adopt(found.first,found.secondary);result['launchPlanOriginal']=raw
        return result,failure
    except BaseException as error:failure.add(error,'admitted-generated-preparation')
    return {'pass':False,'generation':None,'generationOriginal':None,'preparation':None,'preGit':b'',
            'launchPlanOriginal':raw},failure


def generation_original(ops,result,failure):
    def stream(name):
        data=result['streams'][name]
        need(type(data) is bytes and len(data)<=16384,'bounded original generator stream')
        return {'bytes':len(data),'sha256':sha(data),'base64':base64.b64encode(data).decode('ascii')}
    captured=time.monotonic_ns();need(type(captured) is int and captured>0,'generation capture clock')
    value={'schema':'bw.ring3.generation-original.v1','runId':ops.environ['GITHUB_RUN_ID'],'attempt':1,
        'head':ops.environ['BW_EXPECTED_HEAD'],'tree':ops.environ['BW_EXPECTED_TREE'],
        'invoker':{'uid':ops.uid,'gid':ops.gid},'captureMonoNs':captured,'process':result['process'],
        'stdout':stream('stdout'),'stderr':stream('stderr'),
        'before':{'monoNs':ops.observation_times['before'],'files':result['facts']['before']},
        'after':{'monoNs':ops.observation_times['after'],'files':result['facts']['after']},
        'outputs':result['facts']['outputFacts'],'firstFailure':failure.first,'secondary':failure.secondary}
    raw=encode(value);need(len(raw)<=GENERATION_CAP,'generation original encoding cap');return raw


def generated_preparation_child(environ=None,*,staging_ops=None,observer=None,emit=None,flush=None):
    """Unused adapter: immutable generator original precedes original PRE Git."""
    environ=dict(os.environ if environ is None else environ);failure=FirstFailure()
    ops=RecordingStagingOps(environ) if staging_ops is None else staging_ops
    generation_result=None;generation_raw=None;pre_result=None;pre_git=b'';complete=False
    emit=sys.stdout.buffer.write if emit is None else emit;flush=sys.stdout.buffer.flush if flush is None else flush
    try:
        generation_result,found=stage_preparation_inputs(ops);failure.adopt(found.first,found.secondary)
        generation_raw=generation_original(ops,generation_result,failure)  # Immutable BEFORE any PRE Git.
    except BaseException as error:failure.add(error,'generated-original-capture')
    if generation_raw is not None:
        if generation_result['pass'] is True and failure.first is None and failure.secondary==[]:
            try:
                frames=[]
                pre_result,found=preparation_child(environ,observer=observer,
                    emit=lambda frame:frames.append(frame) or len(frame),flush=lambda:None)
                failure.adopt(found.first,found.secondary)
                if frames:
                    need(len(frames)==1,'one original preparation emission');pre_git=preparation_body(frames[0])
                if pre_result['pass'] is not True or failure.first is not None or failure.secondary:
                    if failure.first is None:failure.add(ValueError('generated preparation result/error joins'),'generated-preparation')
            except BaseException as error:failure.add(error,'generated-preparation')
        try:
            frame=generation_frame(generation_raw,pre_git)
            count=emit(frame);need(type(count) is int and count==len(frame),'complete generation/PRE frame write')
            flush();complete=True
        except BaseException as error:failure.add(error,'generated-channel-retention')
    return {'pass':complete and failure.first is None and failure.secondary==[] and bool(pre_git),
        'generation':generation_result,'generationOriginal':generation_raw,'preparation':pre_result,'preGit':pre_git},failure


def preparation_frame(raw):
    need(type(raw) is bytes and 0<len(raw)<=GIT_TRACE_CAP,'original PRE frame body extent')
    return PREPARATION_MAGIC+struct.pack('>I',len(raw))+hashlib.sha256(raw).digest()+raw


def preparation_body(frame):
    """Root parses only fixed transport metadata, never the opaque PRE JSON."""
    need(type(frame) is bytes and 44<len(frame)<=PREPARATION_STREAMS['stdout'],'bounded PRE binary frame')
    need(frame[:8]==PREPARATION_MAGIC,'fixed PRE binary frame version')
    extent=struct.unpack('>I',frame[8:12])[0]
    need(1<=extent<=GIT_TRACE_CAP and len(frame)==44+extent,'exact PRE frame extent and no suffix')
    raw=frame[44:]
    need(hashlib.sha256(raw).digest()==frame[12:44],'original PRE frame digest')
    return raw

def preparation_child(environ=None,*,observer=None,emit=None,flush=None):
    """Dropped child only: two fixed staged inputs, no arbitrary input CLI.

    Emission frames the raw original PRE bytes, never a success JSON reconstruction.
    Escaped bytes after a short/failed write or flush are not success.
    """
    environ=dict(os.environ if environ is None else environ);failure=FirstFailure()
    inputs={};ops=None;result=None;complete=False
    emit=sys.stdout.buffer.write if emit is None else emit
    flush=sys.stdout.buffer.flush if flush is None else flush
    try:
        uid,gid=os.getresuid()[0],os.getresgid()[0]
        need(uid>0 and gid>0,'preparation child must already be unprivileged');entry_ids(uid,gid)
        need(environ.get('SUDO_UID')==str(uid) and environ.get('SUDO_GID')==str(gid),'preparation child invoker binding')
        expected_cgroup(environ)
        for directory in (Path.cwd(),Path.cwd()/'build',Path.cwd()/STAGED_INPUTS):
            info=directory.lstat()
            need(directory.resolve(strict=True)==directory and stat.S_ISDIR(info.st_mode) and
                 (info.st_uid,info.st_gid)==(uid,gid),'canonical owned staged preparation directory')
        for name,cap in (('fixture.rom',65536),('fixture.json',JSON_CAP)):
            try:
                path=STAGED_INPUTS/name;info=path.lstat()
                need(path.resolve(strict=True)==Path.cwd()/path and stat.S_ISREG(info.st_mode) and
                     (info.st_uid,info.st_gid)==(uid,gid),'fixed owned staged preparation input')
                inputs[name]=bounded_read(path,cap)
            except Exception as error:failure.add(error,'preparation-staged-'+name)
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)
        ops=PreparationOps(inputs,environ,observer);result,found=prepare_entry(ops)
        failure.adopt(found.first,found.secondary)
        need(result['pass'] is True and failure.first is None and failure.secondary==[],
             'preparation result and authoritative errors must both pass')
        raw=result['preGit']
        need(type(raw) is bytes and 0<len(raw)<=GIT_TRACE_CAP,'original PRE transport extent')
        frame=preparation_frame(raw);written=emit(frame)
        need(type(written) is int and written==len(frame),'complete original PRE frame write')
        flush();complete=True
    except BaseException as error:
        # An ObservedFailure may already have been adopted from the child
        # preparation function; do not replace it with a generic verdict.
        if failure.first is None:failure.add(error,'preparation-child')
        elif not isinstance(error,ObservedFailure):failure.add(error,'preparation-child')
        try:
            raw=encode({'firstFailure':failure.first,'secondary':failure.secondary})
            need(len(raw)<=16384,'preparation child diagnostic cap');sys.stderr.buffer.write(raw)
        except BaseException as secondary:failure.add(secondary,'preparation-child-diagnostic')
    return {'pass':complete and failure.first is None and failure.secondary==[],
            'preparation':result,'inputs':inputs},failure



class PreparationOwnership:
    """One fixed root-owned sibling. No creation, delegation or path-only kill."""
    FILES=dict(Cgroups.FILES,**{'memoryEvents':'memory.events','cpuStat':'cpu.stat','cgroupEvents':'cgroup.events',
        'memoryCurrent':'memory.current','memoryPeak':'memory.peak','pidsCurrent':'pids.current','cgroupProcs':'cgroup.procs'})

    def __init__(self,parent):
        self.parent=parent;manual=expected_cgroup(parent.environ)
        self.path=manual.with_name(manual.name+'-preparation');self.manual=manual
        self.directory=None;self._binding=None;self._before=None
        self.admitted=False;self.consumed=False;self._spawn_attempted=False
        self.partial=None
        self.facts={'schema':'bw.ring3.preparation-ownership.v1','path':str(self.path),'identity':None,
            'owner':{'uid':0,'gid':0},'before':None,'beforeCleanup':None,'afterCleanup':None,
            'spawnAttempted':False,'sessionSignalAttempted':False,'killAttempted':False,'cleanupTerminal':None,
            'polls':0,'closeAttempted':False,'closeSucceeded':False,'partial':None}

    def outside(self):
        text=entry_proc('/proc/self/cgroup');names=('/'+self.manual.name,'/'+self.path.name)
        need(text.startswith('0::/') and text.endswith('\n') and text.count('\n')==1 and
             all(text[3:-1]!=name and not text[3:-1].startswith(name+'/') for name in names),
             'preparation parent must remain outside both owned trees')

    def check_directory(self,descriptor):
        info=os.fstat(descriptor)
        need(stat.S_ISDIR(info.st_mode) and info.st_uid==info.st_gid==0 and info.st_mode&0o022==0,
             'root-owned non-writable preparation directory')
        binding=(info.st_dev,info.st_ino,info.st_uid,info.st_gid)
        need(type(info.st_dev) is int and type(info.st_ino) is int and info.st_ino>0 and
             info.st_dev==Path('/sys/fs/cgroup').stat().st_dev and
             (self._binding is None or binding==self._binding),'held preparation directory identity')
        return binding

    def text(self,descriptor,name):
        need(name in self.FILES.values(),'fixed anchored preparation observation')
        self.check_directory(descriptor)
        fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=descriptor);first=None;data=None
        try:
            info=os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_dev==self._binding[0] and
                 info.st_uid==info.st_gid==0 and info.st_mode&0o022==0,'root-owned preparation control file')
            data=os.read(fd,4097);need(len(data)<=4096,'preparation kernel observation cap');data=data.decode('ascii')
        except Exception as error:first=error
        finally:first=close_owned(fd,first,'preparation-observation-close')
        if first is not None:raise first
        return data

    def snapshot(self,descriptor=None):
        descriptor=self.directory if descriptor is None else descriptor
        binding=self.check_directory(descriptor)
        snap={'identity':{'device':binding[0],'inode':binding[1]},'owner':{'uid':binding[2],'gid':binding[3]},
              'limits':{},'raw':{},'procs':[]};self.partial=snap;self.facts['partial']=snap
        for key,name in self.FILES.items():snap['raw'][key]=self.text(descriptor,name)
        snap['limits']={key:snap['raw'][key].strip() for key in LIMITS}
        need(snap['limits']==LIMITS,'preparation fixed limits drift')
        lines=snap['raw']['cgroupProcs'].splitlines()
        need(len(lines)<=64 and all(re.fullmatch('[1-9][0-9]{0,9}',value) and int(value)<2**31 for value in lines) and
             len(set(lines))==len(lines),'finite original preparation PID census')
        snap['procs']=sorted(map(int,lines))
        need(re.fullmatch('[0-9]+\n',snap['raw']['pidsCurrent']) is not None,'original hierarchical preparation PID count')
        return snap

    def admit(self):
        need(not self.consumed,'preparation ownership already consumed; no reopen')
        self.outside()
        if self.directory is None:
            self.directory=os.open(self.path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
            self._binding=self.check_directory(self.directory)
            self.facts['identity']={'device':self._binding[0],'inode':self._binding[1]}
        snap=self.snapshot();entry_empty(snap)
        if self._before is None:
            self._before=entry_json(encode(snap));self.facts['before']=entry_json(encode(snap))
        self.counters(snap)
        self.admitted=True

    def begin_spawn(self):
        need(self.admitted and not self.consumed and not self._spawn_attempted,'one admitted preparation spawn attempt')
        self._spawn_attempted=True;self.facts['spawnAttempted']=True

    def write(self,descriptor,name,data):
        need(name in ('cgroup.procs','cgroup.kill'),'fixed preparation anchored write')
        self.check_directory(descriptor)
        fd=os.open(name,os.O_WRONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=descriptor);first=None
        try:
            info=os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_dev==self._binding[0] and
                 info.st_uid==info.st_gid==0 and info.st_mode&0o022==0,'root-owned preparation writable control')
            need(os.write(fd,data)==len(data),'complete preparation anchored write')
        except Exception as error:first=error
        finally:first=close_owned(fd,first,'preparation-write-close')
        if first is not None:raise first

    def move_self(self):
        need(self.admitted and not self.consumed and self._spawn_attempted,'admitted preparation migration')
        # Fresh child reopen: do not assume Popen preserves the parent's dirFD.
        fd=os.open(self.path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK);first=None
        try:
            self.check_directory(fd);self.write(fd,'cgroup.procs',str(os.getpid()).encode('ascii'))
            snap=self.snapshot(fd)
            need(snap['procs']==[os.getpid()] and snap['raw']['pidsCurrent'].strip()=='1' and
                 'populated 1' in snap['raw']['cgroupEvents'].splitlines(),'sole preparation child before privilege drop')
        except Exception as error:first=error
        finally:first=close_owned(fd,first,'preparation-child-directory-close')
        if first is not None:raise first

    def child_entered(self):
        need(entry_proc('/proc/self/cgroup')=='0::/'+self.path.name+'\n','dropped preparation sibling membership')

    def kill(self):
        need(self.admitted and self._spawn_attempted and not self.consumed,'no cleanup of unadmitted preparation work')
        self.outside();self.write(self.directory,'cgroup.kill',b'1')

    def counters(self,after):
        def parse(snapshot):
            rows=[line.split() for line in snapshot['raw']['memoryEvents'].splitlines()]
            need(len(rows)<=32 and all(len(row)==2 and re.fullmatch('[0-9]+',row[1]) for row in rows) and
                 len({row[0] for row in rows})==len(rows),'bounded original preparation memory counters')
            values={key:int(value) for key,value in rows};need({'oom','oom_kill'}<=set(values),'original preparation OOM counters')
            return values
        before,after=parse(self._before),parse(after)
        need(set(before)==set(after) and all(after[key]>=before[key] for key in before) and
             all(after[key]==before[key] for key in before if key in ('oom','oom_kill','oom_group_kill')),
             'preparation memory counter or OOM drift')

    def finish(self,process):
        need(not self.consumed,'preparation ownership consumed; no finish retry')
        failure=FirstFailure();terminal=type(process) is dict and type(process.get('waitStatus')) is int
        try:
            if not self.admitted:return self.facts,failure
            self.outside();empty=False
            try:
                self.facts['beforeCleanup']=self.snapshot();entry_empty(self.facts['beforeCleanup'])
                self.counters(self.facts['beforeCleanup']);empty=True
            except Exception as error:
                self.facts['beforeCleanup']=self.partial;failure.add(error,'preparation-precleanup')
            if not self._spawn_attempted:
                if not empty:failure.add(ValueError('no own spawn attempt; preparation cleanup unavailable'),'preparation-ownership')
                return self.facts,failure
            if not terminal:failure.add(ValueError('preparation terminal unknown before cleanup'),'preparation-terminal')
            child=self.parent.pre_child
            if not terminal and child is not None and child.process is not None and child.process.returncode is None:
                self.facts['sessionSignalAttempted']=True
                try:child.kill()
                except Exception as error:failure.add(error,'preparation-session-kill')
            if not empty:
                self.facts['killAttempted']=True
                try:self.kill()
                except Exception as error:failure.add(error,'preparation-owned-kill')
            deadline=time.monotonic_ns()+DRAIN_NS
            for count in range(128):
                self.facts['polls']=count+1
                if not terminal and child is not None and child.process is not None and child.process.returncode is None:
                    try:
                        result=child.reap()
                        if result is not None:self.facts['cleanupTerminal']=dict(result,reapMonoNs=time.monotonic_ns());terminal=True
                    except Exception as error:failure.add(error,'preparation-cleanup-reap')
                try:
                    self.facts['afterCleanup']=self.snapshot();entry_empty(self.facts['afterCleanup']);self.counters(self.facts['afterCleanup']);empty=True
                except Exception as error:
                    self.facts['afterCleanup']=self.partial;failure.add(error,'preparation-postcleanup');empty=False
                if empty and terminal:break
                if time.monotonic_ns()>=deadline:break
                time.sleep(0.02)
            else:failure.add(TimeoutError('preparation cleanup census iteration bound'),'preparation-cleanup')
            if not empty or not terminal:failure.add(TimeoutError('preparation cleanup emptiness or reap unknown'),'preparation-cleanup')
            self.outside()
        except BaseException as error:failure.add(error,'preparation-finish')
        finally:
            self.consumed=True
            fd=self.directory;self.directory=None
            if fd is not None:
                self.facts['closeAttempted']=True
                try:os.close(fd);self.facts['closeSucceeded']=True
                except Exception as error:failure.add(error,'preparation-directory-close')
        return self.facts,failure

class LinuxPreparation(LinuxTool):
    """Fresh same-Python child; no manual group membership or guest parsing."""
    read_chunk_bytes=65536

    def __init__(self,parent):
        self.parent_owner=parent
        super().__init__(None,[parent.python['path'],'-I','-B',RUN_FILE,'--prepare'],os.getpid())
        self.role='preparation'
        self.environment=dict(ENV,**{name:parent.environ[name] for name in
            ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},
            SUDO_UID=str(parent.bootstrap.invoker['uid']),SUDO_GID=str(parent.bootstrap.invoker['gid']))

    def spawn(self):
        self.parent_owner.require_preparation_ownership()
        self.parent_owner.preparation_ownership.begin_spawn()
        return super().spawn()

    def preexec(self,identity_fd):
        self.parent_owner.preparation_ownership.move_self()
        self.parent_owner.bootstrap.drop()
        invoker=self.parent_owner.bootstrap.invoker
        entry_ids(invoker['uid'],invoker['gid'])
        self.parent_owner.preparation_ownership.child_entered()
        LinuxController.preexec(self,identity_fd)  # Fixed limits/identity, stays outside.


class EntryComposition:
    """Source-only composition; external preparation ownership is unconnected.

    Root never reads fixture bytes or parses PRE JSON. Only the dropped child
    performs preparation. The parent retains opaque transport originals.
    """
    def __init__(self,environ=None):
        self.environ=dict(os.environ if environ is None else environ)
        self.bootstrap=BootstrapOps(self.environ);self.python=None;self.preparation=None
        self.pre_child=None;self.pre_started=False;self.outside_result=None
        self.final=None;self.failure=None;self.pre_git=None;self.preparation_ownership=None;self._preparation_original=None

    def validate(self):
        need(os.getresuid()==(0,)*3 and os.getresgid()==(0,)*3,'root outside composition parent required')
        ids=[self.environ.get('SUDO_'+name,'') for name in ('UID','GID')]
        need(all(re.fullmatch('[1-9][0-9]{0,9}',value) and int(value)<2**31 for value in ids),'trusted composition invoker')
        self.bootstrap.invoker=dict(zip(('uid','gid'),map(int,ids)))
        root=expected_cgroup(self.environ)
        need(all(re.fullmatch('[0-9a-f]{40}',self.environ.get(key,'')) for key in ('BW_EXPECTED_HEAD','BW_EXPECTED_TREE')),
             'fixed composition head/tree')
        text=entry_proc('/proc/self/cgroup')
        need(text.startswith('0::/') and text.endswith('\n') and text.count('\n')==1 and
             text[3:-1]!='/'+root.name and not text[3:-1].startswith('/'+root.name+'/'),'composition parent outside owned subtree')
        uid,gid=(self.bootstrap.invoker[key] for key in ('uid','gid'))
        for directory in (Path.cwd(),Path.cwd()/'build',Path.cwd()/STAGED_INPUTS):
            info=directory.lstat()
            need(directory.resolve(strict=True)==directory and stat.S_ISDIR(info.st_mode) and
                 (info.st_uid,info.st_gid)==(uid,gid),'canonical invoker-owned composition directory')
        need(Path(__file__).resolve(strict=True)==Path.cwd()/RUN_FILE,'held composition source path')
        files=RuntimeFiles();path,_=files.resolve(RUNTIME_EXECUTABLES['python'])
        need(files.resolve(sys.executable)[0]==path and stat.S_ISREG(Path(path).stat().st_mode) and
             Path(path).stat().st_mode & 0o6000==0,'observed non-setid composition Python')
        data=files.read(path,RUNTIME_CAPS['fileBytes'])
        need(type(data) is bytes and 0<len(data)<=RUNTIME_CAPS['fileBytes'],'observed bounded composition Python')
        self.python={'path':path,'bytes':len(data),'sha256':sha(data)}

    def require_preparation_ownership(self):
        if self.preparation_ownership is None:self.preparation_ownership=PreparationOwnership(self)
        self.preparation_ownership.admit()

    def finish_preparation_ownership(self,process):
        if self.preparation_ownership is None:return
        facts,failure=self.preparation_ownership.finish(process)
        if self.preparation is None:self.preparation={'process':process,'streams':{'stdout':b'','stderr':b''}}
        self.preparation['ownership']=facts
        if failure.first is not None:raise ObservedFailure(failure.first,failure.secondary)

    def create_preparation(self):
        self.require_preparation_ownership()
        self.pre_child=LinuxPreparation(self)
        return self.pre_child

    def prepare(self,failure):
        process=None;streams={'stdout':b'','stderr':b''}
        try:
            self.require_preparation_ownership()  # Before even factory construction.
            child=self.create_preparation();self.pre_started=True
            process,streams=collect_child(child,'preparation',child.argv,profile='preparation')
            self.preparation={'process':process,'streams':streams}
            failure.adopt(process['firstFailure'],process['secondary'])
            need(type(process['exitCode']) is int and process['exitCode']==0 and type(process['waitStatus']) is int and
                 process['waitStatus']==0 and process['signal'] is None and process['timedOut'] is False and
                 streams['stderr']==b'' and type(streams['stdout']) is bytes and
                 0<len(streams['stdout'])<=PREPARATION_STREAMS['stdout'],'successful bounded opaque PRE transport')
            self.pre_git=preparation_body(streams['stdout'])  # Opaque until the unprivileged finalizer.
        except BaseException as error:failure.add(error,'composition-preparation')
        finally:
            try:self.finish_preparation_ownership(process)
            except BaseException as error:failure.add(error,'composition-preparation-ownership')
            try:self.freeze_preparation_original(failure)
            except BaseException as error:failure.add(error,'composition-preparation-original')
        return failure

    def freeze_preparation_original(self,failure):
        """Capture only owned phase facts, never parse the opaque PRE body.

        Bytes are immutable and precede OutsideOwner. Caller-visible mutable
        dictionaries are not a replacement for this retained original.
        """
        need(self._preparation_original is None,'preparation original already frozen; no recapture')
        value=self.preparation or {};streams=value.get('streams',{'stdout':b'','stderr':b''})
        def stream(name):
            raw=streams[name]
            need(type(raw) is bytes and len(raw)<=PREPARATION_STREAMS[name],'bounded original preparation stream')
            return {'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode('ascii')}
        captured=time.monotonic_ns();need(type(captured) is int and captured>0,'original preparation capture clock')
        record={'schema':'bw.ring3.preparation-original.v1','runId':self.environ['GITHUB_RUN_ID'],'attempt':1,
            'head':self.environ['BW_EXPECTED_HEAD'],'tree':self.environ['BW_EXPECTED_TREE'],
            'python':self.python,'invoker':self.bootstrap.invoker,'captureMonoNs':captured,
            'process':value.get('process'),'stdout':stream('stdout'),'stderr':stream('stderr'),
            'ownership':value.get('ownership'),'preGit':None if self.pre_git is None else {'bytes':len(self.pre_git),'sha256':sha(self.pre_git)},
            'firstFailure':failure.first,'secondary':failure.secondary}
        raw=encode(record);need(len(raw)<=JSON_CAP,'preparation original encoding cap')
        self._preparation_original=raw

    def outside(self):
        need(os.getresuid()==(0,)*3 and os.getresgid()==(0,)*3,'composition root parent must retain privilege until outside observation')
        return outside_controller(OutsideOwner(BootstrapOps(self.environ)))

    def dropped(self):
        need(self.bootstrap.invoker is not None,'trusted composition invoker required')
        entry_ids(self.bootstrap.invoker['uid'],self.bootstrap.invoker['gid'])

    def failure_only(self,failure):
        # When no controller terminal is known, do not run POST Git/finalizer.
        # Return opaque partial process/streams; publication/retention wiring is
        # separately unconnected. A safe drop is required before owned writes.
        try:
            uid,gid=(self.bootstrap.invoker[key] for key in ('uid','gid'))
            if os.getresuid()!=(uid,)*3 or os.getresgid()!=(gid,)*3 or os.getgroups():self.bootstrap.drop()
            self.dropped()
            if type(self._preparation_original) is bytes:
                self._preparation_log=emit_originals({'preparation.phase.json':self._preparation_original},
                    sys.stdout.buffer.write,failure,sys.stdout.buffer.flush)
        except BaseException as error:failure.add(error,'composition-failure-drop')
        return {'pass':False,'preparation':self.preparation,'outside':self.outside_result,'final':None}

    def finalize(self,facts,failure):
        self.dropped()
        process=facts.get('process');cleanup=facts.get('cleanup') or {}
        terminal=(process if type(process) is dict and type(process.get('waitStatus')) is int else cleanup.get('cleanupTerminal'))
        need(type(terminal) is dict and type(terminal.get('waitStatus')) is int,'known outer terminal required before finalizer/POST Git')
        need(type(self._preparation_original) is bytes,'own frozen preparation original required')
        return finalize_packet(facts,failure,self.pre_git,self.environ,preparation_original=self._preparation_original)


class LinuxGeneratedPreparation(LinuxPreparation):
    def __init__(self,parent):
        super().__init__(parent);self.argv=[parent.python['path'],'-I','-B',RUN_FILE,'--prepare-generated']


class GeneratedEntryComposition(EntryComposition):
    """Unused generated-input transport. Root handles opaque framed bytes only."""
    def __init__(self,environ=None):
        super().__init__(environ);self._generation_original=None

    def create_preparation(self):
        self.require_preparation_ownership();self.pre_child=LinuxGeneratedPreparation(self);return self.pre_child

    def prepare(self,failure):
        process=None;streams={'stdout':b'','stderr':b''}
        try:
            self.require_preparation_ownership();child=self.create_preparation();self.pre_started=True
            process,streams=collect_child(child,'preparation',child.argv,profile='preparation')
            self.preparation={'process':process,'streams':streams};failure.adopt(process['firstFailure'],process['secondary'])
            self._generation_original,self.pre_git=generation_parts(streams['stdout'])
            self.preparation['generationOriginal']=self._generation_original
            need(type(process['exitCode']) is int and process['exitCode']==0 and type(process['waitStatus']) is int and
                 process['waitStatus']==0 and process['signal'] is None and process['timedOut'] is False and
                 streams['stderr']==b'' and len(self.pre_git)>0,'natural generated preparation with original PRE required')
        except BaseException as error:failure.add(error,'generated-composition-preparation')
        finally:
            try:self.finish_preparation_ownership(process)
            except BaseException as error:failure.add(error,'generated-composition-ownership')
            try:self.freeze_preparation_original(failure)
            except BaseException as error:failure.add(error,'generated-composition-original')
        return failure

    def freeze_preparation_original(self,failure):
        """Capture only owned phase facts, never parse the opaque PRE body.

        Bytes are immutable and precede OutsideOwner. Caller-visible mutable
        dictionaries are not a replacement for this retained original.
        """
        need(self._preparation_original is None,'preparation original already frozen; no recapture')
        value=self.preparation or {};streams=value.get('streams',{'stdout':b'','stderr':b''})
        def stream(name):
            raw=streams[name]
            need(type(raw) is bytes and len(raw)<=PREPARATION_STREAMS[name],'bounded original preparation stream')
            return {'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode('ascii')}
        captured=time.monotonic_ns();need(type(captured) is int and captured>0,'original preparation capture clock')
        record={'schema':'bw.ring3.preparation-original.v2','runId':self.environ['GITHUB_RUN_ID'],'attempt':1,
            'head':self.environ['BW_EXPECTED_HEAD'],'tree':self.environ['BW_EXPECTED_TREE'],
            'python':self.python,'invoker':self.bootstrap.invoker,'captureMonoNs':captured,
            'process':value.get('process'),'stdout':stream('stdout'),'stderr':stream('stderr'),
            'ownership':value.get('ownership'),'preGit':None if self.pre_git is None else {'bytes':len(self.pre_git),'sha256':sha(self.pre_git)},
            'firstFailure':failure.first,'secondary':failure.secondary}
        raw=encode(record);need(len(raw)<=JSON_CAP,'preparation original encoding cap')
        self._preparation_original=raw

    def finalize(self,facts,failure):
        self.dropped();process=facts.get('process');cleanup=facts.get('cleanup') or {}
        terminal=process if type(process) is dict and type(process.get('waitStatus')) is int else cleanup.get('cleanupTerminal')
        need(type(terminal) is dict and type(terminal.get('waitStatus')) is int,'known generated outer terminal required')
        need(type(self._preparation_original) is bytes and type(self._generation_original) is bytes,
             'own generated phase originals required')
        return finalize_packet(facts,failure,self.pre_git,self.environ,preparation_original=self._preparation_original,
                               generation_original=self._generation_original)

    def failure_only(self,failure):
        try:
            uid,gid=(self.bootstrap.invoker[key] for key in ('uid','gid'))
            if os.getresuid()!=(uid,)*3 or os.getresgid()!=(gid,)*3 or os.getgroups():self.bootstrap.drop()
            self.dropped()  # Required even when the attempted drop did not work.
            originals={}
            if type(self._preparation_original) is bytes:originals['preparation.phase.json']=self._preparation_original
            if type(self._generation_original) is bytes:originals['generation.phase.json']=self._generation_original
            if originals:self._preparation_log=emit_originals(originals,sys.stdout.buffer.write,failure,sys.stdout.buffer.flush)
        except BaseException as error:failure.add(error,'generated-composition-failure-drop')
        return {'pass':False,'preparation':self.preparation,'outside':self.outside_result,'final':None}


class LinuxAdmittedGeneratedPreparation(LinuxPreparation):
    def __init__(self,parent):
        super().__init__(parent)
        self.argv=[parent.python['path'],'-I','-B',RUN_FILE,'--prepare-admitted-generated']
        self.environment['BW_LAUNCH_PLAN_SHA256']=parent._expected_launch_plan_sha256


class AdmittedGeneratedEntryComposition(GeneratedEntryComposition):
    """Unwired plan delivery; expected digest selection is external authority.

    Root reads only opaque plan bytes. External job installation, approval and
    actual internal-mode dispatch remain separate, unconnected review work.
    """
    def __init__(self,expected_launch_plan_sha256,environ=None):
        need(type(expected_launch_plan_sha256) is str and re.fullmatch('[0-9a-f]{64}',expected_launch_plan_sha256),
             'explicit independently selected launch-plan digest')
        super().__init__(environ);self._expected_launch_plan_sha256=expected_launch_plan_sha256
        self._launch_plan_original=None;self._launch_plan_attempted=False

    def create_preparation(self):
        need(type(self._launch_plan_original) is bytes and
             sha(self._launch_plan_original)==self._expected_launch_plan_sha256,'own pinned opaque launch plan before child factory')
        self.require_preparation_ownership();self.pre_child=LinuxAdmittedGeneratedPreparation(self);return self.pre_child

    def capture_launch_plan(self):
        return read_launch_plan(self.environ,self._expected_launch_plan_sha256)

    def prepare(self,failure):
        try:
            need(not self._launch_plan_attempted,'launch-plan capture consumed; no retry')
            self._launch_plan_attempted=True  # Refusal consumes this instance before any read or root check.
            need(os.getresuid()==(0,)*3 and os.getresgid()==(0,)*3,'root opaque launch-plan capture required')
            need(self._launch_plan_original is None,'launch plan already captured; no recapture')
            self._launch_plan_original=self.capture_launch_plan()
            need(type(self._launch_plan_original) is bytes and sha(self._launch_plan_original)==self._expected_launch_plan_sha256,
                 'captured launch-plan bytes match independent digest')
        except BaseException as error:
            failure.add(error,'admitted-composition-launch-plan')
            try:self.freeze_preparation_original(failure)
            except BaseException as secondary:failure.add(secondary,'admitted-composition-original')
            return failure
        return super().prepare(failure)

    def freeze_preparation_original(self,failure):
        need(self._preparation_original is None,'preparation original already frozen; no recapture')
        value=self.preparation or {};streams=value.get('streams',{'stdout':b'','stderr':b''})
        def stream(name):
            raw=streams[name];need(type(raw) is bytes and len(raw)<=PREPARATION_STREAMS[name],'bounded original preparation stream')
            return {'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode('ascii')}
        captured=time.monotonic_ns();need(type(captured) is int and captured>0,'original preparation capture clock')
        record={'schema':'bw.ring3.preparation-original.v3','runId':self.environ['GITHUB_RUN_ID'],'attempt':1,
            'head':self.environ['BW_EXPECTED_HEAD'],'tree':self.environ['BW_EXPECTED_TREE'],
            'python':self.python,'invoker':self.bootstrap.invoker,'captureMonoNs':captured,
            'process':value.get('process'),'stdout':stream('stdout'),'stderr':stream('stderr'),
            'ownership':value.get('ownership'),'preGit':None if self.pre_git is None else {'bytes':len(self.pre_git),'sha256':sha(self.pre_git)},
            'firstFailure':failure.first,'secondary':failure.secondary}
        raw=encode(record);need(len(raw)<=JSON_CAP,'preparation original encoding cap');self._preparation_original=raw

    def finalize(self,facts,failure):
        self.dropped();process=facts.get('process');cleanup=facts.get('cleanup') or {}
        terminal=process if type(process) is dict and type(process.get('waitStatus')) is int else cleanup.get('cleanupTerminal')
        need(type(terminal) is dict and type(terminal.get('waitStatus')) is int,'known admitted outer terminal required')
        need(type(self._preparation_original) is bytes and type(self._generation_original) is bytes and
             type(self._launch_plan_original) is bytes,'own admitted phase/plan originals required')
        return finalize_packet(facts,failure,self.pre_git,self.environ,preparation_original=self._preparation_original,
            generation_original=self._generation_original,launch_plan_original=self._launch_plan_original,
            launch_plan_sha256=self._expected_launch_plan_sha256)

    def failure_only(self,failure):
        try:
            uid,gid=(self.bootstrap.invoker[key] for key in ('uid','gid'))
            if os.getresuid()!=(uid,)*3 or os.getresgid()!=(gid,)*3 or os.getgroups():self.bootstrap.drop()
            self.dropped();originals={}
            for name,raw in (('launch-plan.original.json',self._launch_plan_original),
                             ('preparation.phase.json',self._preparation_original),('generation.phase.json',self._generation_original)):
                if type(raw) is bytes:originals[name]=raw
            if originals:self._preparation_log=emit_originals(originals,sys.stdout.buffer.write,failure,sys.stdout.buffer.flush)
        except BaseException as error:failure.add(error,'admitted-composition-failure-drop')
        return {'pass':False,'preparation':self.preparation,'outside':self.outside_result,'final':None}


def compose_entry(ops=None):
    """No privilege regain: root waits for dropped prep child, then drops itself."""
    ops=EntryComposition() if ops is None else ops;failure=FirstFailure();ops.failure=failure
    try:
        ops.validate();ops.prepare(failure)
        if failure.first is not None or failure.secondary:return ops.failure_only(failure),failure
        need(type(ops.pre_git) is bytes and 0<len(ops.pre_git)<=GIT_TRACE_CAP,'original preparation PRE bytes required')
        need(type(ops._preparation_original) is bytes and 0<len(ops._preparation_original)<=JSON_CAP,'own frozen preparation original required before outside')
        facts,outside_failure=ops.outside();ops.outside_result=facts
        need(isinstance(outside_failure,FirstFailure),'original outside failure owner required')
        failure=outside_failure;ops.failure=failure  # Keep the SAME authoritative object.
        ops.final,returned_failure=ops.finalize(facts,failure)
        need(returned_failure is failure,'same authoritative outside failure through finalization')
        return {'pass':ops.final['pass'] is True and failure.first is None and failure.secondary==[],
                'preparation':ops.preparation,'outside':facts,'final':ops.final},failure
    except BaseException as error:
        failure.add(error,'composition');return ops.failure_only(failure),failure


class HostedSetupOps:
    """Fresh fixed hosted resources only; actual dispatch remains disabled.

    No shared controller enablement, adoption, retry, migration, kill or removal.
    Partial facts are memory-only and are not an installation original.
    """
    def __init__(self,expected_plan_sha256,environ=None):
        need(type(expected_plan_sha256) is str and re.fullmatch('[0-9a-f]{64}',expected_plan_sha256),'explicit hosted plan digest')
        self.environ=dict(os.environ if environ is None else environ);self.expected_plan_sha256=expected_plan_sha256
        self.invoker=None;self.plan_original=None;self.attempted=False;self.complete=False
        self.fds={};self.bindings={};self.owners={};self.control_owners={}
        self.facts={'created':[],'controls':{},'snapshots':{}}
        self.base=Path('/sys/fs/cgroup');self.manual=expected_cgroup(self.environ)
        self.preparation=self.manual.with_name(self.manual.name+'-preparation');self.checkout=None

    def root(self):
        need(os.getresuid()==(0,)*3 and os.getresgid()==(0,)*3,'root hosted setup required')

    def validate(self):
        self.root()
        ids=[self.environ.get('SUDO_'+key,'') for key in ('UID','GID')]
        need(all(type(value) is str and re.fullmatch('[1-9][0-9]{0,9}',value) and int(value)<2**31 for value in ids),
             'trusted positive hosted invoker')
        self.invoker=dict(zip(('uid','gid'),map(int,ids)))
        need(all(type(self.environ.get(key)) is str and re.fullmatch('[0-9a-f]{40}',self.environ[key]) for key in
                 ('BW_EXPECTED_HEAD','BW_EXPECTED_TREE')),'exact hosted source bindings')
        need(platform.system()=='Linux' and platform.machine()=='x86_64','fixed hosted Linux x86-64 setup')
        text=entry_proc('/proc/self/cgroup')
        names=('/'+self.manual.name,'/'+self.preparation.name)
        need(text.startswith('0::/') and text.endswith('\n') and text.count('\n')==1 and
             all(text[3:-1]!=name and not text[3:-1].startswith(name+'/') for name in names),'setup outside both fresh trees')
        self.checkout=Path.cwd()
        need(Path(__file__).resolve(strict=True)==self.checkout/RUN_FILE,'held hosted setup script location')

    def owner(self):return self.invoker['uid'],self.invoker['gid']

    def check_directory(self,path,descriptor,owner):
        held=os.fstat(descriptor);named=path.lstat()
        need(path.resolve(strict=True)==path and stat.S_ISDIR(held.st_mode) and
             stat.S_ISDIR(named.st_mode) and held.st_mode==named.st_mode and held.st_mode&0o022==0 and
             (held.st_uid,held.st_gid)==owner and (named.st_uid,named.st_gid)==owner and
             (held.st_dev,held.st_ino)==(named.st_dev,named.st_ino),'anchored hosted directory identity/owner')
        binding=(held.st_dev,held.st_ino)
        need(path not in self.bindings or self.bindings[path]==binding,'hosted setup directory identity drift')
        self.bindings[path]=binding;return held

    def open_directory(self,path,owner):
        if path in self.fds:
            self.check_directory(path,self.fds[path],owner);return self.fds[path]
        if path.parent in self.fds:
            descriptor=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=self.fds[path.parent])
        else:descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
        self.fds[path]=descriptor;self.owners[path]=owner
        self.check_directory(path,descriptor,owner);return descriptor

    def fresh_directory(self,path,owner,mode=0o755):
        need(path.parent in self.fds,'held fixed parent before exclusive directory creation')
        self.check_directory(path.parent,self.fds[path.parent],self.owners[path.parent])
        os.mkdir(path.name,0o700,dir_fd=self.fds[path.parent]);self.facts['created'].append(str(path))
        descriptor=self.open_directory(path,(0,0))
        if owner!=(0,0):os.fchown(descriptor,*owner)
        os.fchmod(descriptor,mode);self.owners[path]=owner;self.check_directory(path,descriptor,owner)
        return descriptor

    def control(self,path,name,data=None,delegate=False,inspect=False):
        reads=set(PreparationOwnership.FILES.values())|{'cgroup.controllers','cgroup.subtree_control','cgroup.type'}
        need(path==self.base or path in {self.manual,self.preparation,*(self.manual/role for role in ('controller','js','qemu'))},
             'fixed hosted cgroup directory')
        need(name in reads or name=='cgroup.kill','fixed hosted cgroup control')
        writable=set(Cgroups.FILES.values())|{'cgroup.subtree_control'}
        if data is not None:need(path!=self.base and name in writable and path in map(Path,self.facts['created']),
                                  'only fresh owned caps or subtree controls may be written')
        if delegate:
            need((path==self.manual and name=='cgroup.procs') or
                 (path in (self.manual/'js',self.manual/'qemu') and name in ('cgroup.procs','cgroup.kill')),
                 'fixed minimum migration/kill delegation')
        owner=self.control_owners.get((path,name),(0,0));directory=self.fds[path]
        self.check_directory(path,directory,self.owners[path])
        fd=os.open(name,(os.O_WRONLY if data is not None or delegate or name=='cgroup.kill' else os.O_RDONLY)|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=directory)
        first=None;result=None
        try:
            info=os.fstat(fd)
            need(stat.S_ISREG(info.st_mode) and info.st_dev==self.bindings[self.base][0] and
                 (info.st_uid,info.st_gid)==owner and info.st_mode&0o022==0,'held hosted control file identity/owner')
            if delegate:
                need(info.st_mode&0o200!=0,'delegated control requires existing owner-write permission')
                os.fchown(fd,*self.owner());self.control_owners[path,name]=self.owner()
                observed=os.fstat(fd);need((observed.st_uid,observed.st_gid)==self.owner() and
                    observed.st_mode==info.st_mode,'delegated fixed control readback preserves kernel mode')
            elif inspect:pass  # In particular, cgroup.kill may be write-only.
            elif data is not None:
                need(type(data) is bytes and 0<len(data)<=64 and os.write(fd,data)==len(data),'complete bounded hosted control write')
            else:
                raw=os.read(fd,4097);need(len(raw)<=4096,'hosted control read cap');result=raw.decode('ascii')
            after=os.fstat(fd)
            need((after.st_dev,after.st_ino)==(info.st_dev,info.st_ino) and
                 (after.st_uid,after.st_gid)==self.control_owners.get((path,name),(0,0)) and
                 after.st_mode==info.st_mode,'stable held hosted control identity/owner/mode')
            self.check_directory(path,directory,self.owners[path])
        except BaseException as error:first=error
        finally:first=close_owned(fd,first,'hosted-control-close')
        if first is not None:raise first
        if result is not None:self.facts['controls'][str(path/name)]=result
        return result

    def absent(self,parent,name):
        try:os.stat(name,dir_fd=self.fds[parent],follow_symlinks=False)
        except FileNotFoundError:return
        raise ValueError('hosted output or staging path already exists')

    def create(self):
        self.open_directory(self.checkout,self.owner());self.open_directory(self.base,(0,0))
        needed={'cpu','memory','pids'}
        need(needed<=set(self.control(self.base,'cgroup.controllers').split()) and
             needed<=set(self.control(self.base,'cgroup.subtree_control').split()),'parent controllers must already be enabled')
        build=self.checkout/'build'
        try:os.stat('build',dir_fd=self.fds[self.checkout],follow_symlinks=False)
        except FileNotFoundError:self.fresh_directory(build,self.owner())
        else:self.open_directory(build,self.owner())
        for name in (STAGED_INPUTS.name,PACKET.name,EXPORT.name):self.absent(build,name)
        self.fresh_directory(self.checkout/STAGED_INPUTS,self.owner(),0o700)
        self.fresh_directory(self.manual,(0,0))
        need(self.control(self.manual,'cgroup.procs')=='','fresh manual root must be empty before subtree enablement')
        need(self.control(self.manual,'cgroup.type').strip()=='domain','fresh manual domain cgroup')
        self.control(self.manual,'cgroup.subtree_control',b'+cpu +memory +pids')
        need(set(self.control(self.manual,'cgroup.subtree_control').split())==needed,'fresh manual child-controller readback')
        for path in (self.manual,*(self.manual/role for role in ('controller','js','qemu')),self.preparation):
            if path!=self.manual:self.fresh_directory(path,(0,0))
            need(self.control(path,'cgroup.type').strip()=='domain','fresh hosted domain cgroup')
            for key,name in Cgroups.FILES.items():self.control(path,name,LIMITS[key].encode('ascii'))
        for path in (self.manual,self.manual/'js',self.manual/'qemu'):
            self.control(path,'cgroup.procs',delegate=True)
            if path!=self.manual:self.control(path,'cgroup.kill',delegate=True)
        for path in (self.manual,*(self.manual/role for role in ('controller','js','qemu'))):
            os.fchown(self.fds[path],*self.owner());self.owners[path]=self.owner()
            self.check_directory(path,self.fds[path],self.owner())

    def readback(self):
        snapshots={};self.facts['snapshots']=snapshots
        for role,path in (('enclosing',self.manual),('controller',self.manual/'controller'),('js',self.manual/'js'),
                          ('qemu',self.manual/'qemu'),('preparation',self.preparation)):
            owner=(0,0) if role=='preparation' else self.owner();self.open_directory(path,owner)
            need(self.control(path,'cgroup.type').strip()=='domain','hosted readback domain cgroup')
            limits={key:self.control(path,name).strip() for key,name in Cgroups.FILES.items()}
            need(limits==LIMITS,'hosted limit readback drift')
            raw={key:self.control(path,name) for key,name in PreparationOwnership.FILES.items() if key not in LIMITS}
            need(raw['cgroupProcs']=='' and raw['pidsCurrent']=='0\n' and 'populated 0' in raw['cgroupEvents'].splitlines(),
                 'fresh hosted resource must be empty')
            identity={'device':self.bindings[path][0],'inode':self.bindings[path][1]}
            snapshots[role]={'identity':identity,'owner':{'uid':owner[0],'gid':owner[1]},'limits':limits,'raw':raw}
        identities=[tuple(value['identity'].values()) for value in snapshots.values()]
        need(len(set(identities))==5 and all(device==self.bindings[self.base][0] for device,inode in identities),
             'five distinct same-filesystem hosted resources')
        need(set(self.control(self.manual,'cgroup.subtree_control').split())=={'cpu','memory','pids'},
             'hosted root-owned subtree-control readback')
        # Recheck the minimum migration delegation; limits and all other
        # controls retain their root ownership through control() observations.
        for path in (self.manual,self.manual/'js',self.manual/'qemu'):
            self.control(path,'cgroup.procs')
            if path!=self.manual:self.control(path,'cgroup.kill',inspect=True)
        return snapshots

    def close(self,failure):
        descriptors=list(reversed(list(self.fds.values())));self.fds={}
        for descriptor in descriptors:
            try:os.close(descriptor)
            except BaseException as error:failure.add(error,'hosted-directory-close')

    def prepare(self):
        failure=FirstFailure()
        try:
            need(not self.attempted,'hosted setup consumed; no retry');self.attempted=True
            self.validate();self.plan_original=read_launch_plan(self.environ,self.expected_plan_sha256)
            need(type(self.plan_original) is bytes and sha(self.plan_original)==self.expected_plan_sha256,'hosted opaque plan capture')
            self.create();self.readback()
        except BaseException as error:failure.add(error,'hosted-setup')
        finally:self.close(failure)
        self.complete=failure.first is None and failure.secondary==[]
        return {'pass':self.complete,'facts':self.facts},failure

    def verify(self):
        failure=FirstFailure()
        try:
            self.root();need(self.complete and type(self.plan_original) is bytes and
                sha(self.plan_original)==self.expected_plan_sha256,'complete pinned hosted setup required')
            self.open_directory(self.base,(0,0));self.readback()
        except BaseException as error:failure.add(error,'hosted-setup-readback')
        finally:self.close(failure)
        if failure.first is not None:
            self.complete=False  # A repaired observation cannot revive refused setup.
            raise ObservedFailure(failure.first,failure.secondary)


class HostedEntryComposition(AdmittedGeneratedEntryComposition):
    def __init__(self,setup):
        super().__init__(setup.expected_plan_sha256,setup.environ);self.setup=setup

    def validate(self):
        self.setup.verify();super().validate()

    def capture_launch_plan(self):
        self.setup.verify();return self.setup.plan_original  # Same parent capture, not a second acquisition.

    def outside(self):
        self.setup.verify();return super().outside()


def hosted_entry(expected_plan_sha256,environ=None):
    setup=HostedSetupOps(expected_plan_sha256,environ);result,failure=setup.prepare()
    if result['pass'] is True and failure.first is None and failure.secondary==[]:
        returned,owned_failure=compose_entry(HostedEntryComposition(setup));returned['setup']=result
        return returned,owned_failure
    # No resources are killed or removed. Any available plan original can be
    # retained only after the same verified irreversible invoker drop.
    if setup.invoker is not None:
        parent=AdmittedGeneratedEntryComposition(expected_plan_sha256,setup.environ)
        parent.bootstrap.invoker=dict(setup.invoker);parent._launch_plan_original=setup.plan_original
        returned=parent.failure_only(failure);returned['setup']=result;return returned,failure
    return {'pass':False,'setup':result},failure


APPROVAL_REPOSITORY='CrispStrobe/bw-board'
APPROVAL_LABEL='x86-ring3-int-iret-actual'
RUNTIME_INPUT_PATH='ring3-runtime-expectation.json'
APPROVAL_BLOCK_START='<!-- BW_RING3_ACTUAL_REQUEST_V1\n'
APPROVAL_BLOCK_END='\nBW_RING3_ACTUAL_REQUEST_V1 -->'
RUNTIME_INPUT_CAP=256<<10  # Fits base64 Git API JSON within the existing JSON cap.


def admitted_original(value,cap,message):
    require_fields(value,'bytes sha256 base64',message)
    need(type(value['bytes']) is int and 0<value['bytes']<=cap and type(value['base64']) is str,
         'bounded original encoding')
    need(type(value['sha256']) is str and re.fullmatch('[0-9a-f]{64}',value['sha256']), 'original digest syntax')
    raw=base64.b64decode(value['base64'],validate=True)
    need(len(raw)==value['bytes'] and sha(raw)==value['sha256'] and
         base64.b64encode(raw).decode('ascii')==value['base64'],'exact original extent/digest/encoding')
    return raw


def original_bytes(raw):
    need(type(raw) is bytes and 0<len(raw)<=JSON_CAP,'bounded retained original')
    return {'bytes':len(raw),'sha256':sha(raw),'base64':base64.b64encode(raw).decode('ascii')}


def admit_approval_request(raw,expected_sha256):
    """Expected digest originates in separately retained pre-label review.

    A repository variable transports that selection; neither its presence nor
    event-body equality authenticates approval. No future run ID is approved here.
    """
    need(type(raw) is bytes and 0<len(raw)<=JSON_CAP and type(expected_sha256) is str and
         re.fullmatch('[0-9a-f]{64}',expected_sha256) and sha(raw)==expected_sha256,
         'externally selected approval-request digest')
    request=final_json(raw)
    require_fields(request,'schema repository pullRequest head tree source runtime','closed approval request')
    need(encode(request)==raw and request['schema']=='bw.ring3.approval-request.v1' and
         request['repository']==APPROVAL_REPOSITORY and type(request['pullRequest']) is int and
         0<request['pullRequest']<2**31,'canonical fixed repository approval request')
    source=admitted_original(request['source'],JSON_CAP,'closed approved source original')
    admit_generation_source(source,request['source']['sha256'],request['head'],request['tree'])
    runtime=request['runtime']
    require_fields(runtime,'commit tree path blob mode bytes sha256','closed immutable runtime input')
    need(runtime['path']==RUNTIME_INPUT_PATH and runtime['mode']=='100644' and
         type(runtime['bytes']) is int and 0<runtime['bytes']<=RUNTIME_INPUT_CAP,'fixed bounded runtime input')
    for key,size in (('commit',40),('tree',40),('blob',40),('sha256',64)):
        need(type(runtime[key]) is str and re.fullmatch('[0-9a-f]{'+str(size)+'}',runtime[key]),
             'immutable runtime input object/digest')
    return request


def admit_approval_event(event_raw,expected_request_sha256,environ):
    """Immutable platform snapshot joins; no moving PR-body API read."""
    need(type(event_raw) is bytes and 0<len(event_raw)<=JSON_CAP,'bounded raw official event')
    event=final_json(event_raw);need(type(event) is dict,'official event object')
    pr=event.get('pull_request');repo=event.get('repository');sender=event.get('sender');label=event.get('label')
    need(type(pr) is dict and type(repo) is dict and type(sender) is dict and type(label) is dict,
         'labeled PR event objects')
    need(event.get('action')=='labeled' and label.get('name')==APPROVAL_LABEL and
         repo.get('full_name')==APPROVAL_REPOSITORY and sender.get('login')=='CrispStrobe' and
         environ.get('GITHUB_EVENT_NAME')=='pull_request' and environ.get('GITHUB_REPOSITORY')==APPROVAL_REPOSITORY and
         environ.get('GITHUB_ACTOR')=='CrispStrobe','closed own labeled event and platform observations')
    body=pr.get('body');need(type(body) is str and body.count(APPROVAL_BLOCK_START)==1 and
         body.count(APPROVAL_BLOCK_END)==1,'one immutable approval request block')
    need(body.index(APPROVAL_BLOCK_START)<body.index(APPROVAL_BLOCK_END),'ordered approval request block')
    block=body.split(APPROVAL_BLOCK_START,1)[1].split(APPROVAL_BLOCK_END,1)[0]
    wrapper=final_json(block.encode());require_fields(wrapper,'bytes sha256 base64','closed event request wrapper')
    need(encode(wrapper).decode().rstrip('\n')==block,'canonical event request wrapper bytes')
    request_raw=admitted_original(wrapper,JSON_CAP,'bounded event request original')
    request=admit_approval_request(request_raw,expected_request_sha256)
    head=pr.get('head');base=pr.get('base')
    need(type(head) is dict and type(base) is dict and type(head.get('repo')) is dict and type(base.get('repo')) is dict and
         head['repo'].get('full_name')==APPROVAL_REPOSITORY and head['repo'].get('fork') is False and
         base['repo'].get('full_name')==APPROVAL_REPOSITORY and base.get('ref')=='master' and
         head.get('sha')==request['head'] and type(event.get('number')) is int and
         event['number']==request['pullRequest'] and type(pr.get('number')) is int and
         pr['number']==request['pullRequest'] and pr.get('state')=='open','exact own open PR/head joins')
    expected_cgroup(environ)
    need(environ.get('BW_EXPECTED_HEAD')==request['head'] and environ.get('BW_EXPECTED_TREE')==request['tree'] and
         environ.get('GITHUB_JOB')=='hosted-envelope-installation' and
         type(environ.get('GITHUB_WORKFLOW_SHA')) is str and
         re.fullmatch('[0-9a-f]{40}',environ['GITHUB_WORKFLOW_SHA']) and
         environ.get('GITHUB_WORKFLOW_REF')==APPROVAL_REPOSITORY+'/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/'+
             str(request['pullRequest'])+'/merge','official run/job/workflow observations')
    return request_raw,request


class ImmutableRuntimeInput:
    """Fixed public HTTPS metadata admission, then one immutable blob read.

    No credential/header from caller, proxies, moving refs, redirects or retry.
    API metadata is integrity evidence; approval is the external request pin.
    """
    API='https://api.github.com/repos/'+APPROVAL_REPOSITORY+'/git/'

    def __init__(self):self.attempted=False;self.observations=[]

    def response(self,suffix):
        need(type(suffix) is str and re.fullmatch('(commits|trees|blobs)/[0-9a-f]{40}',suffix),
             'closed owned immutable Git API route')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self,*args,**kwargs):raise ValueError('runtime input redirect refused')
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
        request=urllib.request.Request(self.API+suffix,headers={'Accept':'application/vnd.github+json',
            'User-Agent':'bw-ring3-immutable-input-v1','X-GitHub-Api-Version':'2022-11-28'})
        with opener.open(request,timeout=10) as response:
            need(response.status==200 and response.geturl()==self.API+suffix,'fixed successful runtime API response')
            raw=response.read(JSON_CAP+1)
            need(type(raw) is bytes and 0<len(raw)<=JSON_CAP,'bounded runtime API response')
        self.observations.append({'path':suffix,'response':original_bytes(raw)})
        return final_json(raw)

    def acquire(self,descriptor):
        need(not self.attempted,'immutable runtime acquisition consumed; no retry');self.attempted=True
        # Reuse complete request validation for untrusted public descriptor maps
        # only in the caller; capture the admitted descriptor before callbacks.
        descriptor=final_json(encode(descriptor))
        require_fields(descriptor,'commit tree path blob mode bytes sha256','closed transport runtime descriptor')
        need(descriptor['path']==RUNTIME_INPUT_PATH and descriptor['mode']=='100644' and
             type(descriptor['bytes']) is int and 0<descriptor['bytes']<=RUNTIME_INPUT_CAP,'fixed transport input path/mode/extent')
        for key,size in (('commit',40),('tree',40),('blob',40),('sha256',64)):
            need(type(descriptor[key]) is str and re.fullmatch('[0-9a-f]{'+str(size)+'}',descriptor[key]),
                 'fixed transport hexadecimal object/digest')
        commit=self.response('commits/'+descriptor['commit'])
        need(type(commit) is dict and commit.get('sha')==descriptor['commit'] and
             type(commit.get('tree')) is dict and commit['tree'].get('sha')==descriptor['tree'],
             'runtime input immutable commit/tree metadata')
        tree=self.response('trees/'+descriptor['tree'])
        need(type(tree) is dict and tree.get('sha')==descriptor['tree'] and tree.get('truncated') is False and
             type(tree.get('tree')) is list,'complete runtime input tree metadata')
        names=[]
        for item in tree['tree']:
            need(type(item) is dict and type(item.get('path')) is str and '/' not in item['path'] and
                 item['path'] not in ('','.','..') and item['path'] not in names,'unique well-formed root Git entries')
            names.append(item['path'])
        entries=[item for item in tree['tree'] if item['path']==RUNTIME_INPUT_PATH]
        need(len(entries)==1 and entries[0].get('mode')==descriptor['mode'] and entries[0].get('type')=='blob' and
             entries[0].get('sha')==descriptor['blob'] and type(entries[0].get('size')) is int and
             entries[0]['size']==descriptor['bytes'],'admitted runtime blob metadata BEFORE retrieval')
        blob=self.response('blobs/'+descriptor['blob'])
        need(type(blob) is dict and blob.get('sha')==descriptor['blob'] and blob.get('encoding')=='base64' and
             type(blob.get('size')) is int and blob['size']==descriptor['bytes'] and type(blob.get('content')) is str,
             'runtime immutable blob response')
        text=blob['content'];need(re.fullmatch('[A-Za-z0-9+/=\n]*',text) is not None,'Git base64 alphabet')
        raw=base64.b64decode(text.replace('\n',''),validate=True)
        need(base64.b64encode(raw).decode()==text.replace('\n','') and len(raw)==descriptor['bytes'] and
             sha(raw)==descriptor['sha256'] and
             hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==descriptor['blob'],
             'runtime input exact Git blob extent and independent digest')
        return raw


class HostedSourceGit(OutsideGit):
    def __init__(self,argv):
        super().__init__(argv)
        self.environment=dict(ENV,GIT_NO_LAZY_FETCH='1',GIT_CONFIG_NOSYSTEM='1')


class HostedEnvelopeInstaller:
    """Opaque input installation only; no resource or guest admission.

    Root does not parse runtime policy or synthesize an approved runtime graph.
    Partial facts survive failure in memory; installed records are not an
    independent setup observer or a cross-process kernel ownership lease.
    """
    def __init__(self,environ,transport=None):
        self.environ=dict(environ);self.transport=ImmutableRuntimeInput() if transport is None else transport
        self.attempted=False;self.facts={'created':[],'files':{},'transport':self.transport.observations,'sourceCommands':[]}
        self.checkout=None

    def event(self):
        path=self.environ.get('GITHUB_EVENT_PATH')
        need(type(path) is str and Path(path).is_absolute(),'official event snapshot path')
        path=Path(path);before=path.lstat()
        need(path.resolve(strict=True)==path and stat.S_ISREG(before.st_mode),'canonical regular official event snapshot')
        keys=('st_dev','st_ino','st_mode','st_uid','st_gid','st_nlink','st_size','st_mtime_ns')
        need(0<before.st_size<=JSON_CAP,'bounded official event snapshot extent')
        descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);first=None;raw=bytearray()
        try:
            need(all(getattr(before,key)==getattr(os.fstat(descriptor),key) for key in keys),'held official event path identity')
            while True:
                chunk=os.read(descriptor,min(65536,JSON_CAP+1-len(raw)))
                if not chunk:break
                raw.extend(chunk);need(len(raw)<=JSON_CAP,'official event read cap')
            after=path.lstat();held=os.fstat(descriptor)
            need(len(raw)==before.st_size and all(getattr(before,key)==getattr(after,key)==getattr(held,key) for key in keys) and
                 path.resolve(strict=True)==path,'stable official event path/held identity and bytes')
        except BaseException as error:first=error
        finally:first=close_owned(descriptor,first,'official-event-close')
        if first is not None:raise first
        self.facts['eventIdentity']={key:getattr(before,key) for key in keys}
        return bytes(raw)

    def source_command(self,argv,cap):
        git=['git','--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false']
        need(argv in (git+['rev-parse','HEAD'],git+['rev-parse','HEAD^{tree}'],
             git+['ls-tree','-r','HEAD','--',*sorted(SOURCE_PATHS)]) and
             len(self.facts['sourceCommands'])<3,'three fixed installer Git descriptors')
        checkout=self.checkout
        need(checkout is not None and Path.cwd()==checkout and checkout.resolve(strict=True)==checkout,
             'same frozen canonical installer checkout for every Git command')
        actual=['/usr/bin/git','-c','safe.directory='+str(checkout),*argv[1:]]
        process,streams=collect_child(HostedSourceGit(actual),'discovery',actual,profile='discovery')
        self.facts['sourceCommands'].append({'argv':actual,'process':process,'stdout':original_bytes(streams['stdout']) if streams['stdout'] else None,
            'stderr':original_bytes(streams['stderr']) if streams['stderr'] else None})
        if process['firstFailure'] is not None:raise ObservedFailure(process['firstFailure'],process['secondary'])
        need(streams['stderr']==b'' and len(streams['stdout'])<=cap,'installer Git bounded original output')
        return streams['stdout']

    def source(self,request):
        need(self.checkout is None,'installer checkout admission consumed')
        checkout=Path.cwd();info=checkout.lstat()
        need(checkout.resolve(strict=True)==checkout and stat.S_ISDIR(info.st_mode) and
             info.st_uid>0 and info.st_gid>0 and info.st_mode&0o022==0,
             'canonical nonwritable invoker-owned installer checkout')
        self.checkout=checkout
        def read(path,cap):
            target=Path(path);need(Path.cwd()==self.checkout and target.resolve(strict=True)==self.checkout/target and stat.S_ISREG(target.lstat().st_mode),
                 'canonical regular live installer source')
            raw,mode=bounded_read(target,cap,with_mode=True)
            need(mode=='100644','live installer source mode matches admitted regular Git mode')
            return raw
        observed=capture_source(request['head'],self.source_command,read)
        self.facts['source']=observed
        need(encode(observed)==admitted_original(request['source'],JSON_CAP,'approved source twelve original'),
             'all twelve live source modes/bytes/blobs and actual HEAD/tree match approval')

    def install(self,files):
        need(type(files) is dict and set(files)=={'request.original.json','event.original.json','runtime-expectation.json','launch-plan.json'} and
             all(type(raw) is bytes and 0<len(raw)<=JSON_CAP for raw in files.values()),'exact bounded installation input roster')
        path=launch_plan_path(self.environ).parent;parents={};descriptors=[];failure=None
        def identity(info):
            return {key:getattr(info,'st_'+key) for key in ('dev','ino','mode','uid','gid','nlink','size','mtime_ns')}
        def directory(name):
            fd=os.open(name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK)
            descriptors.append(fd);info=os.fstat(fd)
            need(stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==(0,0) and info.st_mode&0o022==0,
                 'root-owned nonwritable admission directory')
            return fd,identity(info)
        try:
            root,parents['/']=directory('/')
            run=os.open('run',os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=root)
            descriptors.append(run);info=os.fstat(run)
            need(stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==(0,0) and info.st_mode&0o022==0,
                 'root-owned nonwritable run directory');parents['/run']=identity(info)
            os.mkdir(path.name,0o755,dir_fd=run);self.facts['created'].append(str(path))
            held=os.open(path.name,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=run)
            descriptors.append(held);info=os.fstat(held)
            need(stat.S_ISDIR(info.st_mode) and (info.st_uid,info.st_gid)==(0,0) and stat.S_IMODE(info.st_mode)==0o755,
                 'fresh root-owned admission directory');self.facts['directory']=identity(info)
            for name,raw in files.items():
                need(name in ('request.original.json','event.original.json','runtime-expectation.json','launch-plan.json') and
                     type(raw) is bytes and 0<len(raw)<=JSON_CAP,'closed bounded installation file')
                fd=os.open(name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=held)
                descriptors.append(fd);self.facts['created'].append(str(path/name))
                need(os.write(fd,raw)==len(raw),'complete admission original installation write')
                os.fchmod(fd,0o444);before=os.fstat(fd)
                need(stat.S_ISREG(before.st_mode) and (before.st_uid,before.st_gid)==(0,0) and
                     stat.S_IMODE(before.st_mode)==0o444 and before.st_nlink==1 and before.st_size==len(raw),
                     'readonly single-link root-owned installed original')
                os.lseek(fd,0,os.SEEK_SET);readback=os.read(fd,len(raw)+1)
                need(readback==raw and identity(os.fstat(fd))==identity(before) and
                     identity(os.stat(name,dir_fd=held,follow_symlinks=False))==identity(before),
                     'held installed original bytes/identity readback')
                self.facts['files'][name]={'identity':identity(before),'bytes':len(raw),'sha256':sha(raw)}
            # This record witnesses this installer, not independent resources.
            record=encode({'schema':'bw.ring3.installation-envelope.v1','runId':self.environ['GITHUB_RUN_ID'],
                'attempt':1,'requestSha256':self.environ['BW_RING3_APPROVED_REQUEST_SHA256'],
                'launchPlanSha256':sha(files['launch-plan.json']),'files':self.facts['files'],
                'directory':self.facts['directory'],'ancestors':parents,
                'observations':{'sourceCommands':self.facts['sourceCommands'],'source':self.facts['source'],
                    'eventIdentity':self.facts.get('eventIdentity'),'transport':self.transport.observations}})
            need(len(record)<=JSON_CAP,'bounded installation envelope')
            fd=os.open('installation.original.json',os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_NONBLOCK,0o600,dir_fd=held)
            descriptors.append(fd);self.facts['created'].append(str(path/'installation.original.json'))
            need(os.write(fd,record)==len(record),'complete installation envelope write');os.fchmod(fd,0o444)
            before=os.fstat(fd);os.lseek(fd,0,os.SEEK_SET);readback=os.read(fd,len(record)+1)
            need(stat.S_ISREG(before.st_mode) and (before.st_uid,before.st_gid)==(0,0) and
                 stat.S_IMODE(before.st_mode)==0o444 and before.st_nlink==1 and before.st_size==len(record) and
                 readback==record and identity(os.fstat(fd))==identity(before) and
                 identity(os.stat('installation.original.json',dir_fd=held,follow_symlinks=False))==identity(before),
                 'readonly single-link installation envelope held bytes/identity readback')
            self.facts['files']['installation.original.json']={'identity':identity(before),'bytes':len(record),'sha256':sha(record)}
            for observed,actual in ((parents['/'],os.fstat(root)),(parents['/run'],os.fstat(run)),
                 (parents['/run'],os.stat('run',dir_fd=root,follow_symlinks=False)),
                 (self.facts['directory'],os.fstat(held)),(self.facts['directory'],os.stat(path.name,dir_fd=run,follow_symlinks=False))):
                need(all(observed[key]==getattr(actual,'st_'+key) for key in ('dev','ino','mode','uid','gid')),
                     'stable held installation directory and path binding')
            self.facts['installationOriginal']=record
        except BaseException as error:failure=error
        finally:
            for fd in reversed(descriptors):failure=close_owned(fd,failure,'envelope-install-close')
        if failure is not None:raise failure

    def prepare(self):
        failure=FirstFailure();installed=False
        try:
            need(not self.attempted,'hosted envelope installation consumed; no retry');self.attempted=True
            need(os.getresuid()==(0,0,0) and os.getresgid()==(0,0,0),'root opaque installer identity')
            event_raw=self.event();request_raw,request=admit_approval_event(event_raw,
                self.environ.get('BW_RING3_APPROVED_REQUEST_SHA256'),self.environ)
            self.facts['requestOriginal']=request_raw;self.facts['eventOriginal']=event_raw
            self.source(request)  # All source reads/Git observations precede any network or mutation.
            runtime=self.transport.acquire(final_json(encode(request['runtime'])))
            # Transport objects are injectable edges; admission repeats after
            # callback return, before the first privileged filesystem mutation.
            need(type(runtime) is bytes and len(runtime)==request['runtime']['bytes'] and
                 sha(runtime)==request['runtime']['sha256'] and
                 hashlib.sha1(b'blob '+str(len(runtime)).encode()+b'\0'+runtime).hexdigest()==request['runtime']['blob'],
                 'admitted opaque runtime input bytes before installation')
            plan=encode({'schema':'bw.ring3.launch-plan.v1','runId':self.environ['GITHUB_RUN_ID'],'attempt':1,
                'head':request['head'],'tree':request['tree'],'source':request['source']})
            admit_launch_plan(plan,sha(plan),self.environ)  # Delivery integrity, NOT approval.
            files={'request.original.json':request_raw,'event.original.json':event_raw,
                   'runtime-expectation.json':runtime,'launch-plan.json':plan}
            need(sum(map(len,files.values()))<=5<<20,'existing aggregate original byte cap')
            observations=encode({'sourceCommands':self.facts['sourceCommands'],'source':self.facts['source'],
                'eventIdentity':self.facts.get('eventIdentity'),'transport':self.transport.observations})
            need(len(observations)<=JSON_CAP-(64<<10),'installation observation originals fit unchanged JSON cap before mkdir')
            self.install(files);installed=True
            raise ValueError('installation only: independent runtime graph gate, setup observer, versioned delivery/reader and actual job activation pending')
        except BaseException as error:failure.add(error,'hosted-envelope-installation')
        return {'pass':False,'installationComplete':installed,'facts':self.facts},failure


def install_hosted_envelope(environ):
    return HostedEnvelopeInstaller(environ).prepare()


ACTUAL_ENTRY_ENABLED=False  # Activation requires a separate reviewed source/workflow change.


def dispatch_cli(argv=None,environ=None):
    parser=argparse.ArgumentParser(description=__doc__,allow_abbrev=False)
    modes=parser.add_mutually_exclusive_group(required=True)
    for name in ('controls','prepare-admitted-generated','bootstrap','controller','hosted-actual','install-hosted-envelope'):
        modes.add_argument('--'+name,action='store_const',const=name,dest='mode')
    argv=list(sys.argv[1:] if argv is None else argv)
    if len(argv)!=1:parser.error('exactly one fixed mode argument required')
    args=parser.parse_args(argv)
    failure=FirstFailure();result=None
    try:
        if args.mode=='controls':controls();return 0
        need(ACTUAL_ENTRY_ENABLED is True,'actual entry disabled pending final source/event/workflow admission')
        environ=dict(os.environ if environ is None else environ)
        if args.mode=='install-hosted-envelope':
            result,returned=install_hosted_envelope(environ)
            need(isinstance(returned,FirstFailure),'authoritative envelope installation failure required');failure=returned
        elif args.mode=='prepare-admitted-generated':
            result,returned=admitted_generated_preparation_child(environ)
            need(isinstance(returned,FirstFailure),'authoritative preparation failure required');failure=returned
        elif args.mode=='bootstrap':
            returned=controller_bootstrap(BootstrapOps(environ))
            need(isinstance(returned,FirstFailure),'bootstrap returned without authoritative failure');failure=returned
            failure.add(RuntimeError('bootstrap returned; successful exec cannot return'),'cli-bootstrap-return')
        elif args.mode=='controller':
            ops,returned=controller_execute(ControllerOps(environ))
            need(isinstance(returned,FirstFailure),'authoritative controller failure required');failure=returned
            result={'pass':failure.first is None and failure.secondary==[] and ops.unprivileged is True and
                ops.paths_admitted is True and set(ops.processes)=={'js','qemu'} and ops.source_after is not None and ops.runtime_after is not None}
        else:
            result,returned=hosted_entry(environ.get('BW_LAUNCH_PLAN_SHA256'),environ)
            need(isinstance(returned,FirstFailure),'authoritative hosted failure required');failure=returned
        need(isinstance(failure,FirstFailure),'authoritative CLI failure required')
        if type(result) is dict and result.get('pass') is True and failure.first is None and failure.secondary==[]:return 0
        if failure.first is None:failure.add(ValueError('CLI result and authoritative failures must both pass'),'cli-result')
    except BaseException as error:failure.add(error,'cli-dispatch')
    try:
        raw=encode({'schema':'bw.ring3.cli-failure.v1','mode':args.mode,'firstFailure':failure.first,'secondary':failure.secondary})
        need(len(raw)<=16384,'bounded CLI failure diagnostic');written=sys.stderr.buffer.write(raw)
        need(type(written) is int and written==len(raw),'complete CLI failure diagnostic');sys.stderr.buffer.flush()
    except BaseException:pass  # Exit remains nonzero even when stderr is unavailable.
    return 1

def controls():
    """Inert actual-function controls. Never opens a cgroup, forks or execs."""
    import unittest
    import contextlib
    import io
    from types import SimpleNamespace
    from unittest.mock import patch, Mock

    class Fake:
        def __init__(self, chunks=(), terminal=None, now_step=1, spawn_error=None, kill_error=None, close_error=None):
            self.chunks, self.status = list(chunks), terminal
            self.t, self.step, self.polls = 0, now_step, 0
            self.spawn_error, self.kill_error, self.close_error = spawn_error, kill_error, close_error
            self.calls = []
        def now(self): self.t += self.step; return self.t
        def spawn(self):
            self.calls.append('spawn')
            if self.spawn_error: raise self.spawn_error
            return {'pid':101,'pgid':101,'parentPid':100,'startTicks':123}
        def read_available(self, timeout):
            self.calls.append(('read',timeout))
            return self.chunks.pop(0) if self.chunks else []
        def reap(self):
            self.calls.append('reap'); self.polls += 1
            return self.status
        def kill(self):
            self.calls.append('kill')
            if self.kill_error: raise self.kill_error
        def close(self):
            self.calls.append('close')
            if self.close_error: raise self.close_error

    def status(code=0):
        return {'waitStatus':code<<8,'exitCode':code,'signal':None,
                'rusage':{'userSeconds':0.1,'systemSeconds':0.01,'maxRssKiB':1024}}

    class Tests(unittest.TestCase):
        def envelope_fixture(self):
            data={path:('held '+path+'\n').encode() for path in SOURCE_PATHS}
            source={'schema':'bw.ring3.source.v1','head':'a'*40,'tree':'b'*40,'files':{path:{'bytes':len(raw),
                'sha256':sha(raw),'mode':'100644','blob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()}
                for path,raw in data.items()}}
            runtime=b'{"unqualifiedOpaqueRuntime":true}\n'
            descriptor={'commit':'c'*40,'tree':'d'*40,'path':RUNTIME_INPUT_PATH,'mode':'100644','bytes':len(runtime),
                'sha256':sha(runtime),'blob':hashlib.sha1(b'blob '+str(len(runtime)).encode()+b'\0'+runtime).hexdigest()}
            request={'schema':'bw.ring3.approval-request.v1','repository':APPROVAL_REPOSITORY,'pullRequest':645,
                'head':source['head'],'tree':source['tree'],'source':original_bytes(encode(source)),'runtime':descriptor}
            raw=encode(request)
            event={'action':'labeled','number':645,'repository':{'full_name':APPROVAL_REPOSITORY},
                'sender':{'login':'CrispStrobe'},'label':{'name':APPROVAL_LABEL},'pull_request':{
                    'number':645,'state':'open','body':APPROVAL_BLOCK_START+encode(original_bytes(raw)).decode().rstrip('\n')+APPROVAL_BLOCK_END,
                    'head':{'sha':source['head'],'repo':{'full_name':APPROVAL_REPOSITORY,'fork':False}},
                    'base':{'ref':'master','repo':{'full_name':APPROVAL_REPOSITORY}}}}
            env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','GITHUB_EVENT_PATH':'/event.json',
                'GITHUB_EVENT_NAME':'pull_request','GITHUB_REPOSITORY':APPROVAL_REPOSITORY,'GITHUB_ACTOR':'CrispStrobe',
                'GITHUB_JOB':'hosted-envelope-installation','GITHUB_WORKFLOW_SHA':'e'*40,
                'GITHUB_WORKFLOW_REF':APPROVAL_REPOSITORY+'/.github/workflows/i80386-ring3-int-iret.yml@refs/pull/645/merge',
                'BW_EXPECTED_HEAD':source['head'],'BW_EXPECTED_TREE':source['tree'],'BW_RING3_APPROVED_REQUEST_SHA256':sha(raw)}
            responses={'commits/'+descriptor['commit']:{'sha':descriptor['commit'],'tree':{'sha':descriptor['tree']}},
                'trees/'+descriptor['tree']:{'sha':descriptor['tree'],'truncated':False,'tree':[{'path':RUNTIME_INPUT_PATH,
                    'mode':'100644','type':'blob','sha':descriptor['blob'],'size':len(runtime)}]},
                'blobs/'+descriptor['blob']:{'sha':descriptor['blob'],'encoding':'base64','size':len(runtime),
                    'content':base64.b64encode(runtime).decode()+'\n'}}
            return env,event,request,raw,runtime,data,responses

        @contextlib.contextmanager
        def envelope_edges(self,env,data,responses):
            state={'rows':{},'fds':{},'next':50,'events':[],'fault':None}
            def row(path,mode,raw=b''):
                state['rows'][str(path)]={'st_dev':1,'st_ino':len(state['rows'])+1,'st_mode':mode,
                    'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':len(raw),'st_mtime_ns':1,'raw':raw}
            row('/',0o40755);row('/run',0o40755)
            def pathof(name,dir_fd=None):return str(Path(state['fds'][dir_fd]['path'])/name) if dir_fd is not None else str(name)
            def info(path):return SimpleNamespace(**{k:v for k,v in state['rows'][path].items() if k!='raw'})
            def opened(name,flags,mode=0o777,dir_fd=None):
                path=pathof(name,dir_fd)
                if flags&os.O_CREAT:
                    self.assertTrue(flags&os.O_EXCL);self.assertTrue(flags&os.O_NOFOLLOW)
                    if path in state['rows']:raise FileExistsError(path)
                    row(path,stat.S_IFREG|mode)
                if path not in state['rows']:raise FileNotFoundError(path)
                state['next']+=1;fd=state['next'];state['fds'][fd]={'path':path,'offset':0}
                state['events'].append(('open',path));return fd
            def mkdir(name,mode,dir_fd=None):
                path=pathof(name,dir_fd);state['events'].append(('mkdir',path))
                if path in state['rows']:raise FileExistsError(path)
                row(path,stat.S_IFDIR|mode)
            def write(fd,raw):
                path=state['fds'][fd]['path'];state['events'].append(('write',path))
                if state['fault']=='write':raise OSError('ORIGINAL_INSTALL_WRITE')
                state['rows'][path].update(raw=raw,st_size=len(raw));return len(raw)-(state['fault']=='short')
            def read(fd,cap):
                path=state['fds'][fd]['path'];raw=state['rows'][path]['raw']
                return b'CHANGED' if state['fault']=='readback' or (state['fault']=='record-readback' and path.endswith('/installation.original.json')) else raw[:cap]
            def chmod(fd,mode):
                path=state['fds'][fd]['path'];state['rows'][path]['st_mode']=stat.S_IFREG|mode
                if state['fault']=='owner':state['rows'][path]['st_uid']=1001
                if state['fault']=='links':state['rows'][path]['st_nlink']=2
                if state['fault']=='input-mode' and not path.endswith('/installation.original.json'):state['rows'][path]['st_mode']=0o100644
                if state['fault']=='record-mode' and path.endswith('/installation.original.json'):state['rows'][path]['st_mode']=0o100644
            def close(fd):
                state['fds'].pop(fd)
                if state['fault']=='close':raise OSError('ORIGINAL_INSTALL_CLOSE')
            def git(argv,cap):
                state['events'].append(('git',tuple(argv)))
                if argv[-1]=='HEAD':return (env['BW_EXPECTED_HEAD']+'\n').encode()
                if argv[-1]=='HEAD^{tree}':return (env['BW_EXPECTED_TREE']+'\n').encode()
                return ''.join('100644 blob '+hashlib.sha1(b'blob '+str(len(data[path])).encode()+b'\0'+data[path]).hexdigest()+
                    '\t'+path+'\n' for path in sorted(data)).encode()
            def source_read(path,cap,with_mode=False):
                raw=data[str(path)];return (raw,'100755' if state['fault']=='source-mode' else '100644') if with_mode else raw
            def response(suffix):
                state['events'].append(('network',suffix));return final_json(encode(responses[suffix]))
            with contextlib.ExitStack() as stack:
                for context in (patch.object(os,'getresuid',return_value=(0,)*3),patch.object(os,'getresgid',return_value=(0,)*3),
                    patch.object(os,'open',side_effect=opened),patch.object(os,'mkdir',side_effect=mkdir),
                    patch.object(os,'write',side_effect=write),patch.object(os,'read',side_effect=read),
                    patch.object(os,'lseek',return_value=0),patch.object(os,'fchmod',side_effect=chmod),
                    patch.object(os,'close',side_effect=close),patch.object(os,'fstat',side_effect=lambda fd:info(state['fds'][fd]['path'])),
                    patch.object(os,'stat',side_effect=lambda name,dir_fd=None,**kw:info(pathof(name,dir_fd))),
                    patch.object(Path,'cwd',return_value=Path('/checkout')),
                    patch.object(Path,'resolve',lambda path,**kw:path if path.is_absolute() else Path('/checkout')/path),
                    patch.object(Path,'lstat',lambda path:SimpleNamespace(st_mode=0o40755 if str(path)=='/checkout' else 0o100644,
                        st_uid=1001,st_gid=1002)),
                    patch.dict(globals(),bounded_read=source_read),patch.object(HostedEnvelopeInstaller,'source_command',side_effect=git),
                    patch.object(ImmutableRuntimeInput,'response',side_effect=response)):
                    stack.enter_context(context)
                yield state

        def test_envelope_request_event_external_pin_and_exact_source_join(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            got,admitted=admit_approval_event(encode(event),sha(raw),env)
            self.assertEqual(got,raw);self.assertEqual(admitted,request)
            for pin in (None,'0'*64,sha(encode(event))):
                with self.assertRaises(ValueError):admit_approval_event(encode(event),pin,env)
            changed=final_json(raw);changed['pullRequest']=True
            with self.assertRaises(ValueError):admit_approval_request(encode(changed),sha(encode(changed)))
            changed=final_json(raw);changed['unexpected']=1
            with self.assertRaises(ValueError):admit_approval_request(encode(changed),sha(encode(changed)))
            with self.assertRaises(ValueError):admit_approval_request(raw.rstrip(),sha(raw.rstrip()))
            duplicate=raw.replace(b'"pullRequest":645',b'"pullRequest":645,"pullRequest":645')
            with self.assertRaises(ValueError):admit_approval_request(duplicate,sha(duplicate))

        def test_envelope_event_held_snapshot_identity_extent_and_close_refusals(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture();event_raw=encode(event)
            for fault in ('none','held-identity','path-identity','extent','close'):
                initial=SimpleNamespace(st_dev=1,st_ino=2,st_mode=0o100644,st_uid=1001,st_gid=1002,
                    st_nlink=1,st_size=len(event_raw),st_mtime_ns=1)
                changed=SimpleNamespace(**vars(initial));changed.st_ino=9
                reads=[event_raw,b''] if fault!='extent' else [event_raw[:-1],b'']
                with patch.object(Path,'resolve',lambda path,**kw:path),patch.object(Path,'lstat',side_effect=[initial,
                        changed if fault=='path-identity' else initial]),patch.object(os,'open',return_value=77) as opened,\
                     patch.object(os,'fstat',return_value=changed if fault=='held-identity' else initial),\
                     patch.object(os,'read',side_effect=reads),patch.object(os,'close',side_effect=OSError('EVENT_CLOSE') if fault=='close' else None) as closed:
                    installer=HostedEnvelopeInstaller(env)
                    if fault=='none':self.assertEqual(installer.event(),event_raw);self.assertEqual(installer.facts['eventIdentity']['st_ino'],2)
                    else:
                        with self.assertRaises((ValueError,OSError)):installer.event()
                    closed.assert_called_once_with(77)
                    self.assertTrue(opened.call_args.args[1]&os.O_NOFOLLOW)

        def test_envelope_source_git_frozen_checkout_scoped_safe_directory_and_no_lazy_fetch(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture();installer=HostedEnvelopeInstaller(env)
            git=['git','--no-replace-objects','-c','gc.auto=0','-c','maintenance.auto=false','rev-parse','HEAD']
            installer.checkout=Path('/checkout');process={'firstFailure':None,'secondary':[]}
            with patch.object(Path,'cwd',return_value=Path('/checkout')),patch.object(Path,'resolve',lambda path,**kw:path),\
                 patch.dict(globals(),collect_child=Mock(return_value=(process,{'stdout':b'head\n','stderr':b''}))) as patched:
                self.assertEqual(installer.source_command(git,1024),b'head\n')
                tool,role,argv=patched['collect_child'].call_args.args
                self.assertEqual(argv[:3],['/usr/bin/git','-c','safe.directory=/checkout'])
                self.assertEqual(argv[3:],git[1:]);self.assertEqual(tool.environment,dict(ENV,GIT_NO_LAZY_FETCH='1',GIT_CONFIG_NOSYSTEM='1'))
            with patch.object(Path,'cwd',return_value=Path('/other')),patch.dict(globals(),collect_child=Mock(side_effect=AssertionError('no moved checkout child'))):
                with self.assertRaisesRegex(ValueError,'same frozen'):installer.source_command(git,1024)

        def test_envelope_event_each_authority_and_platform_join_refuses(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            edits=[(('action',),'synchronize'),(('number',),True),(('sender','login'),'other'),
                (('label','name'),'other'),(('repository','full_name'),'other/repo'),
                (('pull_request','head','sha'),'f'*40),(('pull_request','head','repo','fork'),True),
                (('pull_request','base','ref'),'other'),(('pull_request','state'),'closed'),
                (('pull_request','number'),1),(('pull_request','body'),event['pull_request']['body']*2),
                (('pull_request','body'),event['pull_request']['body'].replace('{','{ ',1))]
            for keys,value in edits:
                changed=final_json(encode(event));target=changed
                for key in keys[:-1]:target=target[key]
                target[keys[-1]]=value
                with self.subTest(keys=keys),self.assertRaises(ValueError):admit_approval_event(encode(changed),sha(raw),env)
            for key in ('GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE','GITHUB_JOB','GITHUB_ACTOR',
                        'GITHUB_EVENT_NAME','GITHUB_REPOSITORY','GITHUB_WORKFLOW_SHA','GITHUB_WORKFLOW_REF'):
                with self.subTest(key=key),self.assertRaises((ValueError,TypeError)):
                    admit_approval_event(encode(event),sha(raw),dict(env,**{key:'invalid'}))

        def test_envelope_real_transport_order_digest_and_one_acquisition(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture();transport=ImmutableRuntimeInput()
            with patch.object(transport,'response',side_effect=lambda suffix:responses[suffix]) as observed:
                self.assertEqual(transport.acquire(request['runtime']),runtime)
                self.assertEqual([call.args[0].split('/')[0] for call in observed.call_args_list],['commits','trees','blobs'])
                with self.assertRaisesRegex(ValueError,'consumed'):transport.acquire(request['runtime'])
                self.assertEqual(observed.call_count,3)

        def test_envelope_transport_wrong_metadata_refuses_before_blob_and_no_repair(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            for fault in ('commit','tree','truncated','duplicate','mode','kind','extent','malformed'):
                changed=final_json(encode(responses));commit=changed['commits/'+request['runtime']['commit']]
                tree=changed['trees/'+request['runtime']['tree']];entry=tree['tree'][0]
                if fault=='commit':commit['sha']='f'*40
                elif fault=='tree':commit['tree']['sha']='f'*40
                elif fault=='truncated':tree['truncated']=True
                elif fault=='duplicate':tree['tree'].append(dict(entry))
                elif fault=='mode':entry['mode']='120000'
                elif fault=='kind':entry['type']='commit'
                elif fault=='extent':entry['size']=True
                else:tree['tree'].append({'path':'bad/path'})
                transport=ImmutableRuntimeInput()
                with patch.object(transport,'response',side_effect=lambda suffix:changed[suffix]) as observed:
                    with self.assertRaises(ValueError):transport.acquire(request['runtime'])
                    self.assertFalse(any(call.args[0].startswith('blobs/') for call in observed.call_args_list),fault)
                    with self.assertRaisesRegex(ValueError,'consumed'):transport.acquire(request['runtime'])
            for field,value in (('path','../other'),('commit','main'),('bytes',True),('mode','160000')):
                transport=ImmutableRuntimeInput()
                with patch.object(transport,'response',side_effect=AssertionError('no request before descriptor admission')):
                    with self.assertRaises(ValueError):transport.acquire(dict(request['runtime'],**{field:value}))

        def test_envelope_transport_blob_hash_bytes_and_base64_mutations_refuse(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            for fault in ('sha','extent','encoding','base64','bytes','sha256','git-sha1'):
                changed=final_json(encode(responses));descriptor=dict(request['runtime']);blob=changed['blobs/'+descriptor['blob']]
                if fault=='sha':blob['sha']='f'*40
                elif fault=='extent':blob['size']=True
                elif fault=='encoding':blob['encoding']='utf-8'
                elif fault=='base64':blob['content']+=' '
                elif fault=='bytes':blob['content']=base64.b64encode(b'x'*len(runtime)).decode()
                elif fault=='sha256':descriptor['sha256']='f'*64
                else:
                    descriptor['blob']='f'*40
                    changed['trees/'+descriptor['tree']]['tree'][0]['sha']=descriptor['blob']
                    changed['blobs/'+descriptor['blob']]=dict(blob,sha=descriptor['blob'])
                with patch.object(ImmutableRuntimeInput,'response',side_effect=lambda suffix:changed[suffix]):
                    with self.subTest(fault=fault),self.assertRaises(ValueError):ImmutableRuntimeInput().acquire(descriptor)

        def test_envelope_https_fixed_request_no_proxies_redirects_or_unbounded_response(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            suffix='commits/'+request['runtime']['commit'];url=ImmutableRuntimeInput.API+suffix
            for fault in ('none','status','url','cap'):
                response=Mock();response.status=500 if fault=='status' else 200
                response.geturl.return_value='https://other.invalid/' if fault=='url' else url
                response.read.return_value=b'x'*(JSON_CAP+1) if fault=='cap' else encode(responses[suffix])
                opened=Mock();opened.__enter__=Mock(return_value=response);opened.__exit__=Mock(return_value=False)
                opener=Mock();opener.open.return_value=opened
                with patch.object(urllib.request,'build_opener',return_value=opener) as build:
                    transport=ImmutableRuntimeInput()
                    if fault=='none':self.assertEqual(transport.response(suffix),responses[suffix]);self.assertEqual(len(transport.observations),1)
                    else:
                        with self.assertRaises(ValueError):transport.response(suffix)
                    self.assertEqual(build.call_args.args[0].proxies,{})
                    with self.assertRaises(ValueError):build.call_args.args[1].redirect_request(None,None,None,None,None,None)
                    sent=opener.open.call_args.args[0];self.assertEqual(sent.full_url,url)
                    self.assertNotIn('Authorization',sent.headers);self.assertEqual(opener.open.call_args.kwargs,{'timeout':10})
                    if fault not in ('status','url'):response.read.assert_called_once_with(JSON_CAP+1)

        def test_envelope_source_event_transport_install_coherent_path_still_terminal_refusal(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            with self.envelope_edges(env,data,responses) as state:
                installer=HostedEnvelopeInstaller(env)
                with patch.object(installer,'event',return_value=encode(event)):
                    result,failure=installer.prepare()
                self.assertFalse(result['pass']);self.assertTrue(result['installationComplete'])
                self.assertIn('independent runtime graph gate',failure.first['message']);self.assertFalse(failure.secondary)
                self.assertEqual(state['fds'],{});self.assertEqual(len(installer.facts['files']),5)
                events=[item[0] for item in state['events']];self.assertLess(events.index('git'),events.index('network'))
                self.assertLess(max(i for i,x in enumerate(events) if x=='network'),events.index('mkdir'))
                for name,item in installer.facts['files'].items():
                    self.assertEqual(item['identity']['mode'],0o100444);self.assertEqual(item['identity']['nlink'],1)
                    installed=state['rows'][str(launch_plan_path(env).parent/name)]['raw']
                    self.assertEqual(sha(installed),item['sha256'])
                plan=state['rows'][str(launch_plan_path(env))]['raw'];admit_launch_plan(plan,sha(plan),env)
                record=final_json(installer.facts['installationOriginal']);self.assertEqual(record['requestSha256'],sha(raw))
                self.assertEqual(record['launchPlanSha256'],sha(plan));self.assertNotEqual(sha(plan),sha(raw))
                count=len(state['events']);again,refused=installer.prepare()
                self.assertFalse(again['installationComplete']);self.assertIn('consumed',refused.first['message'])
                self.assertEqual(len(state['events']),count)

        def test_envelope_early_source_pin_and_fetched_bytes_refuse_before_install(self):
            for fault in ('pin','head','tree','source-mode','source-bytes','runtime'):
                env,event,request,raw,runtime,data,responses=self.envelope_fixture()
                if fault=='pin':env['BW_RING3_APPROVED_REQUEST_SHA256']='0'*64
                elif fault=='head':env['BW_EXPECTED_HEAD']='f'*40
                elif fault=='tree':env['BW_EXPECTED_TREE']='f'*40
                elif fault=='source-bytes':data[RUN_FILE]=b'changed runner\n'
                with self.envelope_edges(env,data,responses) as state:
                    if fault=='source-mode':state['fault']=fault
                    installer=HostedEnvelopeInstaller(env)
                    with patch.object(installer,'event',return_value=encode(event)),contextlib.ExitStack() as extra:
                        if fault=='runtime':extra.enter_context(patch.object(installer.transport,'acquire',return_value=b'x'*len(runtime)))
                        result,failure=installer.prepare()
                    self.assertFalse(result['installationComplete']);self.assertIsNotNone(failure.first)
                    self.assertFalse(any(item[0]=='mkdir' for item in state['events']),fault)
                    if fault!='runtime':self.assertFalse(any(item[0]=='network' for item in state['events']),fault)

        def test_envelope_installer_partial_failures_preserve_first_no_adopt_retry_cleanup(self):
            for fault in ('write','short','readback','owner','links','close','preexisting','record-readback','record-mode','input-mode'):
                env,event,request,raw,runtime,data,responses=self.envelope_fixture()
                with self.envelope_edges(env,data,responses) as state:
                    state['fault']=fault
                    if fault=='preexisting':state['rows'][str(launch_plan_path(env).parent)]=dict(state['rows']['/run'])
                    installer=HostedEnvelopeInstaller(env)
                    with patch.object(installer,'event',return_value=encode(event)):
                        result,failure=installer.prepare()
                    self.assertFalse(result['installationComplete']);self.assertIsNotNone(failure.first)
                    self.assertEqual(state['fds'],{})
                    if fault=='write':self.assertEqual(failure.first['message'],'ORIGINAL_INSTALL_WRITE')
                    if fault!='preexisting':self.assertTrue(result['facts']['created'])
                    count=len(state['events']);state['fault']=None
                    again,refused=installer.prepare();self.assertIn('consumed',refused.first['message'])
                    self.assertEqual(len(state['events']),count)

        def test_envelope_coherent_transport_descriptor_replacement_cannot_repin_approved_bytes(self):
            env,event,request,raw,runtime,data,responses=self.envelope_fixture()
            replacement=b'x'*len(runtime);seen=[]
            def acquire(descriptor):
                seen.append(descriptor)
                descriptor.update(bytes=len(replacement),sha256=sha(replacement),
                    blob=hashlib.sha1(b'blob '+str(len(replacement)).encode()+b'\0'+replacement).hexdigest())
                return replacement
            with self.envelope_edges(env,data,responses) as state:
                installer=HostedEnvelopeInstaller(env)
                with patch.object(installer,'event',return_value=encode(event)),\
                     patch.object(installer.transport,'acquire',side_effect=acquire):
                    result,failure=installer.prepare()
                self.assertFalse(result['installationComplete']);self.assertFalse(result['pass'])
                self.assertEqual(failure.first['message'],'admitted opaque runtime input bytes before installation')
                self.assertEqual(len(seen),1);self.assertEqual(seen[0]['sha256'],sha(replacement))
                held=final_json(installer.facts['requestOriginal'])
                self.assertEqual(held,request);self.assertEqual(held['runtime']['sha256'],sha(runtime))
                self.assertNotEqual(held['runtime']['sha256'],seen[0]['sha256'])
                self.assertFalse(any(item[0]=='mkdir' for item in state['events']));self.assertEqual(state['fds'],{})

        def test_envelope_cli_fixed_sixth_mode_static_guard_and_terminal_status(self):
            output=io.BytesIO();handler=Mock(side_effect=AssertionError('guard before factory'))
            with patch.dict(globals(),install_hosted_envelope=handler),patch.object(sys,'stderr',SimpleNamespace(buffer=output)):
                self.assertEqual(dispatch_cli(['--install-hosted-envelope'],object()),1)
            handler.assert_not_called();self.assertIn(b'actual entry disabled',output.getvalue())
            for argv in (['--install-hosted-envelope']*2,['--install-hosted-envelope','--help'],['--install-hosted'],
                         ['--controls','--install-hosted-envelope']):
                with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as caught:dispatch_cli(argv,{})
                self.assertEqual(caught.exception.code,2)
            failure=FirstFailure();failure.add(ValueError('EXACT_TERMINAL_PREREQUISITE'),'installation')
            with patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True,install_hosted_envelope=Mock(return_value=(
                {'pass':False,'installationComplete':True},failure))),patch.object(sys,'stderr',SimpleNamespace(buffer=output)):
                self.assertEqual(dispatch_cli(['--install-hosted-envelope'],{}),1)
            self.assertIn(b'EXACT_TERMINAL_PREREQUISITE',output.getvalue())

        @contextlib.contextmanager
        def hosted_kernel_edges(self):
            env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40,
                 'SUDO_UID':'1001','SUDO_GID':'1002'}
            state={'rows':{},'fds':{},'nextFd':50,'nextInode':10,'events':[],'uids':(0,)*3,'gids':(0,)*3,'groups':[],
                   'faults':{},'plan':b'opaque independently selected plan','planReads':0,'membership':'0::/actions/job\n'}
            checkout=Path('/checkout');base=Path('/sys/fs/cgroup');manual=expected_cgroup(env)
            def row(path,mode,uid=0,gid=0,data=b''):
                state['nextInode']+=1
                state['rows'][path]={'st_dev':3 if path.is_relative_to(base) else 4,'st_ino':state['nextInode'],
                    'st_mode':mode,'st_uid':uid,'st_gid':gid,'st_nlink':1,'st_size':0,'st_mtime_ns':1,'data':data}
            row(checkout,0o40755,1001,1002);row(base,0o40755);row(Path('/usr/bin/python3.12'),0o100755)
            defaults={'cgroup.controllers':b'cpu memory pids\n','cgroup.subtree_control':b'', 'cgroup.type':b'domain\n',
                'cgroup.procs':b'','cgroup.events':b'populated 0\n','pids.current':b'0\n','memory.current':b'0\n',
                'memory.peak':b'0\n','memory.events':b'oom 0\noom_kill 0\n','cpu.stat':b'usage_usec 0\nuser_usec 0\nsystem_usec 0\n',
                'cpu.max':b'max 100000\n','memory.max':b'max\n','memory.swap.max':b'max\n','pids.max':b'max\n','cgroup.kill':b''}
            def controls(path):
                for name,data in defaults.items():row(path/name,0o100200 if name=='cgroup.kill' else 0o100644,data=data)
            controls(base);state['rows'].pop(base/'cgroup.type');state['rows'].pop(base/'cgroup.events')
            state['rows'][base/'cgroup.subtree_control']['data']=b'cpu memory pids\n'
            def pathof(name,dir_fd=None):
                path=Path(name)
                return path if path.is_absolute() else (state['fds'][dir_fd]['path'] if dir_fd is not None else checkout)/path
            def fault(operation,path):
                error=state['faults'].get((operation,str(path)))
                if error:raise error
            def info(path):
                fault('stat',path)
                if path not in state['rows']:raise FileNotFoundError(str(path))
                return SimpleNamespace(**{key:value for key,value in state['rows'][path].items() if key!='data'})
            def opened(name,flags,dir_fd=None):
                path=pathof(name,dir_fd);fault('open',path);metadata=info(path)
                if flags&os.O_DIRECTORY:self.assertTrue(stat.S_ISDIR(metadata.st_mode))
                if path.name=='cgroup.kill':self.assertEqual(flags&os.O_ACCMODE,os.O_WRONLY)
                state['nextFd']+=1;fd=state['nextFd'];state['fds'][fd]={'path':path,'offset':0,'flags':flags}
                state['events'].append(('open',str(path)));return fd
            def read(fd,cap):
                entry=state['fds'][fd];path=entry['path'];fault('read',path)
                self.assertNotEqual(entry['flags']&os.O_ACCMODE,os.O_WRONLY)
                data=state['rows'][path]['data'];start=entry['offset'];entry['offset']+=cap
                state['events'].append(('read',str(path)));return data[start:start+cap]
            def write(fd,data):
                path=state['fds'][fd]['path'];fault('write',path)
                self.assertNotEqual(path.parent,base);self.assertNotIn(path.name,('cgroup.procs','cgroup.kill'))
                state['events'].append(('write',str(path),data))
                state['rows'][path]['data']=b'cpu memory pids\n' if path.name=='cgroup.subtree_control' else data+b'\n'
                return len(data)
            def mkdir(name,mode,dir_fd=None):
                path=pathof(name,dir_fd);fault('mkdir',path)
                if path in state['rows']:raise FileExistsError(str(path))
                self.assertIsNotNone(dir_fd);state['events'].append(('mkdir',str(path)));row(path,stat.S_IFDIR|mode)
                if path.is_relative_to(base):controls(path)
            def chown(fd,uid,gid):
                path=state['fds'][fd]['path'];fault('chown',path)
                state['rows'][path].update(st_uid=uid,st_gid=gid);state['events'].append(('chown',str(path),uid,gid))
            def chmod(fd,mode):
                path=state['fds'][fd]['path'];fault('chmod',path)
                state['rows'][path]['st_mode']=stat.S_IFMT(state['rows'][path]['st_mode'])|mode
                state['events'].append(('chmod',str(path),mode))
            def close(fd):
                self.assertIn(fd,state['fds']);path=state['fds'].pop(fd)['path'];state['events'].append(('close',str(path)));fault('close',path)
            def plan(environ,expected):
                self.assertEqual(state['uids'],(0,)*3);self.assertEqual(expected,sha(state['plan']))
                state['planReads']+=1;state['events'].append(('plan',));fault('plan',Path('/fixed-plan'));return state['plan']
            def proc(path):
                if path.endswith('cgroup'):return state['membership']
                return ''.join(key+':\t'+'0'*16+'\n' for key in ('CapInh','CapPrm','CapEff','CapAmb'))
            def resolve(path,**kwargs):return checkout/RUN_FILE if str(path)==__file__ else path
            with contextlib.ExitStack() as stack:
                for context in (
                    patch.object(Path,'cwd',return_value=checkout),patch.object(Path,'resolve',resolve),
                    patch.object(Path,'lstat',lambda path:info(path)),patch.object(Path,'stat',lambda path,**kwargs:info(path)),
                    patch.object(os,'stat',side_effect=lambda name,dir_fd=None,**kwargs:info(pathof(name,dir_fd))),
                    patch.object(os,'open',side_effect=opened),patch.object(os,'fstat',side_effect=lambda fd:info(state['fds'][fd]['path'])),
                    patch.object(os,'read',side_effect=read),patch.object(os,'write',side_effect=write),
                    patch.object(os,'mkdir',side_effect=mkdir),patch.object(os,'fchown',side_effect=chown),patch.object(os,'fchmod',side_effect=chmod),
                    patch.object(os,'close',side_effect=close),patch.object(os,'getresuid',side_effect=lambda:state['uids']),
                    patch.object(os,'getresgid',side_effect=lambda:state['gids']),patch.object(os,'getgroups',side_effect=lambda:state['groups']),
                    patch.object(os,'setgroups',side_effect=lambda groups:state.update(groups=list(groups))),
                    patch.object(os,'setresgid',side_effect=lambda *ids:state.update(gids=ids)),
                    patch.object(os,'setresuid',side_effect=lambda *ids:state.update(uids=ids)),
                    patch.object(platform,'system',return_value='Linux'),patch.object(platform,'machine',return_value='x86_64'),
                    patch.object(RuntimeFiles,'resolve',return_value=('/usr/bin/python3.12',{})),patch.object(RuntimeFiles,'read',return_value=b'python'),
                    patch.dict(globals(),entry_proc=proc,read_launch_plan=plan),
                    patch.object(subprocess,'Popen',side_effect=AssertionError('no process in hosted setup controls'))):stack.enter_context(context)
                yield env,state,manual

        def test_hosted_setup_fresh_anchored_resources_minimum_delegation_and_writeonly_kill(self):
            with self.hosted_kernel_edges() as (env,state,manual):
                setup=HostedSetupOps(sha(state['plan']),env);result,failure=setup.prepare()
                self.assertTrue(result['pass'],failure.first);self.assertIsNone(failure.first);self.assertEqual(state['fds'],{})
                self.assertNotIn(Path('/sys/fs/cgroup/cgroup.type'),state['rows'])
                self.assertEqual(set(setup.facts['snapshots']),{'enclosing','controller','js','qemu','preparation'})
                writes=[event for event in state['events'] if event[0]=='write']
                self.assertEqual(len(writes),21);self.assertTrue(all(not event[1].rsplit('/',1)[0]=='/sys/fs/cgroup' for event in writes))
                control_chowns={event[1] for event in state['events'] if event[0]=='chown' and stat.S_ISREG(state['rows'][Path(event[1])]['st_mode'])}
                expected={str(manual/'cgroup.procs'),*(str(manual/role/name) for role in ('js','qemu') for name in ('cgroup.procs','cgroup.kill'))}
                self.assertEqual(control_chowns,expected)
                for role in ('js','qemu'):
                    self.assertEqual(state['rows'][manual/role/'cgroup.kill']['st_mode'],0o100200)
                    self.assertNotIn(('read',str(manual/role/'cgroup.kill')),state['events'])
                self.assertEqual(state['rows'][manual/'controller/cgroup.procs']['st_uid'],0)
                self.assertLess(state['events'].index(('plan',)),next(index for index,event in enumerate(state['events']) if event[0]=='mkdir'))
                setup.verify();self.assertEqual(state['planReads'],1);self.assertEqual(state['fds'],{})

        def test_hosted_setup_refusals_are_one_shot_and_preserve_partial_creation(self):
            for fault in ('root','invoker','plan','parent-disabled','preexisting-stage','preexisting-manual','limit-write','directory-close'):
                with self.hosted_kernel_edges() as (env,state,manual):
                    if fault=='root':state['uids']=(1001,)*3
                    elif fault=='invoker':env['SUDO_UID']='0'
                    elif fault=='plan':state['faults']['plan','/fixed-plan']=OSError('ORIGINAL_PLAN')
                    elif fault=='parent-disabled':state['rows'][Path('/sys/fs/cgroup/cgroup.subtree_control')]['data']=b'cpu\n'
                    elif fault in ('preexisting-stage','preexisting-manual'):
                        path=Path('/checkout')/STAGED_INPUTS if fault=='preexisting-stage' else manual
                        state['rows'][path]={'st_dev':3,'st_ino':999,'st_mode':0o40755,'st_uid':0,'st_gid':0,'st_nlink':1,'st_size':0,'st_mtime_ns':1,'data':b''}
                    elif fault=='limit-write':state['faults']['write',str(manual/'memory.max')]=OSError('ORIGINAL_CAP_WRITE')
                    else:state['faults']['close','/checkout/build']=OSError('ORIGINAL_CLOSE')
                    setup=HostedSetupOps(sha(state['plan']),env);result,failure=setup.prepare()
                    self.assertFalse(result['pass'],fault);self.assertIsNotNone(failure.first);self.assertEqual(state['fds'],{})
                    if fault=='limit-write':self.assertEqual(failure.first['message'],'ORIGINAL_CAP_WRITE');self.assertTrue(setup.facts['created'])
                    if fault=='directory-close':self.assertEqual(failure.first['message'],'ORIGINAL_CLOSE')
                    count=len(state['events']);state['faults'].clear();state['uids']=(0,)*3
                    second,refused=setup.prepare();self.assertFalse(second['pass']);self.assertEqual(refused.first['message'],'hosted setup consumed; no retry')
                    self.assertEqual(len(state['events']),count)

        def test_hosted_setup_late_identity_limit_owner_and_population_readbacks_refuse(self):
            for fault in ('identity','limit','owner','populated','subtree','kill-owner'):
                with self.hosted_kernel_edges() as (env,state,manual):
                    setup=HostedSetupOps(sha(state['plan']),env);result,failure=setup.prepare();self.assertTrue(result['pass'])
                    if fault=='identity':state['rows'][manual/'js']['st_ino']+=1
                    elif fault=='limit':state['rows'][manual/'js/memory.max']['data']=b'max\n'
                    elif fault=='owner':state['rows'][manual/'controller/cpu.max']['st_uid']=1001
                    elif fault=='populated':state['rows'][manual/'qemu/cgroup.events']['data']=b'populated 1\n'
                    elif fault=='subtree':state['rows'][manual/'cgroup.subtree_control']['data']=b'cpu\n'
                    else:state['rows'][manual/'qemu/cgroup.kill']['st_uid']=0
                    with self.assertRaises(ObservedFailure):setup.verify()
                    self.assertEqual(state['fds'],{})
                    self.assertIs(setup.complete,False);before=len(state['events'])
                    with self.assertRaisesRegex(ObservedFailure,'complete pinned hosted setup required'):setup.verify()
                    self.assertEqual(len(state['events']),before)

        def test_hosted_setup_every_fresh_nonroot_group_requires_domain_type(self):
            for role in ('enclosing','controller','js','qemu','preparation'):
                with self.hosted_kernel_edges() as (env,state,manual):
                    setup=HostedSetupOps(sha(state['plan']),env);result,failure=setup.prepare();self.assertTrue(result['pass'])
                    path=manual if role=='enclosing' else setup.preparation if role=='preparation' else manual/role
                    state['rows'][path/'cgroup.type']['data']=b'threaded\n'
                    with self.assertRaisesRegex(ObservedFailure,'domain cgroup'):setup.verify()
                    self.assertEqual(state['fds'],{});self.assertIs(setup.complete,False)

        def test_hosted_entry_partial_setup_failure_retains_memory_facts_after_verified_drop(self):
            with self.hosted_kernel_edges() as (env,state,manual):
                state['faults']['write',str(manual/'memory.max')]=OSError('ORIGINAL_PARTIAL_LIMIT_WRITE')
                output=io.BytesIO();compose=Mock(side_effect=AssertionError('no composition after partial setup'))
                with patch.dict(globals(),compose_entry=compose),patch.object(sys,'stdout',SimpleNamespace(buffer=output)):
                    result,failure=hosted_entry(sha(state['plan']),env)
                self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'ORIGINAL_PARTIAL_LIMIT_WRITE')
                self.assertFalse(result['setup']['pass']);self.assertIn(str(manual),result['setup']['facts']['created'])
                self.assertIn(str(manual/'cgroup.subtree_control'),result['setup']['facts']['controls'])
                self.assertEqual(state['uids'],(1001,)*3);self.assertEqual(state['fds'],{});compose.assert_not_called()
                self.assertIn(b'launch-plan.original.json',output.getvalue())

        def test_cli_static_disable_precedes_all_identity_reads_and_factories(self):
            self.assertIs(ACTUAL_ENTRY_ENABLED,False)
            handlers={name:Mock(side_effect=AssertionError('static gate before '+name)) for name in
                ('admitted_generated_preparation_child','controller_bootstrap','controller_execute','hosted_entry')}
            for mode in ('prepare-admitted-generated','bootstrap','controller','hosted-actual'):
                stderr=io.BytesIO()
                with patch.dict(globals(),**handlers),patch.object(os,'getresuid',side_effect=AssertionError('no identity read')),\
                     patch.object(sys,'stderr',SimpleNamespace(buffer=stderr)):
                    status=dispatch_cli(['--'+mode],{'ACTUAL_ENTRY_ENABLED':'true','BW_ACTUAL_ENABLED':'1'})
                self.assertEqual(status,1);self.assertIn(b'actual entry disabled',stderr.getvalue())
            for handler in handlers.values():handler.assert_not_called()
            with patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                self.assertEqual(dispatch_cli(['--controller'],object()),1)  # The disabled endpoint does not read caller environment.
            invalid=[[],['--controller','--bootstrap'],['--prepare'],['--controller','arbitrary'],['--actual-enabled'],
                     ['--controls','--help'],['--help','--controls']]
            invalid.extend([['--'+mode,'--'+mode] for mode in ('controls','prepare-admitted-generated','bootstrap','controller','hosted-actual')])
            with patch.dict(globals(),controls=Mock(side_effect=AssertionError('no duplicate controls invocation'))):
                for argv in invalid:
                    with contextlib.redirect_stderr(io.StringIO()),self.assertRaises(SystemExit) as caught:dispatch_cli(argv,{})
                    self.assertEqual(caught.exception.code,2)
            with contextlib.redirect_stdout(io.StringIO()),self.assertRaises(SystemExit) as caught:dispatch_cli(['--help'],{})
            self.assertEqual(caught.exception.code,0)
            with patch.dict(globals(),controls=Mock()) as patched:self.assertEqual(dispatch_cli(['--controls'],{}),0);patched['controls'].assert_called_once()

        def test_cli_prep_exact_frame_only_and_strict_failure_status(self):
            for fault in ('none','pass-alias','primary','secondary','invalid-failure'):
                output=io.BytesIO();stderr=io.BytesIO();failure=FirstFailure()
                if fault=='primary':failure.add(ValueError('ORIGINAL_PREP'),'preparation')
                elif fault=='secondary':failure.secondary.append(row(ValueError('ORIGINAL_SECONDARY'),'preparation'))
                def prep(environ):
                    output.write(b'EXACT_ORIGINAL_FRAME');return {'pass':1 if fault=='pass-alias' else True},None if fault=='invalid-failure' else failure
                with patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True,admitted_generated_preparation_child=prep),\
                     patch.object(sys,'stdout',SimpleNamespace(buffer=output)),patch.object(sys,'stderr',SimpleNamespace(buffer=stderr)):
                    status=dispatch_cli(['--prepare-admitted-generated'],{})
                self.assertEqual(status,0 if fault=='none' else 1);self.assertEqual(output.getvalue(),b'EXACT_ORIGINAL_FRAME')
                if fault=='none':self.assertEqual(stderr.getvalue(),b'')
                else:self.assertTrue(stderr.getvalue())

        def test_cli_bootstrap_return_is_failure_and_controller_requires_complete_authoritative_result(self):
            for returned in (FirstFailure(),None,True):
                with patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True,controller_bootstrap=Mock(return_value=returned)),\
                     patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                    self.assertEqual(dispatch_cli(['--bootstrap'],{}),1)
            for fault in ('none','secondary','missing-role','not-dropped','missing-after','invalid-failure'):
                failure=FirstFailure();ops=SimpleNamespace(unprivileged=True,paths_admitted=True,
                    processes={'js':{},'qemu':{}},source_after={},runtime_after={})
                if fault=='secondary':failure.secondary.append(row(ValueError('ORIGINAL_SECONDARY'),'controller'))
                elif fault=='missing-role':ops.processes.pop('qemu')
                elif fault=='not-dropped':ops.unprivileged=False
                elif fault=='missing-after':ops.runtime_after=None
                with patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True,controller_execute=Mock(return_value=(ops,None if fault=='invalid-failure' else failure))),\
                     patch.object(sys,'stderr',SimpleNamespace(buffer=io.BytesIO())):
                    self.assertEqual(dispatch_cli(['--controller'],{}),0 if fault=='none' else 1)

        def test_cli_actual_bootstrap_exec_boundary_and_dropped_controller_glue(self):
            with self.entry_edges() as (ops,state),patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True):
                self.assertEqual(dispatch_cli(['--bootstrap'],state['env']),1)  # Fake exec returns: production correctly refuses.
                self.assertEqual([event[0] for event in state['events']],['move','groups','gids','uids','exec'])
                executable,argv,environment=state['events'][-1][1]
                self.assertEqual(argv,[executable,'-I','-B',RUN_FILE,'--controller'])
                self.assertNotIn('SUDO_UID',environment);self.assertNotIn('BW_LAUNCH_PLAN_SHA256',environment)
                self.assertEqual(state['uids'],(1001,)*3);self.assertEqual(state['gids'],(1002,)*3)
            with self.controller_edges() as (ops,state,plan,files,calls):
                with patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True,ControllerOps=Mock(return_value=ops)):
                    self.assertEqual(dispatch_cli(['--controller'],state['env']),0)
                self.assertEqual(state['factories'],['js','qemu']);self.assertEqual(len(calls),11)

        def test_cli_hosted_setup_composition_drop_and_finalizer_coherent_mock_chain(self):
            with self.hosted_kernel_edges() as (env,state,manual):
                env['BW_LAUNCH_PLAN_SHA256']=sha(state['plan']);events=[];expected=state['plan']
                def child(parent):
                    self.assertEqual(parent._launch_plan_original,expected);events.append('preparation-factory')
                    value=Fake([[('stdout',generation_frame(b'opaque GEN',b'opaque PRE'))]],status())
                    descriptor=LinuxPreparation(parent);value.argv=[parent.python['path'],'-I','-B',RUN_FILE,'--prepare-admitted-generated']
                    value.environment=dict(descriptor.environment,BW_LAUNCH_PLAN_SHA256=sha(expected))
                    def spawn():
                        parent.require_preparation_ownership();parent.preparation_ownership.begin_spawn();events.append('preparation-spawn')
                        return {'pid':201,'pgid':201,'parentPid':101,'startTicks':901}
                    value.spawn=spawn;return value
                def outside(owner):
                    self.assertEqual(state['uids'],(0,)*3);events.append('outside-root')
                    owner.bootstrap.invoker={'uid':1001,'gid':1002};owner.bootstrap.drop();entry_ids(1001,1002)
                    return {'process':{'waitStatus':0},'cleanup':{}},FirstFailure()
                def final(facts,failure,pre,environ,**kwargs):
                    entry_ids(1001,1002);events.append('finalizer-dropped');self.assertEqual(pre,b'opaque PRE')
                    self.assertEqual(kwargs['launch_plan_original'],expected);self.assertEqual(kwargs['launch_plan_sha256'],sha(expected))
                    self.assertEqual(final_json(kwargs['preparation_original'])['schema'],'bw.ring3.preparation-original.v3')
                    return {'pass':True},failure
                diagnostic=io.BytesIO()
                with patch.dict(globals(),ACTUAL_ENTRY_ENABLED=True,LinuxAdmittedGeneratedPreparation=child,
                                outside_controller=outside,finalize_packet=final),\
                     patch.object(sys,'stderr',SimpleNamespace(buffer=diagnostic)):
                    cli_status=dispatch_cli(['--hosted-actual'],env)
                self.assertEqual(cli_status,0,diagnostic.getvalue());self.assertEqual(state['planReads'],1);self.assertEqual(state['fds'],{})
                self.assertEqual(events,['preparation-factory','preparation-spawn','outside-root','finalizer-dropped'])
                self.assertEqual(state['uids'],(1001,)*3)

        def launch_plan_original(self,source,environ):
            return encode({'schema':'bw.ring3.launch-plan.v1','runId':environ['GITHUB_RUN_ID'],'attempt':1,
                'head':environ['BW_EXPECTED_HEAD'],'tree':environ['BW_EXPECTED_TREE'],
                'source':{'bytes':len(source),'sha256':sha(source),'base64':base64.b64encode(source).decode('ascii')}})

        @contextlib.contextmanager
        def launch_plan_file_edges(self,raw=b'opaque externally admitted plan'):
            env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40}
            path=launch_plan_path(env);parents={Path('/'),Path('/run'),path.parent}
            state={'raw':raw,'position':0,'events':[],'owner':(0,0),'mode':0o100444,'links':1,
                'extent':len(raw),'directoryOwner':(0,0),'directoryMode':0o40755,'redirect':None,
                'fstatCalls':0,'lateInode':False,'readError':None,'closeError':None}
            def info(name,held=False):
                directory=name in parents
                uid,gid=state['directoryOwner'] if directory else state['owner']
                inode=1 if directory else 7
                if held and state['lateInode'] and state['fstatCalls']>1:inode+=1
                return SimpleNamespace(st_dev=3,st_ino=inode,st_mode=state['directoryMode'] if directory else state['mode'],
                    st_uid=uid,st_gid=gid,st_nlink=2 if directory else state['links'],
                    st_size=0 if directory else state['extent'],st_mtime_ns=99)
            def opened(name,flags):
                self.assertEqual(Path(name),path)
                self.assertEqual(flags,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
                state['events'].append('open');return 41
            def fstat(fd):
                self.assertEqual(fd,41);state['fstatCalls']+=1;return info(path,True)
            def read(fd,cap):
                self.assertEqual(fd,41);state['events'].append('read')
                if state['readError']:raise state['readError']
                result=state['raw'][state['position']:state['position']+cap];state['position']+=len(result);return result
            def closed(fd):
                self.assertEqual(fd,41);state['events'].append('close')
                if state['closeError']:raise state['closeError']
            with patch.object(Path,'lstat',lambda name:info(name)),\
                 patch.object(Path,'resolve',lambda name,**kwargs:Path('/redirected') if name==state['redirect'] else name),\
                 patch.object(os,'open',side_effect=opened),patch.object(os,'fstat',side_effect=fstat),\
                 patch.object(os,'read',side_effect=read),patch.object(os,'close',side_effect=closed):
                yield env,state,path

        def test_launch_plan_fixed_readonly_held_file_and_primary_close_failure(self):
            with self.launch_plan_file_edges() as (env,state,path):
                self.assertEqual(str(path),'/run/bw-ring3-123-1-admission/launch-plan.json')
                self.assertEqual(read_launch_plan(env,sha(state['raw'])),state['raw'])
                self.assertEqual(state['events'],['open','read','read','close']);self.assertEqual(state['fstatCalls'],2)
            for fault in ('owner','mode','links','extent','directoryOwner','directoryMode','redirect','lateInode','digest'):
                with self.launch_plan_file_edges() as (env,state,path):
                    if fault in ('owner','directoryOwner'):state[fault]=(1001,1002)
                    elif fault=='mode':state['mode']=0o100644
                    elif fault=='links':state['links']=2
                    elif fault=='extent':state['extent']=JSON_CAP+1
                    elif fault=='directoryMode':state['directoryMode']=0o40777
                    elif fault=='redirect':state['redirect']=path.parent
                    elif fault=='lateInode':state['lateInode']=True
                    with self.assertRaises(ValueError):read_launch_plan(env,'0'*64 if fault=='digest' else sha(state['raw']))
                    self.assertEqual(state['events'].count('close'),state['events'].count('open'))
            with self.launch_plan_file_edges() as (env,state,path):
                state['readError']=OSError('ORIGINAL_PLAN_READ');state['closeError']=OSError('PLAN_CLOSE')
                with self.assertRaisesRegex(OSError,'ORIGINAL_PLAN_READ') as caught:read_launch_plan(env,sha(state['raw']))
                self.assertEqual(caught.exception.ring3_secondary[0]['message'],'PLAN_CLOSE')
                self.assertEqual(state['events'].count('close'),1)

        def test_launch_plan_closed_canonical_event_and_source_original_joins(self):
            with self.pinned_staging_edges() as (ops,state,source):
                raw=self.launch_plan_original(source,ops.environ)
                self.assertEqual(admit_launch_plan(raw,sha(raw),ops.environ)[1],source)
                for fault in ('schema','runId','attempt','head','tree','extra','source-extra','source-bytes','source-hash','source-base64','canonical','expected-digest'):
                    value=final_json(raw)
                    if fault=='schema':value['schema']='other'
                    elif fault=='runId':value['runId']='456'
                    elif fault=='attempt':value['attempt']=True
                    elif fault in ('head','tree'):value[fault]='c'*40
                    elif fault=='extra':value['extra']=0
                    elif fault=='source-extra':value['source']['extra']=0
                    elif fault=='source-bytes':value['source']['bytes']=float(value['source']['bytes'])
                    elif fault=='source-hash':value['source']['sha256']='0'*64
                    elif fault=='source-base64':value['source']['base64']+='!'
                    data=encode(value)+(b' ' if fault=='canonical' else b'')
                    with self.assertRaises(ValueError):admit_launch_plan(data,'0'*64 if fault=='expected-digest' else sha(data),ops.environ)

        def test_admitted_child_loads_plan_after_drop_and_runs_pinned_generator_before_pre(self):
            with self.pinned_staging_edges() as (old,state,source):
                raw=self.launch_plan_original(source,old.environ);env=dict(old.environ,BW_LAUNCH_PLAN_SHA256=sha(raw),SUDO_UID='1001',SUDO_GID='1002')
                frames=[];pre=[];clock=iter((10,40,50));factory=globals()['PinnedRecordingStagingOps']
                def pinned(*args):
                    ops=factory(*args);create=ops.create
                    def child():
                        value=create();value.t=20;return value
                    ops.create=child;return ops
                def load(environ,expected):
                    entry_ids(1001,1002);self.assertEqual(expected,sha(raw));state['events'].append('plan-load');return raw
                def preparation(environ,**kwargs):
                    pre.append(True);state['events'].append('PRE-GIT')
                    kwargs['emit'](preparation_frame(b'original PRE bytes'));kwargs['flush']();return {'pass':True},FirstFailure()
                with patch.dict(globals(),read_launch_plan=load,PinnedRecordingStagingOps=pinned,preparation_child=preparation),\
                     patch.object(time,'monotonic_ns',side_effect=lambda:next(clock)):
                    result,failure=admitted_generated_preparation_child(env,emit=lambda frame:frames.append(frame) or len(frame),flush=lambda:None)
                self.assertTrue(result['pass'],(failure.first,failure.secondary));self.assertIsNone(failure.first);self.assertEqual(pre,[True])
                self.assertEqual(result['launchPlanOriginal'],raw)
                generation,pre_raw=generation_parts(frames[0]);value=final_json(generation)
                self.assertEqual(pre_raw,b'original PRE bytes');self.assertEqual(value['before']['monoNs'],10)
                self.assertLess(state['events'].index('plan-load'),state['events'].index('factory'))
                self.assertLess(state['events'].index('spawn'),state['events'].index('PRE-GIT'))
                self.assertEqual(state['sourceReads'],sorted(SOURCE_PATHS)*2)

        def test_admitted_child_refuses_root_ids_bad_plan_and_source_before_factory(self):
            for fault in ('root','groups','capability','membership','invoker','missing-pin','bad-plan','wrong-plan-digest','source-drift'):
                with self.pinned_staging_edges() as (ops,state,source):
                    raw=self.launch_plan_original(source,ops.environ);env=dict(ops.environ,BW_LAUNCH_PLAN_SHA256=sha(raw),SUDO_UID='1001',SUDO_GID='1002');loads=[]
                    if fault=='root':state['uids']=state['gids']=(0,)*3
                    elif fault=='groups':state['groups']=[1002]
                    elif fault=='membership':state['member']='0::/wrong-preparation\n'
                    elif fault=='invoker':env['SUDO_UID']='1003'
                    elif fault=='missing-pin':env.pop('BW_LAUNCH_PLAN_SHA256')
                    elif fault=='source-drift':state['sourceData']['LICENSE']+=b'changed'
                    def load(environ,expected):loads.append(True);return b'bad' if fault=='bad-plan' else raw
                    if fault=='wrong-plan-digest':env['BW_LAUNCH_PLAN_SHA256']='0'*64
                    previous=globals()['entry_proc']
                    def proc(path):return previous(path).replace('CapEff:\t0000000000000000','CapEff:\t0000000000000001') if fault=='capability' else previous(path)
                    with patch.dict(globals(),read_launch_plan=load,entry_proc=proc),patch.object(time,'monotonic_ns',return_value=1):
                        result,failure=admitted_generated_preparation_child(env,emit=lambda frame:len(frame),flush=lambda:None)
                    self.assertFalse(result['pass'],fault);self.assertIsNotNone(failure.first)
                    self.assertNotIn('factory',state['events'])
                    if fault in ('root','groups','capability','membership','invoker'):self.assertEqual(loads,[])

        def test_admitted_parent_captures_opaque_plan_before_factory_with_closed_v3_descriptor(self):
            with self.composition_edges() as (old,state):
                raw=b'opaque external original; root must not parse';expected=sha(raw)
                refused=AdmittedGeneratedEntryComposition(expected,state['env']);state['uids']=(1001,)*3
                with patch.dict(globals(),read_launch_plan=Mock(side_effect=AssertionError('no plan open before root validation'))) as patches:
                    failed=FirstFailure();refused.prepare(failed);patches['read_launch_plan'].assert_not_called()
                self.assertEqual(failed.first['message'],'root opaque launch-plan capture required');state['uids']=(0,)*3
                ops=AdmittedGeneratedEntryComposition(expected,state['env']);ops.validate()
                ops.require_preparation_ownership=old.require_preparation_ownership;ops.finish_preparation_ownership=old.finish_preparation_ownership
                with self.assertRaisesRegex(ValueError,'before child factory'):ops.create_preparation()
                with patch.object(os,'getpid',return_value=101):descriptor=LinuxAdmittedGeneratedPreparation(ops)
                self.assertEqual(descriptor.argv,[ops.python['path'],'-I','-B',RUN_FILE,'--prepare-admitted-generated'])
                self.assertEqual(descriptor.environment['BW_LAUNCH_PLAN_SHA256'],expected)
                self.assertEqual(set(descriptor.environment),set(ENV)|{'GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE','SUDO_UID','SUDO_GID','BW_LAUNCH_PLAN_SHA256'})
                def load(environ,pin):
                    self.assertEqual(state['uids'],(0,)*3);self.assertEqual(pin,expected);state['phaseEvents'].append('opaque-plan');return raw
                def create():
                    self.assertEqual(ops._launch_plan_original,raw);state['phaseEvents'].append('admitted-factory')
                    child=Fake([[('stdout',generation_frame(b'opaque GEN\xff',b'opaque PRE\xff'))]],status())
                    child.argv=descriptor.argv;child.environment=descriptor.environment;return child
                ops.create_preparation=create;failure=FirstFailure()
                with patch.dict(globals(),read_launch_plan=load,final_json=Mock(side_effect=AssertionError('no root plan/GEN/PRE parsing'))):ops.prepare(failure)
                self.assertIsNone(failure.first);self.assertEqual(ops._launch_plan_original,raw)
                self.assertLess(state['phaseEvents'].index('opaque-plan'),state['phaseEvents'].index('admitted-factory'))
                phase=final_json(ops._preparation_original);self.assertEqual(phase['schema'],'bw.ring3.preparation-original.v3')
                self.assertEqual(phase['process']['environment']['BW_LAUNCH_PLAN_SHA256'],expected)
                with patch.dict(globals(),read_launch_plan=Mock(side_effect=AssertionError('no recapture'))):ops.prepare(failure)
                self.assertIsNotNone(failure.first);self.assertEqual(state['phaseEvents'].count('admitted-factory'),1)
                self.assertEqual(ops._launch_plan_original,raw)

        def test_admitted_parent_drop_only_failure_log_keeps_plan_and_primary_error(self):
            for fault in ('none','drop','flush'):
                with self.composition_edges() as (old,state):
                    raw=b'opaque retained plan';ops=AdmittedGeneratedEntryComposition(sha(raw),state['env']);ops.validate()
                    ops._launch_plan_original=raw;ops._preparation_original=b'original phase';ops._generation_original=b'original GEN'
                    failure=FirstFailure();failure.add(ValueError('ORIGINAL_PLAN_FAILURE'),'admission');lines=[];attempted=[]
                    if fault=='drop':ops.bootstrap.drop=Mock()
                    def emit(line):attempted.append(True);entry_ids(1001,1002);lines.append(line);return len(line)
                    def flush():
                        if fault=='flush':raise OSError('ADMISSION_FLUSH')
                    with patch.object(sys,'stdout',SimpleNamespace(buffer=SimpleNamespace(write=emit,flush=flush))):result=ops.failure_only(failure)
                    self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'ORIGINAL_PLAN_FAILURE')
                    if fault=='drop':self.assertEqual(lines,[]);self.assertEqual(attempted,[])
                    else:
                        rows=[final_json(line[len(b'RING3_ORIGINAL '):]) for line in lines]
                        self.assertEqual({row['name'] for row in rows},{'launch-plan.original.json','preparation.phase.json','generation.phase.json'})
                        self.assertEqual(ops._preparation_log['complete'],fault=='none')

        def test_admitted_parent_failed_capture_or_root_check_cannot_retry_with_repaired_plan(self):
            for fault in ('read','root'):
                with self.composition_edges() as (old,state):
                    raw=b'valid bytes only after refused attempt';ops=AdmittedGeneratedEntryComposition(sha(raw),state['env']);ops.validate()
                    reads=Mock(side_effect=[OSError('ORIGINAL_PLAN_READ'),raw] if fault=='read' else [raw])
                    delegated=Mock(return_value=FirstFailure())
                    if fault=='root':state['uids']=(1001,)*3
                    with patch.dict(globals(),read_launch_plan=reads),patch.object(GeneratedEntryComposition,'prepare',delegated):
                        first=FirstFailure();ops.prepare(first);original=ops._preparation_original
                        state['uids']=(0,)*3;second=FirstFailure();ops.prepare(second)
                    self.assertEqual(first.first['message'],'ORIGINAL_PLAN_READ' if fault=='read' else 'root opaque launch-plan capture required')
                    self.assertEqual(second.first['message'],'launch-plan capture consumed; no retry')
                    self.assertEqual(reads.call_count,1 if fault=='read' else 0);delegated.assert_not_called()
                    self.assertIsNone(ops._launch_plan_original);self.assertEqual(ops._preparation_original,original)

        @contextlib.contextmanager
        def admitted_original_edges(self):
            with self.generated_original_edges() as (old,outside,env,pre,post,state):
                raw=self.launch_plan_original(state['data']['source.before.json'],env);expected=sha(raw)
                ops=AdmittedGeneratedEntryComposition(expected,env);ops.python=old.python;ops.bootstrap.invoker=old.bootstrap.invoker
                ops._launch_plan_original=raw;ops._generation_original=old._generation_original;ops.pre_git=pre
                ops.preparation=json.loads(json.dumps(old.preparation,default=lambda data:None))
                ops.preparation['streams']=old.preparation['streams'];ops.preparation['process']['argv'][-1]='--prepare-admitted-generated'
                ops.preparation['process']['environment']['BW_LAUNCH_PLAN_SHA256']=expected
                with patch.object(time,'monotonic_ns',return_value=600):ops.freeze_preparation_original(FirstFailure())
                node=final_json(old._generation_original)['before']['files']['node']
                with patch.dict(globals(),GENERATION_NODE_PIN=(node['bytes'],node['sha256'])):
                    yield ops,outside,env,pre,post,state

        def test_admitted_v3_actual_finalizer_exports_twenty_roles_and_exact_plan_original(self):
            with self.admitted_original_edges() as (ops,outside,env,pre,post,state):
                self.assertEqual(final_json(ops._preparation_original)['schema'],'bw.ring3.preparation-original.v3')
                result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,
                    preparation_original=ops._preparation_original,generation_original=ops._generation_original,
                    launch_plan_original=ops._launch_plan_original,launch_plan_sha256=ops._expected_launch_plan_sha256,
                    emit=lambda line:state['log'].append(line) or len(line),flush=lambda:None)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first);self.assertEqual(set(state['export']),PACKET_ROLES)
                rows=[final_json(line[len(b'RING3_ORIGINAL '):]) for line in state['log']]
                self.assertEqual(len({row['name'] for row in rows}),9)
                self.assertEqual(base64.b64decode(''.join(row['data'] for row in rows if row['name']=='launch-plan.original.json')),ops._launch_plan_original)
                self.assertNotIn('launch-plan.original.json',state['export'])
                with self.assertRaises(ValueError):check_generated_phase(ops._preparation_original,ops._generation_original,pre,outside,
                    final_json(state['data']['.entry.json']),env)  # No silent v2 acceptance.

        def test_admitted_v3_plan_digest_descriptor_source_and_missing_pair_refuse(self):
            for fault in ('plan-digest','phase-digest','phase-mode','phase-v2','plan-source','missing-plan','missing-pin'):
                with self.admitted_original_edges() as (ops,outside,env,pre,post,state):
                    plan=ops._launch_plan_original;expected=ops._expected_launch_plan_sha256;phase=final_json(ops._preparation_original)
                    if fault=='plan-digest':expected='0'*64
                    elif fault=='phase-digest':phase['process']['environment']['BW_LAUNCH_PLAN_SHA256']='0'*64
                    elif fault=='phase-mode':phase['process']['argv'][-1]='--prepare-generated'
                    elif fault=='phase-v2':phase['schema']='bw.ring3.preparation-original.v2'
                    elif fault=='plan-source':
                        value=final_json(plan);source=final_json(state['data']['source.before.json']);source['files']['LICENSE']['sha256']='0'*64
                        data=encode(source);value['source']={'bytes':len(data),'sha256':sha(data),'base64':base64.b64encode(data).decode('ascii')}
                        plan=encode(value);expected=sha(plan);phase['process']['environment']['BW_LAUNCH_PLAN_SHA256']=expected
                    elif fault=='missing-plan':plan=None
                    else:expected=None
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,
                        preparation_original=encode(phase),generation_original=ops._generation_original,
                        launch_plan_original=plan,launch_plan_sha256=expected,emit=lambda line:len(line),flush=lambda:None)
                    self.assertFalse(result['pass'],fault);self.assertNotIn('resources.json',state['export']);self.assertIsNotNone(failure.first)

        def test_admitted_v3_finalizer_node_pin_is_independent_of_coherent_runtime_and_gen(self):
            with self.admitted_original_edges() as (ops,outside,env,pre,post,state):
                generation=final_json(ops._generation_original);node=generation['before']['files']['node']
                for name in ('before','after'):generation[name]['files']['node']=dict(node,sha256='0'*64)
                runtime=final_json(state['data']['runtime.before.json']);runtime['qemuPackage']['files'][node['path']]['sha256']='0'*64
                originals=dict(state['data']);originals['runtime.before.json']=encode(runtime)
                wire=generation_frame(encode(generation),pre);phase=final_json(ops._preparation_original)
                phase['stdout']={'bytes':len(wire),'sha256':sha(wire),'base64':base64.b64encode(wire).decode('ascii')}
                with self.assertRaisesRegex(ValueError,'independent selected Node pin'):
                    check_admitted_generated_originals(ops._launch_plan_original,ops._expected_launch_plan_sha256,
                        encode(phase),encode(generation),pre,outside,final_json(state['data']['.entry.json']),originals,env)

        @contextlib.contextmanager
        def pinned_staging_edges(self):
            with self.staging_edges() as (old,state):
                source_data={name:('held '+name).encode() for name in SOURCE_PATHS}
                source_data[RUN_FILE]=state['runner']
                source_data['scripts/i80386-ring3-int-iret/fixture.mjs']=state['fixture']
                source={'schema':'bw.ring3.source.v1','head':'a'*40,'tree':'b'*40,'files':{
                    name:{'bytes':len(data),'sha256':sha(data),'mode':'100644',
                        'blob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}
                    for name,data in source_data.items()}}
                raw=encode(source);state.update(sourceData=source_data,sourceReads=[],sourceFaults={},sourceModes={})
                previous=globals()['bounded_read']
                def read(path,cap,**kwargs):
                    name=str(path).removeprefix('/checkout/')
                    if kwargs.get('with_mode') and name in SOURCE_PATHS:
                        state['events'].append('pin-source-'+name);state['sourceReads'].append(name)
                        if name in state['sourceFaults']:raise state['sourceFaults'][name]
                        return state['sourceData'][name],state['sourceModes'].get(name,'100644')
                    return previous(path,cap,**kwargs)
                ops=PinnedRecordingStagingOps(raw,sha(raw),'a'*40,'b'*40,old.environ)
                with patch.dict(globals(),bounded_read=read,GENERATION_NODE_PIN=(len(state['node']),sha(state['node']))):
                    yield ops,state,raw

        def test_pinned_generation_source_requires_canonical_closed_external_admission(self):
            with self.pinned_staging_edges() as (ops,state,raw):
                self.assertEqual(admit_generation_source(raw,sha(raw),'a'*40,'b'*40),raw)
                invalid=[]
                for fault in ('schema','head','tree','roster','fields','bytes-bool','bytes-float','bytes-cap','mode','blob','hash'):
                    value=final_json(raw);item=value['files'][RUN_FILE]
                    if fault=='schema':value['schema']='other'
                    elif fault in ('head','tree'):value[fault]='c'*40
                    elif fault=='roster':value['files'].pop('LICENSE')
                    elif fault=='fields':item['extra']=0
                    elif fault=='bytes-bool':item['bytes']=True
                    elif fault=='bytes-float':item['bytes']=float(item['bytes'])
                    elif fault=='bytes-cap':item['bytes']=(4<<20)+1
                    elif fault=='mode':item['mode']='100755'
                    elif fault=='blob':item['blob']='G'*40
                    else:item['sha256']='G'*64
                    invalid.append(encode(value))
                invalid.extend((raw+b' ',raw.replace(b'"schema":',b'"schema":"duplicate","schema":'),b'X'*(JSON_CAP+1)))
                for data in invalid:
                    with self.assertRaises(ValueError):PinnedRecordingStagingOps(data,sha(data),'a'*40,'b'*40,ops.environ)
                for arguments in ((raw,'0'*64,'a'*40,'b'*40),(raw,sha(raw),'c'*40,'b'*40),
                                  (raw,sha(raw),'a'*40,'c'*40),(None,sha(raw),'a'*40,'b'*40),
                                  (raw,None,'a'*40,'b'*40),(raw,sha(raw),None,'b'*40)):
                    with self.assertRaises(ValueError):PinnedRecordingStagingOps(*arguments,environ=ops.environ)
                with self.assertRaises(TypeError):PinnedRecordingStagingOps()
                self.assertNotIn('factory',state['events'])

        def test_pinned_generation_selected_node_policy_is_fixed(self):
            self.assertEqual(GENERATION_NODE_PIN,(124827920,'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'))

        def test_pinned_generation_twelve_live_sources_and_node_precede_factory_and_clock(self):
            with self.pinned_staging_edges() as (ops,state,raw):
                ticks=[]
                def clock():ticks.append(tuple(state['events']));return len(ticks)
                with patch.object(time,'monotonic_ns',side_effect=clock):result,failure=stage_preparation_inputs(ops)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first)
                self.assertEqual(state['sourceReads'],sorted(SOURCE_PATHS)*2)
                factory=state['events'].index('factory')
                for name in SOURCE_PATHS:self.assertLess(state['events'].index('pin-source-'+name),factory)
                self.assertIn('read-node',ticks[0]);self.assertNotIn('factory',ticks[0])
                self.assertEqual(ops.observation_times,{'before':1,'after':2})
                self.assertEqual(ops.source_observations['before'],final_json(raw))
                self.assertEqual(ops.source_observations['after'],final_json(raw))
                self.assertEqual(set(result['facts']['before']),{'node','fixture','runner'})

        def test_pinned_generation_every_held_source_mode_and_read_fault_refuses_before_factory(self):
            for name in sorted(SOURCE_PATHS):
                for fault in ('bytes','mode','read'):
                    with self.pinned_staging_edges() as (ops,state,raw):
                        if fault=='bytes':state['sourceData'][name]+=b'changed'
                        elif fault=='mode':state['sourceModes'][name]='100755'
                        else:state['sourceFaults'][name]=OSError('ORIGINAL_SOURCE_READ')
                        result,failure=stage_preparation_inputs(ops)
                        self.assertFalse(result['pass'],(name,fault));self.assertIsNotNone(failure.first)
                        self.assertNotIn('factory',state['events']);self.assertEqual(set(state['sourceReads']),SOURCE_PATHS)
                        self.assertIn('after',ops.source_observations);self.assertIsNone(result['process'])
                        if fault=='read':
                            self.assertEqual(failure.first['message'],'ORIGINAL_SOURCE_READ')
                            self.assertEqual(ops.source_observations['before']['files'][name]['firstFailure']['message'],'ORIGINAL_SOURCE_READ')

        def test_pinned_generation_late_gen_identity_joins_and_environment_refuse_before_factory(self):
            for fault in ('fixture','runner','node','head','tree'):
                with self.pinned_staging_edges() as (ops,state,raw):
                    if fault in ('head','tree'):ops.environ['BW_EXPECTED_'+fault.upper()]='c'*40
                    else:state[fault]+=b'changed after twelve-file observation'
                    result,failure=stage_preparation_inputs(ops)
                    self.assertFalse(result['pass'],fault);self.assertIsNotNone(failure.first)
                    self.assertNotIn('factory',state['events']);self.assertIsNone(result['process'])
                    if fault in ('fixture','runner'):
                        self.assertEqual(ops.source_observations['before'],final_json(raw))
                        self.assertIn('joins admitted source',failure.first['message'])
                    elif fault=='node':self.assertIn('independent selected-file pin',failure.first['message'])

        def test_pinned_generation_after_drift_retains_original_generator_failure_and_all_reads(self):
            for fault in ('source','node','fixture','runner'):
                with self.pinned_staging_edges() as (ops,state,raw):
                    state['code']=7
                    def changed():
                        if fault=='source':state['sourceData']['LICENSE']+=b'changed'
                        else:state['drift'][fault]=b'changed after generation'
                    state['onSpawn']=changed
                    result,failure=stage_preparation_inputs(ops)
                    self.assertFalse(result['pass']);self.assertEqual(result['process']['exitCode'],7)
                    self.assertEqual(failure.first,result['process']['firstFailure'])
                    self.assertEqual(failure.first['message'],'unexpected engine terminal status')
                    self.assertTrue(failure.secondary);self.assertEqual(state['sourceReads'],sorted(SOURCE_PATHS)*2)
                    self.assertEqual(set(ops.facts['outputFacts']),{'fixture.rom','fixture.json'})

        def test_pinned_generation_public_source_observations_cannot_replace_frozen_admission(self):
            with self.pinned_staging_edges() as (ops,state,raw):
                source=final_json(raw);source['files']['LICENSE']['sha256']='0'*64
                ops.source_observations={'before':source,'after':source}
                state['sourceData']['LICENSE']+=b'changed'
                result,failure=stage_preparation_inputs(ops)
                self.assertFalse(result['pass']);self.assertNotIn('factory',state['events'])
                self.assertNotEqual(ops.source_observations['before']['files']['LICENSE'],source['files']['LICENSE'])
                self.assertEqual(ops._source_original,raw)

        def test_pinned_generation_coherent_public_before_and_after_drift_cannot_replace_pins(self):
            for role in ('node','fixture','runner'):
                with self.pinned_staging_edges() as (ops,state,raw):
                    def changed():
                        data=b'coherently replaced public observations';state['drift'][role]=data
                        ops.facts['before'][role].update(bytes=len(data),sha256=sha(data))
                    state['onSpawn']=changed
                    result,failure=stage_preparation_inputs(ops)
                    self.assertFalse(result['pass'],role);self.assertIsNotNone(failure.first)
                    self.assertEqual(result['process']['exitCode'],0)
                    self.assertEqual(ops.facts['before'][role],ops.facts['after'][role])
                    self.assertIn('independent selected-file pin' if role=='node' else 'joins admitted source',failure.first['message'])

        def test_pinned_generation_caller_selected_coherent_manifest_is_not_authenticated(self):
            for role,name in (('fixture','fixture.mjs'),('runner','run.py')):
                with self.pinned_staging_edges() as (old,state,raw):
                    path='scripts/i80386-ring3-int-iret/'+name;data=b'caller-selected coherent replacement'
                    state[role]=data;state['sourceData'][path]=data
                    value=final_json(raw);value['files'][path]={'bytes':len(data),'sha256':sha(data),'mode':'100644',
                        'blob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}
                    selected=encode(value)
                    ops=PinnedRecordingStagingOps(selected,sha(selected),'a'*40,'b'*40,old.environ)
                    result,failure=stage_preparation_inputs(ops)
                    self.assertTrue(result['pass']);self.assertIsNone(failure.first)
                    self.assertNotEqual(selected,raw)  # External provenance must reject unreviewed selections.

        def test_generation_frame_preserves_original_bytes_and_refuses_all_extent_and_digest_cuts(self):
            generation=b'{"original":"GEN"}\n';pre=b'original PRE bytes\xff'
            frame=generation_frame(generation,pre)
            with patch.dict(globals(),final_json=Mock(side_effect=AssertionError('no root JSON parser'))):
                self.assertEqual(generation_parts(frame),(generation,pre))
            cuts=[frame[:43],frame[:-1],frame+b'suffix',b'BADMAGIC'+frame[8:],frame[:12]+b'X'*32+frame[44:]]
            for lengths in ((0,len(pre)),(GENERATION_CAP+1,len(pre)),(len(generation),GIT_TRACE_CAP+1)):
                body=struct.pack('>II',*lengths)+generation+pre
                cuts.append(GENERATION_MAGIC+struct.pack('>I',len(body))+hashlib.sha256(body).digest()+body)
            for cut in cuts:
                with self.assertRaises(ValueError):generation_parts(cut)
            self.assertEqual(generation_parts(generation_frame(generation,b'')),(generation,b''))
            with self.assertRaisesRegex(ValueError,'shared'):generation_frame(b'X'*GENERATION_CAP,b'Y'*GIT_TRACE_CAP)

        @contextlib.contextmanager
        def generated_child_edges(self):
            with self.staging_edges() as (base,state):
                ops=RecordingStagingOps(base.environ);original=ops.create
                def create():
                    child=original();child.t=20;return child
                ops.create=create;frames=[];flushed=[];pre_calls=[];clock=iter((10,40,50))
                def preparation(environ,**kwargs):
                    pre_calls.append(True);state['events'].append('PRE-GIT')
                    kwargs['emit'](preparation_frame(b'original PRE bytes\xff'));kwargs['flush']()
                    return {'pass':True},FirstFailure()
                with patch.object(time,'monotonic_ns',side_effect=lambda:next(clock)),patch.dict(globals(),preparation_child=preparation):
                    yield ops,state,frames,flushed,pre_calls

        def test_generated_child_records_after_all_reads_before_pre_and_emits_immutable_opaque_originals(self):
            with self.generated_child_edges() as (ops,state,frames,flushed,pre_calls):
                result,failure=generated_preparation_child(ops.environ,staging_ops=ops,emit=lambda raw:frames.append(raw) or len(raw),flush=lambda:flushed.append(True))
                self.assertTrue(result['pass']);self.assertIsNone(failure.first);self.assertEqual(pre_calls,[True]);self.assertEqual(flushed,[True])
                raw,pre=generation_parts(frames[0]);value=final_json(raw)
                self.assertEqual(raw,result['generationOriginal']);self.assertEqual(pre,b'original PRE bytes\xff')
                self.assertEqual(value['before']['monoNs'],10);self.assertEqual(value['after']['monoNs'],40);self.assertEqual(value['captureMonoNs'],50)
                self.assertLessEqual(value['before']['monoNs'],value['process']['spawnMonoNs']);self.assertLessEqual(value['process']['reapMonoNs'],value['after']['monoNs'])
                self.assertLess(state['events'].index('output-fixture.json'),state['events'].index('PRE-GIT'))
                self.assertEqual(value['before']['files'],value['after']['files'])
                ops.facts['before']['node']['sha256']='caller replacement';self.assertEqual(generation_parts(frames[0])[0],raw)

        def test_generated_child_failure_transport_keeps_process_first_and_zero_pre_without_calling_pre_git(self):
            with self.generated_child_edges() as (ops,state,frames,flushed,pre_calls):
                state['code']=1;state['stderr']=b'original generator WRITE/CLOSE error'
                state['onSpawn']=lambda:state['outputs'].pop('fixture.json')
                result,failure=generated_preparation_child(ops.environ,staging_ops=ops,emit=lambda raw:frames.append(raw) or len(raw),flush=lambda:None)
                self.assertFalse(result['pass']);self.assertEqual(pre_calls,[])
                raw,pre=generation_parts(frames[0]);value=final_json(raw);self.assertEqual(pre,b'')
                self.assertEqual(value['firstFailure'],result['generation']['process']['firstFailure']);self.assertEqual(failure.first,value['firstFailure'])
                self.assertEqual(base64.b64decode(value['stderr']['base64']),state['stderr']);self.assertIn('fixture.rom',value['outputs']);self.assertNotIn('fixture.json',value['outputs'])

        def test_generated_child_short_flush_or_shared_cap_failure_never_returns_success(self):
            for fault in ('short','flush','shared','PRE-error'):
                with self.generated_child_edges() as (ops,state,frames,flushed,pre_calls):
                    def emit(raw):frames.append(raw[:-1] if fault=='short' else raw);return len(raw)-1 if fault=='short' else len(raw)
                    def flush():
                        if fault=='flush':raise OSError('GENERATED_FLUSH')
                    def preparation(environ,**kwargs):
                        if fault=='PRE-error':raise OSError('ORIGINAL_PRE_ERROR')
                        kwargs['emit'](preparation_frame(b'X'*GIT_TRACE_CAP));return {'pass':True},FirstFailure()
                    with patch.dict(globals(),**({'preparation_child':preparation} if fault in ('shared','PRE-error') else {})):
                        result,failure=generated_preparation_child(ops.environ,staging_ops=ops,emit=emit,flush=flush)
                    self.assertFalse(result['pass']);self.assertIsNotNone(failure.first);self.assertIsNotNone(result['generationOriginal'])
                    self.assertEqual(result['generation']['streams'],{'stdout':b'','stderr':b''})
                    if fault=='shared':self.assertEqual(frames,[]);self.assertEqual(len(result['preGit']),GIT_TRACE_CAP)
                    elif fault=='PRE-error':self.assertEqual(failure.first['message'],'ORIGINAL_PRE_ERROR');self.assertEqual(generation_parts(frames[0])[1],b'')

        @contextlib.contextmanager
        def generated_original_edges(self):
            with self.preparation_original_edges() as (old,outside,env,pre,post,state):
                entry=final_json(state['data']['.entry.json']);phase=final_json(old._preparation_original)
                source=final_json(state['data']['source.before.json']);runtime=final_json(state['data']['runtime.before.json'])
                node=runtime['qemuPackage']['files'][RUNTIME_EXECUTABLES['node']]
                files={'node':{'path':RUNTIME_EXECUTABLES['node'],'bytes':node['bytes'],'sha256':node['sha256']}}
                for role,name in (('fixture','fixture.mjs'),('runner','run.py')):
                    path='scripts/i80386-ring3-int-iret/'+name;item=source['files'][path];files[role]={'path':path,'bytes':item['bytes'],'sha256':item['sha256']}
                process=json.loads(json.dumps(phase['process']));process.update(role='discovery',pid=402,pgid=402,parentPid=401,
                    argv=[RUNTIME_EXECUTABLES['node'],'--input-type=module','--eval',STAGING_DRIVER],environment=dict(ENV),spawnMonoNs=60,reapMonoNs=70)
                recording=RecordingStagingOps(env);recording.uid,recording.gid=entry['uid'],entry['gid'];recording.observation_times={'before':55,'after':75}
                recording.facts['before']=json.loads(json.dumps(files));recording.facts['after']=json.loads(json.dumps(files))
                recording.facts['outputFacts']={name:{'bytes':len(state['data']['inputs/'+name]),'sha256':sha(state['data']['inputs/'+name])} for name in ('fixture.rom','fixture.json')}
                result={'process':process,'streams':{'stdout':b'','stderr':b''},'facts':recording.facts}
                with patch.object(time,'monotonic_ns',return_value=80):generation=generation_original(recording,result,FirstFailure())
                ops=GeneratedEntryComposition(env);ops.python=entry['python'];ops.bootstrap.invoker={'uid':entry['uid'],'gid':entry['gid']}
                ops.pre_git=pre;ops._generation_original=generation;phase['process']['argv'][-1]='--prepare-generated'
                ops.preparation={'process':phase['process'],'streams':{'stdout':generation_frame(generation,pre),'stderr':b''},'ownership':phase['ownership']}
                with patch.object(time,'monotonic_ns',return_value=600):ops.freeze_preparation_original(FirstFailure())
                yield ops,outside,env,pre,post,state

        def test_generated_full_phase_actual_capture_finalizer_and_log_only_originals(self):
            with self.generated_original_edges() as (ops,outside,env,pre,post,state):
                raw=ops._generation_original
                result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,preparation_original=ops._preparation_original,
                    generation_original=raw,emit=lambda line:state['log'].append(line) or len(line),flush=lambda:None)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first);self.assertEqual(set(state['export']),PACKET_ROLES)
                self.assertNotIn('generation.phase.json',state['export']);self.assertEqual(len(INTERNAL_NAMES),5)
                rows=[final_json(line[len(b'RING3_ORIGINAL '):]) for line in state['log']]
                self.assertEqual(len({row['name'] for row in rows}),8)
                self.assertEqual(base64.b64decode(''.join(row['data'] for row in rows if row['name']=='generation.phase.json')),raw)

        def test_generated_reencoded_typed_timing_identity_and_output_refusals(self):
            for fault in ('before-float','before-late','after-early','capture-late','parent','self-parent','live-owner','argv','environment','node','source','output','stderr','error','phase-mode'):
                with self.generated_original_edges() as (ops,outside,env,pre,post,state):
                    value=final_json(ops._generation_original);phase=final_json(ops._preparation_original)
                    if fault=='before-float':value['before']['monoNs']=55.0
                    elif fault=='before-late':value['before']['monoNs']=61
                    elif fault=='after-early':value['after']['monoNs']=69
                    elif fault=='capture-late':value['captureMonoNs']=101
                    elif fault=='parent':value['process']['parentPid']+=1
                    elif fault=='self-parent':value['process']['pid']=value['process']['pgid']=phase['process']['pid']
                    elif fault=='live-owner':value['process']['pid']=value['process']['pgid']=phase['process']['parentPid']
                    elif fault=='argv':value['process']['argv'][-1]='arbitrary script'
                    elif fault=='environment':value['process']['environment']['NODE_OPTIONS']='injected'
                    elif fault=='node':value['before']['files']['node']['bytes']=float(value['before']['files']['node']['bytes'])
                    elif fault=='source':value['before']['files']['fixture']['sha256']='a'*64
                    elif fault=='output':value['outputs']['fixture.rom']['bytes']+=1
                    elif fault=='stderr':value['stderr']={'bytes':1,'sha256':sha(b'X'),'base64':'WA=='}
                    elif fault=='error':value['firstFailure']={'phase':'generation','name':'Error','message':'ORIGINAL FAILURE'}
                    else:phase['process']['argv'][-1]='--prepare'
                    generation=encode(value);wire=generation_frame(generation,pre)
                    phase['stdout']={'bytes':len(wire),'sha256':sha(wire),'base64':base64.b64encode(wire).decode()}
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,preparation_original=encode(phase),
                        generation_original=generation,emit=lambda line:len(line),flush=lambda:None)
                    self.assertFalse(result['pass']);self.assertIsNotNone(failure.first);self.assertNotIn('resources.json',state['export'])

        def test_generated_parent_opaque_decode_retains_failed_parts_and_zero_pre_blocks_outside(self):
            for fault in ('none','failed','zero-pre','truncated'):
                with self.composition_edges() as (old,state):
                    ops=GeneratedEntryComposition(state['env']);ops.validate()
                    with patch.object(os,'getpid',return_value=101):descriptor=LinuxGeneratedPreparation(ops)
                    self.assertEqual(descriptor.argv,[ops.python['path'],'-I','-B',RUN_FILE,'--prepare-generated'])
                    ops.require_preparation_ownership=old.require_preparation_ownership;ops.finish_preparation_ownership=old.finish_preparation_ownership
                    frame=generation_frame(b'opaque GEN bytes\xff',b'' if fault=='zero-pre' else b'opaque PRE bytes\xff')
                    if fault=='truncated':frame=frame[:-1]
                    def create():
                        child=Fake([[('stdout',frame)]],status(1 if fault=='failed' else 0));child.argv=[ops.python['path'],'-I','-B',RUN_FILE,'--prepare-generated']
                        child.environment=dict(ENV);ops.pre_child=child;return child
                    ops.create_preparation=create;failure=FirstFailure()
                    with patch.dict(globals(),final_json=Mock(side_effect=AssertionError('root must not parse GEN/PRE JSON'))):ops.prepare(failure)
                    if fault=='none':self.assertIsNone(failure.first)
                    else:self.assertIsNotNone(failure.first)
                    if fault!='truncated':self.assertEqual(ops._generation_original,b'opaque GEN bytes\xff')
                    phase=final_json(ops._preparation_original);self.assertEqual(phase['schema'],'bw.ring3.preparation-original.v2')
                    self.assertEqual(base64.b64decode(phase['stdout']['base64']),frame)

        def test_generation_original_and_log_caps_refuse_without_replacing_primary_or_entering_pre(self):
            with self.generated_child_edges() as (ops,state,frames,flushed,pre_calls):
                old=ops.observe
                def observed(stage,failure):
                    old(stage,failure)
                    if stage=='after':ops.facts['after']['node']['path']='X'*GENERATION_CAP
                ops.observe=observed
                result,failure=generated_preparation_child(ops.environ,staging_ops=ops,emit=lambda frame:frames.append(frame) or len(frame),flush=lambda:None)
                self.assertFalse(result['pass']);self.assertEqual(pre_calls,[]);self.assertEqual(frames,[])
                self.assertIsNone(result['generationOriginal']);self.assertIn('encoding cap',failure.first['message'])
                self.assertIsNotNone(result['generation']['process']);self.assertIn('fixture.rom',result['generation']['facts']['outputs'])
            failure=FirstFailure();failure.add(ValueError('FIRST_GENERATOR'),'generator');lines=[]
            progress=emit_originals({'generation.phase.json':b'X'*(GENERATION_CAP+1)},lambda line:lines.append(line) or len(line),failure,lambda:None)
            self.assertFalse(progress['complete']);self.assertEqual(lines,[]);self.assertEqual(failure.first['message'],'FIRST_GENERATOR');self.assertTrue(failure.secondary)

        def test_generated_failure_log_requires_verified_drop_and_keeps_first_error(self):
            for fault in ('none','drop','flush'):
                with self.composition_edges() as (old,state):
                    ops=GeneratedEntryComposition(state['env']);ops.validate();ops._preparation_original=b'original phase';ops._generation_original=b'original GEN'
                    failure=FirstFailure();failure.add(ValueError('FIRST_GENERATOR'),'generator');attempts=[]
                    if fault=='drop':ops.bootstrap.drop=Mock()
                    def emit(raw):attempts.append(raw);entry_ids(1001,1002);return len(raw)
                    def flush():
                        if fault=='flush':raise OSError('GEN_LOG_FLUSH')
                    with patch.object(sys,'stdout',SimpleNamespace(buffer=SimpleNamespace(write=emit,flush=flush))):result=ops.failure_only(failure)
                    self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'FIRST_GENERATOR')
                    if fault=='drop':self.assertEqual(attempts,[])
                    else:self.assertTrue(attempts);self.assertEqual(ops._preparation_log['complete'],fault=='none')

        @contextlib.contextmanager
        def staging_edges(self):
            env={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40}
            state={'uids':(1001,)*3,'gids':(1002,)*3,'groups':[],'member':'0::/bw-ring3-123-1-preparation\n',
                'events':[],'entries':[],'dirMode':0o40700,'dirOwner':(1001,1002),'inode':90,'outputs':{},
                'inputs':{'fixture.rom':b'Z'*65536,'fixture.json':b'{"schema":"mock"}\n'},
                'node':b'observed mock Node','fixture':b'authored mock builder','runner':b'held mock runner',
                'readFaults':{},'drift':{},'after':False,'code':0,'stderr':b'','stdout':b'',
                'scanClose':None,'outputOwner':(1001,1002),'outputMode':0o100600,'outputExtent':None}
            ops=StagingOps(env)
            class Entries:
                def __init__(self):self.first=True
                def __iter__(self):return self
                def __next__(self):
                    state['events'].append('scan-next')
                    if self.first and state['entries']:self.first=False;return object()
                    raise StopIteration
                def close(self):
                    state['events'].append('scan-close')
                    if state['scanClose']:raise state['scanClose']
            def lstat(path):
                name=str(path);uid,gid=1001,1002;mode=0o100644;size=0
                if name in ('/checkout','/checkout/build','/checkout/'+str(STAGED_INPUTS)):
                    uid,gid=state['dirOwner'];mode=state['dirMode']
                elif name==RUNTIME_EXECUTABLES['node']:uid,gid=0,0;mode=0o100755
                elif name.startswith('/checkout/'+str(STAGED_INPUTS)+'/'):
                    key=Path(name).name
                    if key not in state['outputs']:raise FileNotFoundError('partial '+key)
                    uid,gid=state['outputOwner'];mode=state['outputMode'];size=len(state['outputs'][key]) if state['outputExtent'] is None else state['outputExtent']
                return SimpleNamespace(st_mode=mode,st_uid=uid,st_gid=gid,st_dev=3,st_ino=state['inode'],st_size=size)
            def source(role):
                state['events'].append('read-'+role)
                if role in state['readFaults']:raise state['readFaults'][role]
                return state['drift'].get(role,state[role]) if state['after'] else state[role]
            def read(path,cap,**kwargs):
                name=str(path)
                if name.endswith('/fixture.mjs'):return source('fixture')
                if name.endswith('/run.py'):return source('runner')
                key=Path(path).name;state['events'].append('output-'+key)
                if key in state['readFaults']:raise state['readFaults'][key]
                raw=state['outputs'][key];need(len(raw)<=cap,'mock bounded staging output');return raw
            def factory(owner):
                state['events'].append('factory')
                child=Fake([[('stdout',state['stdout']),('stderr',state['stderr'])]],status(state['code']))
                child.argv=[RUNTIME_EXECUTABLES['node'],'--input-type=module','--eval',STAGING_DRIVER]
                child.environment=dict(ENV)
                def spawn():
                    state['events'].append('spawn');owner.spawn_attempted=True;state['after']=True
                    state['outputs'].update(state['inputs']);state.get('onSpawn',lambda:None)()
                    return {'pid':202,'pgid':202,'parentPid':101,'startTicks':234}
                child.spawn=spawn;return child
            with patch.object(Path,'cwd',return_value=Path('/checkout')),patch.object(Path,'resolve',lambda path,**kwargs:path),                 patch.object(Path,'lstat',lstat),patch.object(os,'scandir',side_effect=lambda path:Entries()),                 patch.object(os,'getresuid',side_effect=lambda:state['uids']),patch.object(os,'getresgid',side_effect=lambda:state['gids']),                 patch.object(os,'getgroups',side_effect=lambda:state['groups']),patch.object(RuntimeFiles,'resolve',side_effect=lambda path:(path,{})),                 patch.object(RuntimeFiles,'read',side_effect=lambda files,path,cap:source('node'),autospec=True),                 patch.dict(globals(),bounded_read=read,LinuxStaging=factory,ROM_SHA=sha(state['inputs']['fixture.rom']),                 FIXTURE_JSON_SHA=sha(encode(entry_json(state['inputs']['fixture.json']))[:-1]),                 entry_proc=lambda path:state['member'] if path.endswith('cgroup') else ''.join(k+':\t'+'0'*16+'\n' for k in ('CapInh','CapPrm','CapEff','CapAmb'))),                 patch.object(subprocess,'Popen',side_effect=AssertionError('no staging process in inert controls')):
                yield ops,state

        def test_staging_actual_callable_keeps_fixed_process_outputs_and_observed_readbacks(self):
            with self.staging_edges() as (ops,state):
                result,failure=stage_preparation_inputs(ops)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first)
                self.assertEqual(result['process']['argv'],[RUNTIME_EXECUTABLES['node'],'--input-type=module','--eval',STAGING_DRIVER])
                self.assertEqual(result['process']['environment'],ENV);self.assertEqual(result['streams'],{'stdout':b'','stderr':b''})
                self.assertEqual(result['facts']['outputs'],state['inputs'])
                self.assertEqual(result['facts']['before'],result['facts']['after'])
                for name in ('node','fixture','runner'):self.assertEqual(state['events'].count('read-'+name),2)
                self.assertLess(state['events'].index('read-runner'),state['events'].index('factory'))
                self.assertLess(state['events'].index('spawn'),state['events'].index('output-fixture.rom'))

        def test_staging_initial_privilege_membership_directory_and_scan_refusals_never_factory_or_read_outputs(self):
            for fault in ('root','groups','membership','owner','permissions','nonempty','scan-close'):
                with self.staging_edges() as (ops,state):
                    if fault=='root':state['uids']=(0,)*3
                    elif fault=='groups':state['groups']=[1001]
                    elif fault=='membership':state['member']='0::/actions/job\n'
                    elif fault=='owner':state['dirOwner']=(0,0)
                    elif fault=='permissions':state['dirMode']=0o40777
                    elif fault=='nonempty':state['entries']=['unknown'];state['scanClose']=OSError('SCAN_CLOSE_SECONDARY')
                    else:state['scanClose']=OSError('SCAN_CLOSE_FIRST')
                    result,failure=stage_preparation_inputs(ops)
                    self.assertFalse(result['pass']);self.assertIsNotNone(failure.first);self.assertFalse(result['spawnAttempted'])
                    self.assertNotIn('factory',state['events']);self.assertFalse(any(name.startswith('output-') for name in state['events']))
                    if fault=='nonempty':self.assertIn('SCAN_CLOSE_SECONDARY',[row['message'] for row in failure.secondary])
                    self.assertLessEqual(state['events'].count('scan-next'),1)

        def test_staging_source_failure_or_late_directory_change_stops_factory_and_attempts_all_identity_reads(self):
            with self.staging_edges() as (ops,state):
                state['readFaults']['fixture']=OSError('FIRST_SOURCE')
                result,failure=stage_preparation_inputs(ops)
                self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'FIRST_SOURCE')
                self.assertNotIn('factory',state['events']);self.assertEqual(state['events'].count('read-node'),2);self.assertEqual(state['events'].count('read-runner'),2)
            with self.staging_edges() as (ops,state):
                observe=ops.observe
                def observed(stage,failure):
                    observe(stage,failure)
                    if stage=='before':state['inode']+=1
                ops.observe=observed
                result,failure=stage_preparation_inputs(ops)
                self.assertFalse(result['pass']);self.assertNotIn('factory',state['events']);self.assertIn('identity readback',failure.first['message'])

        def test_staging_process_first_failure_keeps_raw_streams_and_partial_outputs_despite_readback_faults(self):
            with self.staging_edges() as (ops,state):
                state['code']=1;state['stderr']=b'original WRITE/CLOSE error';state['onSpawn']=lambda:state['outputs'].pop('fixture.json')
                state['drift']['node']=b'changed Node'
                result,failure=stage_preparation_inputs(ops)
                self.assertFalse(result['pass']);self.assertEqual(failure.first,result['process']['firstFailure'])
                self.assertEqual(result['streams']['stderr'],b'original WRITE/CLOSE error');self.assertEqual(result['facts']['outputs']['fixture.rom'],state['inputs']['fixture.rom'])
                self.assertTrue(any('fixture.json' in row['message'] for row in failure.secondary));self.assertTrue(any('identity drift' in row['message'] for row in failure.secondary))
                self.assertEqual(state['events'].count('read-node'),2);self.assertEqual(state['events'].count('read-fixture'),2);self.assertEqual(state['events'].count('read-runner'),2)

        def test_staging_output_owner_extent_hash_and_post_identity_refusals_keep_all_available_bytes(self):
            for fault in ('owner','regular','extent','rom','metadata','read-close','identity','stderr'):
                with self.staging_edges() as (ops,state):
                    if fault=='owner':state['outputOwner']=(0,0)
                    elif fault=='regular':state['outputMode']=0o120777
                    elif fault=='extent':state['outputExtent']=JSON_CAP+1
                    elif fault=='rom':state['onSpawn']=lambda:state['outputs'].__setitem__('fixture.rom',b'bad ROM')
                    elif fault=='metadata':state['onSpawn']=lambda:state['outputs'].__setitem__('fixture.json',b'{"bad":true}\n')
                    elif fault=='read-close':state['readFaults']['fixture.rom']=OSError('READ_CLOSE_FIRST')
                    elif fault=='identity':state['drift']['fixture']=b'changed authored source'
                    else:state['stderr']=b'unexpected generator stderr'
                    result,failure=stage_preparation_inputs(ops)
                    self.assertFalse(result['pass']);self.assertIsNotNone(failure.first)
                    if fault=='read-close':self.assertIn('fixture.json',result['facts']['outputs'])
                    if fault=='identity':self.assertNotEqual(result['facts']['before']['fixture'],result['facts']['after']['fixture'])

        def test_staging_linux_descriptor_uses_inherited_group_and_existing_wait_reset(self):
            owner=SimpleNamespace(spawn_attempted=False,member=Mock())
            with patch.object(os,'getpid',return_value=101):child=LinuxStaging(owner)
            with patch.object(signal,'signal') as reset,patch.object(LinuxChild,'spawn',return_value={'pid':202}) as spawn:
                child.spawn();self.assertTrue(owner.spawn_attempted);reset.assert_called_once_with(signal.SIGCHLD,signal.SIG_DFL);spawn.assert_called_once()
            with patch.object(LinuxController,'preexec') as enter:child.preexec(7)
            owner.member.assert_called_once();enter.assert_called_once_with(child,7)
            self.assertEqual(child.argv,[RUNTIME_EXECUTABLES['node'],'--input-type=module','--eval',STAGING_DRIVER]);self.assertEqual(child.environment,ENV)

        def test_staging_embedded_driver_is_closed_pure_builder_with_exclusive_nofollow_checked_writes(self):
            # Static literal contract only: no local Node/driver execution.
            self.assertEqual(re.findall(r"from '([^']+)'",STAGING_DRIVER),['node:fs','node:path','./scripts/i80386-ring3-int-iret/fixture.mjs'])
            self.assertIn('fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW',STAGING_DRIVER)
            self.assertIn('fs.fstatSync(fd)',STAGING_DRIVER);self.assertIn('s.isFile()||s.uid!==uid||s.gid!==gid',STAGING_DRIVER)
            self.assertIn('fs.writeSync(fd,data,0,data.length)!==data.length',STAGING_DRIVER)
            self.assertIn('if(first)first.ring3Secondary=[String(e)];else first=e;',STAGING_DRIVER)
            self.assertIn('directoryHandle.readSync()!==null',STAGING_DRIVER);self.assertNotIn('readdirSync',STAGING_DRIVER)
            self.assertIn("write('fixture.rom',rom);write('fixture.json',metadata)",STAGING_DRIVER)
            self.assertNotIn('executeFixture',STAGING_DRIVER);self.assertNotIn('child_process',STAGING_DRIVER)

        @contextlib.contextmanager
        def ownership_edges(self):
            env={'SUDO_UID':'1001','SUDO_GID':'1002','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1',
                 'BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40}
            state={'binding':(3,99,0,0),'dirMode':0o40755,'fileMode':0o100644,'fileOwner':(0,0),
                'fds':{},'next':100,'events':[],'member':'0::/actions/job\n','uids':(0,)*3,'gids':(0,)*3,'groups':[0],
                'closeFaults':{},'readFaults':{},'writeFault':None,'shortWrite':False}
            state['raw']={**{name:value+'\n' for key,value in LIMITS.items() for name in (Cgroups.FILES[key],)},
                'memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n',
                'cpu.stat':'usage_usec 0\nuser_usec 0\nsystem_usec 0\n','cgroup.events':'populated 0\nfrozen 0\n',
                'memory.current':'0\n','memory.peak':'0\n','pids.current':'0\n','cgroup.procs':''}
            parent=SimpleNamespace(environ=env,pre_child=None,python={'path':'/usr/bin/python3.12'},bootstrap=BootstrapOps(env))
            parent.bootstrap.invoker={'uid':1001,'gid':1002}
            owner=PreparationOwnership(parent);parent.preparation_ownership=owner
            parent.require_preparation_ownership=owner.admit
            def opened(path,flags,*args,**kwargs):
                fd=state['next'];state['next']+=1
                if 'dir_fd' in kwargs:
                    directory=kwargs['dir_fd'];self.assertEqual(state['fds'][directory][0],'dir')
                    name=str(path);self.assertIn(name,(*PreparationOwnership.FILES.values(),'cgroup.kill'))
                    state['fds'][fd]=('file',name,state['fds'][directory][1],directory)
                else:
                    self.assertEqual(Path(path),owner.path);state['fds'][fd]=('dir',state['binding'])
                state['events'].append(('open',fd,str(path),flags,dict(kwargs)));return fd
            def fstat(fd):
                info=state['fds'][fd]
                if info[0]=='dir':dev,ino,uid,gid=info[1];mode=state['dirMode']
                else:dev,ino,_,_=info[2];uid,gid=state['fileOwner'];mode=state['fileMode']
                return SimpleNamespace(st_dev=dev,st_ino=ino,st_uid=uid,st_gid=gid,st_mode=mode)
            def read(fd,cap):
                name=state['fds'][fd][1];state['events'].append(('read',name,cap))
                if name in state['readFaults']:raise state['readFaults'][name]
                return state['raw'][name].encode()
            def write(fd,data):
                name=state['fds'][fd][1];state['events'].append(('write',name,data,state['fds'][fd][3]))
                if state['writeFault']:raise state['writeFault']
                if state['shortWrite']:return 0
                if name=='cgroup.procs':
                    self.assertEqual(data,b'101');state['raw'].update({'cgroup.procs':'101\n','pids.current':'1\n','cgroup.events':'populated 1\nfrozen 0\n'})
                    state['member']='0::/'+owner.path.name+'\n'
                else:state['raw'].update({'cgroup.procs':'','pids.current':'0\n','cgroup.events':'populated 0\nfrozen 0\n'})
                return len(data)
            def close(fd):
                info=state['fds'].pop(fd);state['events'].append(('close',fd))
                key='dir' if info[0]=='dir' else info[1]
                if key in state['closeFaults']:raise state['closeFaults'][key]
            def ids(key,value):state[key]=value;state['events'].append((key,value))
            clock=[0]
            def now():clock[0]+=100000000;return clock[0]
            with patch.object(os,'open',side_effect=opened),patch.object(os,'fstat',side_effect=fstat),                 patch.object(os,'read',side_effect=read),patch.object(os,'write',side_effect=write),patch.object(os,'close',side_effect=close),                 patch.object(Path,'stat',return_value=SimpleNamespace(st_dev=3)),patch.object(os,'getpid',return_value=101),                 patch.object(os,'getresuid',side_effect=lambda:state['uids']),patch.object(os,'getresgid',side_effect=lambda:state['gids']),                 patch.object(os,'getgroups',side_effect=lambda:state['groups']),patch.object(os,'setgroups',side_effect=lambda value:ids('groups',value)),                 patch.object(os,'setresgid',side_effect=lambda *value:ids('gids',value)),patch.object(os,'setresuid',side_effect=lambda *value:ids('uids',value)),                 patch.object(time,'monotonic_ns',side_effect=now),patch.object(time,'sleep') as sleep,                 patch.dict(globals(),entry_proc=lambda path:state['member'] if path.endswith('cgroup') else ''.join(k+':\t'+'0'*16+'\n' for k in ('CapInh','CapPrm','CapEff','CapAmb'))):
                state['sleep']=sleep;yield owner,parent,state

        def test_ownership_fixed_sibling_anchor_and_child_migration_precedes_drop(self):
            with self.ownership_edges() as (owner,parent,state):
                owner.admit();parentfd=owner.directory;owner.begin_spawn();child=LinuxPreparation(parent)
                def identity(ops,fd):entry_ids(1001,1002);state['events'].append(('identity',fd))
                with patch.object(LinuxController,'preexec',identity):child.preexec(7)
                self.assertEqual(owner.path,Path('/sys/fs/cgroup/bw-ring3-123-1-preparation'))
                writes=[row for row in state['events'] if row[0]=='write'];self.assertEqual(writes[0][1:3],('cgroup.procs',b'101'))
                self.assertNotEqual(writes[0][3],parentfd);self.assertIn(parentfd,state['fds'])
                names=[row[0] for row in state['events']]
                self.assertLess(names.index('write'),names.index('groups'));self.assertLess(names.index('groups'),names.index('identity'))
                state['member']='0::/actions/job\n';state['raw'].update({'cgroup.procs':'','pids.current':'0\n','cgroup.events':'populated 0\nfrozen 0\n'})
                facts,failure=owner.finish({'waitStatus':0})
                self.assertIsNone(failure.first);self.assertTrue(facts['closeSucceeded']);self.assertEqual(state['fds'],{})
                self.assertFalse(facts['killAttempted']);self.assertFalse(facts['sessionSignalAttempted'])

        def test_ownership_initial_nonempty_or_untrusted_metadata_never_kills(self):
            for fault in ('nonempty','nested','owner','permissions','fileowner','limits','oom-schema'):
                with self.ownership_edges() as (owner,parent,state):
                    if fault=='nonempty':state['raw'].update({'cgroup.procs':'777\n','pids.current':'1\n','cgroup.events':'populated 1\n'})
                    elif fault=='nested':state['raw'].update({'pids.current':'1\n','cgroup.events':'populated 1\n'})
                    elif fault=='owner':state['binding']=(3,99,1001,1002)
                    elif fault=='permissions':state['dirMode']=0o40777
                    elif fault=='fileowner':state['fileOwner']=(1001,1002)
                    elif fault=='oom-schema':state['raw']['memory.events']='missing 0\n'
                    else:state['raw']['pids.max']='65\n'
                    with self.assertRaises(ValueError):owner.admit()
                    facts,found=owner.finish(None)
                    self.assertFalse(facts['killAttempted']);self.assertEqual(state['fds'],{})
                    self.assertEqual([row for row in state['events'] if row[0]=='write'],[])
                    with self.assertRaisesRegex(ValueError,'no reopen'):owner.admit()

        def test_ownership_reaped_leader_with_separate_or_nested_descendants_stays_failure(self):
            for nested in (False,True):
                with self.ownership_edges() as (owner,parent,state):
                    owner.admit();fd=owner.directory;owner.begin_spawn()
                    parent.pre_child=SimpleNamespace(process=SimpleNamespace(returncode=0),kill=Mock(),reap=Mock())
                    state['raw'].update({'cgroup.procs':'' if nested else '777\n','pids.current':'1\n','cgroup.events':'populated 1\n'})
                    facts,failure=owner.finish({'waitStatus':0})
                    self.assertIsNotNone(failure.first);self.assertTrue(facts['killAttempted'])
                    self.assertEqual(facts['beforeCleanup']['raw']['pidsCurrent'],'1\n')
                    self.assertEqual(facts['afterCleanup']['raw']['pidsCurrent'],'0\n')
                    parent.pre_child.kill.assert_not_called();parent.pre_child.reap.assert_not_called()
                    self.assertEqual([row[3] for row in state['events'] if row[0]=='write' and row[1]=='cgroup.kill'],[fd])
                    self.assertTrue(facts['closeSucceeded'])

        def test_ownership_no_own_spawn_never_kills_new_foreign_members(self):
            with self.ownership_edges() as (owner,parent,state):
                owner.admit();state['raw'].update({'cgroup.procs':'777\n','pids.current':'1\n','cgroup.events':'populated 1\n'})
                facts,failure=owner.finish(None)
                self.assertIsNotNone(failure.first);self.assertFalse(facts['killAttempted']);self.assertEqual(state['fds'],{})

        def test_ownership_partial_spawn_unknown_terminal_preserves_failure_after_cleanup(self):
            with self.ownership_edges() as (owner,parent,state):
                owner.admit();owner.begin_spawn();process=SimpleNamespace(returncode=None)
                def reap():process.returncode=0;return status()
                parent.pre_child=SimpleNamespace(process=process,kill=Mock(),reap=Mock(side_effect=reap))
                state['raw'].update({'cgroup.procs':'777\n','pids.current':'1\n','cgroup.events':'populated 1\n'})
                facts,failure=owner.finish(None)
                self.assertIsNotNone(failure.first);self.assertTrue(facts['sessionSignalAttempted']);self.assertTrue(facts['killAttempted'])
                self.assertIsNotNone(facts['cleanupTerminal']);self.assertTrue(facts['closeSucceeded'])
                parent.pre_child.kill.assert_called_once();parent.pre_child.reap.assert_called_once()

        def test_ownership_reopen_identity_and_mutable_returned_facts_never_retarget(self):
            with self.ownership_edges() as (owner,parent,state):
                owner.admit();fd=owner.directory;binding=owner._binding;owner.begin_spawn()
                owner.facts['identity']['inode']=1234;owner.facts['owner']['uid']=1001
                state['binding']=(3,100,0,0)
                with self.assertRaisesRegex(ValueError,'directory identity'):owner.move_self()
                self.assertFalse(any(row[0]=='write' for row in state['events']))
                self.assertEqual(owner._binding,binding);self.assertIn(fd,state['fds'])
                owner.kill();self.assertEqual([row[3] for row in state['events'] if row[0]=='write'],[fd])
                owner.finish({'waitStatus':0});self.assertEqual(state['fds'],{})

        def test_ownership_oom_limits_and_close_faults_preserve_original_refusal(self):
            for fault in ('oom','limits','write-close'):
                with self.ownership_edges() as (owner,parent,state):
                    owner.admit();owner.begin_spawn()
                    if fault=='oom':
                        state['raw']['memory.events']=state['raw']['memory.events'].replace('oom 0','oom 1')
                        owner.facts['before']['raw']['memoryEvents']=state['raw']['memory.events']
                    elif fault=='limits':state['raw']['cpu.max']='200000 100000\n'
                    else:
                        state['raw'].update({'cgroup.procs':'777\n','pids.current':'1\n','cgroup.events':'populated 1\n'})
                        state['writeFault']=OSError('KILL_WRITE');state['closeFaults']['cgroup.kill']=OSError('KILL_CLOSE');state['closeFaults']['dir']=OSError('DIR_CLOSE')
                    facts,failure=owner.finish({'waitStatus':0})
                    self.assertIsNotNone(failure.first);self.assertTrue(facts['closeAttempted']);self.assertTrue(owner.consumed)
                    if fault=='write-close':
                        self.assertEqual(failure.first['message'],'entry cgroup must be empty')
                        messages=[row['message'] for row in failure.secondary]
                        self.assertIn('KILL_WRITE',messages);self.assertIn('KILL_CLOSE',messages);self.assertIn('DIR_CLOSE',messages)
                        self.assertFalse(facts['closeSucceeded'])
                    with self.assertRaisesRegex(ValueError,'no finish retry'):owner.finish({'waitStatus':0})
                    self.assertEqual(state['fds'],{})

        def test_ownership_kernel_read_error_survives_close_and_no_pathname_kill(self):
            with self.ownership_edges() as (owner,parent,state):
                owner.admit();state['readFaults']['cpu.stat']=OSError('FIRST_READ');state['closeFaults']['cpu.stat']=OSError('SECONDARY_CLOSE')
                with self.assertRaises(OSError) as caught:owner.snapshot()
                self.assertEqual(str(caught.exception),'FIRST_READ');self.assertEqual(caught.exception.ring3_secondary[0]['message'],'SECONDARY_CLOSE')
                owner.begin_spawn();state['fds'][owner.directory]=('dir',(3,101,0,0))
                with self.assertRaisesRegex(ValueError,'directory identity'):owner.kill()
                self.assertFalse(any(row[0]=='write' for row in state['events']))
                owner.finish({'waitStatus':0});self.assertEqual(state['fds'],{})

        def test_ownership_parent_outside_both_and_close_failure_blocks_composition_handoff(self):
            for membership in ('0::/bw-ring3-123-1/controller\n','0::/bw-ring3-123-1-preparation\n'):
                with self.ownership_edges() as (owner,parent,state):
                    state['member']=membership
                    with self.assertRaisesRegex(ValueError,'outside both'):owner.admit()
                    self.assertEqual(state['fds'],{})
            with self.ownership_edges() as (owner,parent,state):
                owner.admit();owner.begin_spawn();parent.preparation=None
                state['closeFaults']['dir']=OSError('FIRST_DIRECTORY_CLOSE')
                with self.assertRaises(ObservedFailure) as caught:
                    EntryComposition.finish_preparation_ownership(parent,{'waitStatus':0})
                self.assertEqual(caught.exception.firstFailure['message'],'FIRST_DIRECTORY_CLOSE')
                self.assertFalse(parent.preparation['ownership']['closeSucceeded'])
                self.assertTrue(parent.preparation['ownership']['closeAttempted'])
                self.assertEqual(state['fds'],{})
                with self.assertRaisesRegex(ValueError,'no reopen'):owner.admit()

        @contextlib.contextmanager
        def composition_edges(self):
            with self.entry_edges() as (bootstrap,state):
                state.update(phaseEvents=[],outsideFailure=FirstFailure(),outsideKnown=True,outsideDrop=True,
                    preWire=preparation_frame(b'opaque PRE bytes\xff'),preStatus=0,ownershipError=None)
                directory_names={'/checkout','/checkout/build','/checkout/'+str(STAGED_INPUTS)}
                def lstat(path):
                    name=str(path if path.is_absolute() else Path('/checkout')/path)
                    return SimpleNamespace(st_mode=0o40755 if name in directory_names else 0o100644,st_uid=1001,st_gid=1002)
                parent=EntryComposition(state['env'])
                parent.preparation_ownership=PreparationOwnership(parent)
                parent.preparation_ownership.move_self=Mock();parent.preparation_ownership.child_entered=Mock()
                old_open=os.open
                def mocked_open(path,flags,*args,**kwargs):
                    if str(path)==str(expected_cgroup(state['env']))+'-preparation':
                        raise ValueError('external preparation ownership/backstop sibling absent in old inert fixture')
                    return old_open(path,flags,*args,**kwargs)
                def require():state['phaseEvents'].append('admit-preparation')
                def finish(process):
                    state['phaseEvents'].append('preparation-descendants')
                    if state['ownershipError']:raise state['ownershipError']
                parent.require_preparation_ownership=Mock(side_effect=require)
                parent.finish_preparation_ownership=Mock(side_effect=finish)
                def factory():
                    parent.require_preparation_ownership();state['phaseEvents'].append('factory')
                    fake=Fake([[('stdout',state['preWire'])]],status(state['preStatus']))
                    fake.argv=[parent.python['path'],'-I','-B',RUN_FILE,'--prepare']
                    fake.environment=dict(ENV,**{k:state['env'][k] for k in ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},SUDO_UID='1001',SUDO_GID='1002')
                    def spawn():
                        state['phaseEvents'].append('preparation-spawn')
                        self.assertEqual(state['uids'],(0,)*3)
                        return {'pid':201,'pgid':201,'parentPid':101,'startTicks':123}
                    fake.spawn=spawn;parent.pre_child=fake;return fake
                parent.create_preparation=factory
                def outside(ops):
                    state['phaseEvents'].append('outside')
                    self.assertEqual(state['uids'],(0,)*3);self.assertEqual(parent.pre_git,b'opaque PRE bytes\xff')
                    if state['outsideDrop']:parent.bootstrap.drop()
                    return {'process':{'waitStatus':0 if state['outsideKnown'] else None},'cleanup':{}},state['outsideFailure']
                def final(facts,failure,pre,environ,**kwargs):
                    state['phaseEvents'].append('finalize')
                    entry_ids(1001,1002);self.assertIs(failure,state['outsideFailure'])
                    self.assertEqual(pre,b'opaque PRE bytes\xff')
                    return {'pass':failure.first is None and failure.secondary==[]},failure
                with patch.object(Path,'lstat',lstat),patch.object(os,'open',side_effect=mocked_open),patch.dict(globals(),outside_controller=outside,finalize_packet=final,                    entry_proc=lambda path:'0::/actions/job\n' if path.endswith('cgroup') else ''.join(k+':\t'+v+'\n' for k,v in state['caps'].items())),                     patch.object(subprocess,'Popen',side_effect=AssertionError('no real process in composition controls')):
                    yield parent,state

        def test_composition_actual_phases_keep_opaque_pre_and_same_outside_failure(self):
            with self.composition_edges() as (parent,state),patch.dict(globals(),final_json=Mock(side_effect=AssertionError('root must not parse PRE JSON'))):
                result,failure=compose_entry(parent)
                self.assertTrue(result['pass']);self.assertIs(failure,state['outsideFailure']);self.assertIs(parent.failure,failure)
                self.assertEqual(state['phaseEvents'],['admit-preparation','admit-preparation','factory','preparation-spawn','preparation-descendants','outside','finalize'])
                self.assertEqual(parent.preparation['streams']['stdout'],state['preWire'])
                self.assertEqual(parent.preparation['process']['role'],'preparation');self.assertEqual(state['uids'],(1001,)*3)

        def test_composition_default_ownership_gate_before_factory_and_spawn(self):
            with self.composition_edges() as (unused,state):
                parent=EntryComposition(state['env'])
                with patch.dict(globals(),LinuxPreparation=Mock(side_effect=AssertionError('must refuse before factory'))) as values:
                    result,failure=compose_entry(parent)
                    values['LinuxPreparation'].assert_not_called()
                self.assertFalse(result['pass']);self.assertIn('ownership/backstop',failure.first['message'])
                self.assertEqual(state['phaseEvents'],[]);self.assertIsNone(parent.pre_child)
                self.assertEqual(state['uids'],(1001,)*3)

        def test_composition_preparation_refusal_keeps_wire_and_skips_outside(self):
            for fault in ('status','status-type','frame','descendants','overflow','stderr'):
                with self.composition_edges() as (parent,state):
                    if fault=='status':state['preStatus']=1
                    elif fault=='status-type':state['preStatus']=False
                    elif fault=='frame':state['preWire']=state['preWire'][:-1]
                    elif fault=='descendants':state['ownershipError']=OSError('DESCENDANTS_UNKNOWN')
                    elif fault=='overflow':state['preWire']=b'X'*(PREPARATION_STREAMS['stdout']+1)
                    else:
                        original=parent.create_preparation
                        def factory():
                            child=original();child.chunks=[[('stdout',state['preWire']),('stderr',b'ORIGINAL STDERR')]];return child
                        parent.create_preparation=factory
                    result,failure=compose_entry(parent)
                    self.assertFalse(result['pass']);self.assertNotIn('outside',state['phaseEvents']);self.assertNotIn('finalize',state['phaseEvents'])
                    self.assertIsNotNone(failure.first);self.assertIn('preparation-descendants',state['phaseEvents'])
                    self.assertIsNotNone(result['preparation']['process'])
                    self.assertEqual(result['preparation']['streams']['stdout'],state['preWire'][:PREPARATION_STREAMS['stdout']])
                    self.assertEqual(state['uids'],(1001,)*3)

        def test_composition_failed_drop_or_unknown_outer_terminal_prevents_finalizer(self):
            for fault in ('drop','terminal'):
                with self.composition_edges() as (parent,state):
                    if fault=='drop':state['outsideDrop']=False
                    else:state['outsideKnown']=False
                    result,failure=compose_entry(parent)
                    self.assertFalse(result['pass']);self.assertIn('outside',state['phaseEvents']);self.assertNotIn('finalize',state['phaseEvents'])
                    self.assertIsNotNone(failure.first);self.assertEqual(state['uids'],(1001,)*3)

        def test_composition_authoritative_outside_first_and_identity_survive_finalizer_fault(self):
            for fault in ('retention','replacement'):
                with self.composition_edges() as (parent,state):
                    first=state['outsideFailure'];first.add(ValueError('FIRST_OUTSIDE'),'outside')
                    def final(facts,failure,pre,env):
                        if fault=='retention':failure.add(OSError('SECONDARY_FINAL'),'retention');return {'pass':True},failure
                        return {'pass':True},FirstFailure()
                    with patch.dict(globals(),finalize_packet=final):result,failure=compose_entry(parent)
                    self.assertFalse(result['pass']);self.assertIs(failure,first);self.assertEqual(failure.first['message'],'FIRST_OUTSIDE')
                    self.assertTrue(failure.secondary)

        def test_preparation_binary_frame_exact_body_and_all_corruption_cuts(self):
            raw=b'original PRE JSON remains opaque';frame=preparation_frame(raw)
            self.assertEqual(len(frame),44+len(raw));self.assertEqual(preparation_body(frame),raw)
            maximum=preparation_frame(b'X'*GIT_TRACE_CAP);self.assertEqual(len(maximum),PREPARATION_STREAMS['stdout'])
            self.assertEqual(preparation_body(maximum),b'X'*GIT_TRACE_CAP)
            with self.assertRaises(ValueError):preparation_frame(b'')
            variants=[b'',frame[:43],frame[:-1],frame+b'x',b'BADMAGIC'+frame[8:],
                frame[:8]+struct.pack('>I',0)+frame[12:],frame[:8]+struct.pack('>I',GIT_TRACE_CAP+1)+frame[12:],
                frame[:8]+struct.pack('>I',len(raw)-1)+frame[12:],frame[:12]+b'X'*32+frame[44:]]
            for wrong in variants:
                with self.assertRaises(ValueError):preparation_body(wrong)
            self.assertEqual(PREPARATION_STREAMS,{'stdout':GIT_TRACE_CAP+44,'stderr':16384})

        def test_internal_preparation_profile_caps_both_streams_and_natural_status(self):
            for stream,cap in PREPARATION_STREAMS.items():
                fake=Fake([[(stream,b'X'*(cap+1))]],status())
                process,originals=collect_child(fake,'preparation',['fixed'],profile='preparation')
                self.assertIsNotNone(process['firstFailure']);self.assertEqual(originals[stream],b'X'*cap)
            process,_=collect_child(Fake(terminal=status(1)),'preparation',['fixed'],profile='preparation')
            self.assertIsNotNone(process['firstFailure'])
            process,_=collect_child(Fake(terminal=status(),now_step=CHILD_NS+1),'preparation',['fixed'],profile='preparation')
            self.assertTrue(process['timedOut'])

        def test_linux_preparation_actual_descriptor_drop_order_and_no_ungated_spawn(self):
            with self.composition_edges() as (parent,state):
                parent.validate();child=LinuxPreparation(parent)
                self.assertEqual(child.argv,['/usr/bin/python3.12','-I','-B',RUN_FILE,'--prepare'])
                self.assertEqual(child.environment,dict(ENV,**{k:state['env'][k] for k in
                    ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},SUDO_UID='1001',SUDO_GID='1002'))
                def identity(ops,fd):entry_ids(1001,1002);state['events'].append(('identity',fd))
                with patch.object(LinuxController,'preexec',identity):child.preexec(7)
                self.assertEqual([name for name,value in state['events']],['groups','gids','uids','identity'])
            with self.composition_edges() as (parent,state):
                parent.validate();child=LinuxPreparation(parent)
                with patch.object(os,'setgroups',side_effect=OSError('DROP')),patch.object(LinuxController,'preexec') as identity:
                    with self.assertRaises(OSError):child.preexec(7)
                    identity.assert_not_called()
                parent.require_preparation_ownership=EntryComposition.require_preparation_ownership.__get__(parent)
                with patch.object(LinuxTool,'spawn',side_effect=AssertionError('unowned fork')) as spawn:
                    with self.assertRaisesRegex(ValueError,'ownership/backstop'):child.spawn()
                    spawn.assert_not_called()

        def test_preparation_child_actual_staged_reads_transport_and_flush_failure(self):
            for fault in ('positive','root','owner','short','flush','prepare-error'):
                with self.preparation_edges() as (ops,state,observer):
                    state['prepDirs'].add('/checkout/'+str(STAGED_INPUTS))
                    state['prepData'].update({str(STAGED_INPUTS/name):raw for name,raw in state['inputs'].items()})
                    if fault=='root':state['uids']=(0,)*3
                    elif fault=='owner':state['directoryOwners']['/checkout/'+str(STAGED_INPUTS)]=(1003,1002)
                    elif fault=='prepare-error':state['writeFaults'][str(ENTRY_FILE)]=OSError('FIRST_MARKER_WRITE')
                    emitted=[];flushed=[]
                    def emit(raw):emitted.append(raw);return len(raw)-1 if fault=='short' else len(raw)
                    def flush():
                        flushed.append(True)
                        if fault=='flush':raise OSError('FLUSH')
                    result,failure=preparation_child(state['env'],observer=observer,emit=emit,flush=flush)
                    if fault=='positive':
                        self.assertTrue(result['pass']);self.assertIsNone(failure.first)
                        self.assertEqual(preparation_body(emitted[0]),result['preparation']['preGit']);self.assertEqual(flushed,[True])
                    else:
                        self.assertFalse(result['pass']);self.assertIsNotNone(failure.first)
                        if fault in ('root','owner'):self.assertEqual(emitted,[]);self.assertFalse(any(str(STAGED_INPUTS) in p for p in state['prepReads']))
                        if fault=='flush':self.assertTrue(emitted);self.assertEqual(failure.first['message'],'FLUSH')
                        if fault=='prepare-error':self.assertEqual(failure.first['message'],'FIRST_MARKER_WRITE');self.assertEqual(emitted,[])

        @contextlib.contextmanager
        def preparation_edges(self):
            with self.entry_edges() as (bootstrap,state):
                state.update(uids=(1001,)*3,gids=(1002,)*3,groups=[],migrated=False)
                state['inputs']={'fixture.rom':b'R'*65536,'fixture.json':encode({'authored':'inert preparation input'})}
                state.update(prepData={},prepWrites=[],prepReads=[],prepEvents=[],prepDirs={'/checkout','/checkout/build'},
                    mkdirFaults={},writeFaults={},readFaults={},sourceMode={},observeCalls=[],pythonReads=0,
                    pythonData=b'python',onWrite=lambda name:None,onObserve=lambda role:None)
                def absolute(path):return str(path if path.is_absolute() else Path('/checkout')/path)
                def lstat(path):
                    name=absolute(path);uid,gid=state['directoryOwners'].get(name,(1001,1002))
                    return SimpleNamespace(st_mode=0o40700 if name in state['prepDirs'] else 0o100644,st_uid=uid,st_gid=gid)
                def mkdir(path,mode=0o777):
                    name=absolute(path);state['prepEvents'].append(('mkdir',name))
                    if name in state['mkdirFaults']:raise state['mkdirFaults'][name]
                    if name in state['prepDirs']:raise FileExistsError('inert existing directory')
                    state['prepDirs'].add(name)
                def read(path,cap,*,with_mode=False):
                    name=str(path);state['prepReads'].append(name)
                    if name in state['readFaults']:raise state['readFaults'][name]
                    if name in state['prepData']:data=state['prepData'][name]
                    elif name in state['sourceData']:data=state['sourceData'][name]
                    else:raise FileNotFoundError('inert missing preparation file')
                    need(len(data)<=cap,'inert preparation extent cap')
                    return (data,state['sourceMode'].get(name,'100644')) if with_mode else data
                def write(path,raw,cap):
                    name=str(path);state['prepWrites'].append(name);state['prepEvents'].append(('write',name))
                    if name in state['writeFaults']:raise state['writeFaults'][name]
                    need(name not in state['prepData'],'exclusive preparation original')
                    need(len(raw)<=cap,'inert prepared file cap');state['prepData'][name]=raw;state['onWrite'](name)
                base_observe=Cgroups.observe
                def observe(groups,role):
                    state['observeCalls'].append(role);state['onObserve'](role)
                    return base_observe(groups,role)
                def python_read(files,path,cap):state['pythonReads']+=1;return state['pythonData']
                def capture(head):
                    state['prepEvents'].append(('git',head));commands=[];source=state['source']
                    listing=''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n' for name in sorted(SOURCE_PATHS))
                    for index,argv in enumerate(GitObservation({},'before').allowed):
                        process={'schema':'bw.ring3.process.v1','role':'discovery','argv':['/usr/bin/git',*argv[1:]],
                            'cwdRole':'checkout','environment':dict(ENV),'pid':501+index,'pgid':501+index,'parentPid':101,
                            'startTicks':123,'spawnMonoNs':100+index*100,'reapMonoNs':101+index*100,
                            'exitCode':0,'signal':None,'waitStatus':0,'timedOut':False,
                            'rusage':{'userSeconds':0.1,'systemSeconds':0.01,'maxRssKiB':1024},'firstFailure':None,'secondary':[]}
                        output=((source['head']+'\n'),(source['tree']+'\n'),listing)[index].encode()
                        commands.append({'process':process,'stdoutHex':output.hex(),'stderrHex':''})
                    raw=encode({'schema':'bw.ring3.git.v1','phase':'before','source':source,'commands':commands,'firstFailure':None,'secondary':[]})
                    return state.get('preRaw',raw),state.get('preFailure',FirstFailure())
                observer=Mock();observer.capture.side_effect=capture
                with patch.object(Path,'lstat',lstat),patch.object(Path,'mkdir',mkdir),patch.object(Cgroups,'observe',observe),                     patch.object(RuntimeFiles,'read',python_read),patch.object(time,'monotonic_ns',return_value=10000),                     patch.dict(globals(),bounded_read=read,write_new=write,ROM_SHA=sha(state['inputs']['fixture.rom']),                        FIXTURE_JSON_SHA=sha(encode(entry_json(state['inputs']['fixture.json']))[:-1]),                        entry_proc=lambda path:'0::/actions/job\n' if path.endswith('cgroup') else ''.join(k+':\t'+v+'\n' for k,v in state['caps'].items())),                     patch.object(subprocess,'Popen',side_effect=AssertionError('no process in preparation controls')):
                    yield PreparationOps(state['inputs'],state['env'],observer),state,observer

        def test_preparation_actual_fresh_originals_pre_git_barrier_and_entry_last(self):
            with self.preparation_edges() as (ops,state,observer):
                result,failure=prepare_entry(ops)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first);observer.capture.assert_called_once_with('a'*40)
                self.assertEqual(state['events'],[]);self.assertFalse(state['migrated'])
                self.assertEqual(state['prepWrites'],[str(PACKET/'inputs/fixture.rom'),str(PACKET/'inputs/fixture.json'),str(PACKET/'source.before.json'),str(ENTRY_FILE)])
                self.assertEqual(state['observeCalls'],['enclosing','controller','js','qemu']*2)
                self.assertEqual(state['pythonReads'],2)
                self.assertEqual(state['prepData'][str(PACKET/'inputs/fixture.rom')],state['inputs']['fixture.rom'])
                self.assertEqual(ops.entry['sourceSha256'],sha(state['prepData'][str(PACKET/'source.before.json')]))
                self.assertEqual(state['prepData'][str(ENTRY_FILE)],encode(ops.entry))
                self.assertEqual(ops.entry['cgroups'],state['snapshots'])
                self.assertEqual(set(ops.source['files']),SOURCE_PATHS);self.assertIsNotNone(result['preGit'])
                before=dict(state['prepData']);again,found=prepare_entry(PreparationOps(state['inputs'],state['env'],observer))
                self.assertFalse(again['pass']);self.assertEqual(found.first['name'],'FileExistsError')
                self.assertEqual(state['prepData'],before);self.assertEqual(observer.capture.call_count,1)

        def test_preparation_identity_environment_and_source_paths_refuse_before_creation(self):
            for fault in ('root','groups','cap','attempt','head','tree','checkout','build-owner','source-path','membership'):
                with self.preparation_edges() as (ops,state,observer):
                    if fault=='root':state['uids']=(0,)*3
                    elif fault=='groups':state['groups']=[1001]
                    elif fault=='cap':state['caps']['CapInh']='1'
                    elif fault=='attempt':ops.environ['GITHUB_RUN_ATTEMPT']='2'
                    elif fault in ('head','tree'):ops.environ['BW_EXPECTED_'+fault.upper()]='invalid'
                    elif fault=='checkout':state['redirect']['/checkout']='/outside'
                    elif fault=='build-owner':state['directoryOwners']['/checkout/build']=(1003,1002)
                    elif fault=='source-path':state['redirect'][RUN_FILE]='/outside/source'
                    else:
                        with patch.dict(globals(),entry_proc=lambda path:'0::/bw-ring3-123-1/controller\n' if path.endswith('cgroup') else ''.join(k+':\t'+v+'\n' for k,v in state['caps'].items())):
                            result,failure=prepare_entry(ops)
                        self.assertFalse(result['pass']);self.assertEqual(state['prepWrites'],[]);observer.capture.assert_not_called();continue
                    result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass']);self.assertEqual(state['prepWrites'],[]);observer.capture.assert_not_called()
                    self.assertEqual(state['events'],[])

        def test_preparation_closed_input_bytes_and_golden_refusal_before_directory_creation(self):
            for fault in ('extra','missing','rom','metadata','type'):
                with self.preparation_edges() as (ops,state,observer):
                    if fault=='extra':ops.inputs['extra']=b'x'
                    elif fault=='missing':ops.inputs.pop('fixture.rom')
                    elif fault=='rom':ops.inputs['fixture.rom']=b'X'*65536
                    elif fault=='metadata':ops.inputs['fixture.json']=encode({'wrong':True})
                    else:ops.inputs['fixture.rom']=bytearray(ops.inputs['fixture.rom'])
                    result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass']);self.assertEqual(state['prepWrites'],[]);observer.capture.assert_not_called()
                    self.assertFalse(any(event[0]=='mkdir' for event in state['prepEvents']))

        def test_preparation_preserves_input_write_primary_and_available_original(self):
            with self.preparation_edges() as (ops,state,observer):
                state['writeFaults'][str(PACKET/'inputs/fixture.rom')]=OSError('FIRST_INPUT_WRITE')
                result,failure=prepare_entry(ops)
                self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'FIRST_INPUT_WRITE')
                self.assertIn(str(PACKET/'inputs/fixture.json'),state['prepData']);self.assertNotIn(str(ENTRY_FILE),state['prepData'])
                self.assertEqual(final_json(state['prepData'][str(ENTRY_FAILURE)])['firstFailure'],failure.first)
                observer.capture.assert_not_called()

        def test_preparation_bad_or_failed_pre_git_never_writes_source_or_entry(self):
            for fault in ('tree','raw-head','typed','duplicate','failed'):
                with self.preparation_edges() as (ops,state,observer):
                    raw,_=observer.capture('a'*40);observer.reset_mock()
                    value=final_json(raw)
                    if fault=='tree':value['source']['tree']='c'*40;state['preRaw']=encode(value)
                    elif fault=='raw-head':value['commands'][0]['stdoutHex']=b'wrong\n'.hex();state['preRaw']=encode(value)
                    elif fault=='typed':value['source']['files']['LICENSE']['bytes']=float(value['source']['files']['LICENSE']['bytes']);state['preRaw']=encode(value)
                    elif fault=='duplicate':state['preRaw']=raw.replace(b'"phase":"before"',b'"phase":"before","phase":"before"')
                    else:found=FirstFailure();found.add(ValueError('ORIGINAL_GIT'),'git');state['preFailure']=found
                    result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass']);self.assertIsNotNone(result['preGit'])
                    self.assertNotIn(str(PACKET/'source.before.json'),state['prepData']);self.assertNotIn(str(ENTRY_FILE),state['prepData'])
                    if fault=='failed':self.assertEqual(failure.first['message'],'ORIGINAL_GIT')

        def test_preparation_late_source_input_python_and_resource_drift_refuses_commit(self):
            for fault in ('source','mode','input','python','inode','limit','populated','source-original','redirect-input'):
                with self.preparation_edges() as (ops,state,observer):
                    def written(name):
                        if name!=str(PACKET/'source.before.json'):return
                        if fault=='source':state['sourceData'][RUN_FILE]=b'changed'
                        elif fault=='mode':state['sourceMode'][RUN_FILE]='100755'
                        elif fault=='input':state['prepData'][str(PACKET/'inputs/fixture.rom')]=b'X'*65536
                        elif fault=='source-original':state['prepData'][name]+=b' '
                        elif fault=='redirect-input':state['redirect']['/checkout/'+str(PACKET/'inputs')]='/outside'
                    state['onWrite']=written
                    def observed(role):
                        if len(state['observeCalls'])!=5:return
                        if fault=='python':state['pythonData']=b'changed Python'
                        elif fault=='inode':state['snapshots']['controller']['identity']['inode']=99
                        elif fault=='limit':state['snapshots']['js']['limits']['pidsMax']='65'
                        elif fault=='populated':state['snapshots']['qemu']['procs']=[999]
                    state['onObserve']=observed
                    if fault=='python':
                        original=ops.python;calls=[]
                        def python():
                            calls.append(True)
                            if len(calls)==2:state['pythonData']=b'changed Python'
                            return original()
                        ops.python=python
                    result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass'],fault);self.assertNotIn(str(ENTRY_FILE),state['prepData'],fault)
                    self.assertIsNotNone(failure.first);self.assertEqual(state['events'],[])
                    if fault=='redirect-input':self.assertNotIn(str(PACKET/'inputs/fixture.rom'),state['prepReads'])

        def test_preparation_python_setid_and_cgroup_shape_owner_alias_refuse(self):
            for fault in ('setid','owner','duplicate','extra'):
                with self.preparation_edges() as (ops,state,observer):
                    if fault=='setid':state['pythonMode']=0o104755
                    elif fault=='owner':state['dirGid']=1003
                    elif fault=='duplicate':state['snapshots']['qemu']['identity']=dict(state['snapshots']['js']['identity'])
                    else:state['snapshots']['qemu']['extra']=0
                    result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass']);self.assertNotIn(str(ENTRY_FILE),state['prepData']);self.assertEqual(state['events'],[])

        def test_preparation_mkdir_entry_close_and_retention_failures_keep_first(self):
            for fault in ('mkdir','entry-read','source-write','retention'):
                with self.preparation_edges() as (ops,state,observer):
                    if fault=='mkdir':state['mkdirFaults']['/checkout/'+str(PACKET/'inputs')]=OSError('FIRST_MKDIR')
                    elif fault=='entry-read':state['readFaults'][str(ENTRY_FILE)]=OSError('FIRST_ENTRY_READ')
                    elif fault=='source-write':state['writeFaults'][str(PACKET/'source.before.json')]=OSError('FIRST_SOURCE_WRITE')
                    else:
                        state['writeFaults'][str(PACKET/'source.before.json')]=OSError('FIRST_SOURCE_WRITE')
                        state['writeFaults'][str(ENTRY_FAILURE)]=OSError('SECONDARY_RETENTION')
                    result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass']);self.assertTrue(failure.first['message'].startswith('FIRST_'))
                    if fault=='retention':self.assertIn('SECONDARY_RETENTION',[v['message'] for v in failure.secondary])
                    self.assertEqual(state['events'],[])

        def test_preparation_actual_entry_writer_close_failure_and_prior_write_error(self):
            real_write=write_new
            for fault in ('close','write-close'):
                with self.preparation_edges() as (ops,state,observer):
                    mock_write=write_new;stream=Mock()
                    def original_write(raw):
                        # File creation/write precedes close. Preserve exact or
                        # partial marker bytes even when the operation refuses.
                        state['prepData'][str(ENTRY_FILE)]=raw if fault=='close' else raw[:17]
                        if fault=='write-close':raise OSError('FIRST_ENTRY_WRITE')
                        return len(raw)
                    stream.write.side_effect=original_write
                    stream.close.side_effect=OSError('ENTRY_CLOSE')
                    def write(path,raw,cap):
                        if Path(path)!=ENTRY_FILE:return mock_write(path,raw,cap)
                        with patch.object(os,'open',return_value=7),patch.object(os,'fdopen',return_value=stream):
                            return real_write(path,raw,cap)
                    with patch.dict(globals(),write_new=write):result,failure=prepare_entry(ops)
                    self.assertFalse(result['pass']);stream.close.assert_called_once()
                    self.assertEqual(failure.first['message'],'ENTRY_CLOSE' if fault=='close' else 'FIRST_ENTRY_WRITE')
                    if fault=='write-close':self.assertIn('ENTRY_CLOSE',[v['message'] for v in failure.secondary])
                    self.assertIn(str(ENTRY_FILE),state['prepData']);self.assertEqual(state['events'],[])
                    self.assertEqual(state['prepData'][str(ENTRY_FILE)],encode(ops.entry) if fault=='close' else encode(ops.entry)[:17])
                    self.assertEqual(final_json(state['prepData'][str(ENTRY_FAILURE)])['firstFailure'],failure.first)

        @contextlib.contextmanager
        def finalizer_edges(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                def factory(groups,role,argv):
                    fake=Fake([[('stdout',role.encode()+b'-opaque')]],status(0 if role=='js' else 1));fake.t=12000 if role=='js' else 14000
                    pid=201 if role=='js' else 202
                    fake.spawn=lambda:{'pid':pid,'pgid':pid,'parentPid':101,'startTicks':123+pid}
                    return fake
                ops.child_factory=factory;_,control_failure=controller_execute(ops);self.assertIsNone(control_failure.first)
                data={'source.before.json':encode(state['source']),'.entry.json':encode(state['owner'])}
                data.update({'inputs/'+name:raw for name,raw in state['inputs'].items()})
                data.update({'js/'+name:raw for name,raw in state['rawJs'].items()})
                data.update({str(Path(name).relative_to(PACKET)):raw for name,raw in state['writes']})
                outer_fake=Fake(terminal=status());outer_fake.environment=dict(ENV,**{k:state['env'][k] for k in
                    ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')},SUDO_UID='1001',SUDO_GID='1002')
                process,_=collect_child(outer_fake,'controller',['/usr/bin/python3.12','-I','-B',RUN_FILE,'--bootstrap'],profile='controller')
                process.update(spawnMonoNs=10000,reapMonoNs=20000)
                empty=json.loads(json.dumps(state['owner']['cgroups']))
                outside={'process':process,'cleanup':{'beforeCleanup':empty,'afterCleanup':json.loads(json.dumps(empty)),
                    'sessionSignalAttempted':False,'cgroupKillAttempted':False,'cleanupTerminal':None,'polls':1}}
                outside['cleanup']['afterCleanup']['controller']['raw']['memoryCurrent']='1\n'
                data['.outside.json']=encode(dict(outside,firstFailure=None,secondary=[],streamsHex={'stdout':'','stderr':''}))
                source=state['source'];listing=''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n' for name in sorted(SOURCE_PATHS))
                def trace(phase):
                    commands=[]
                    for index,argv in enumerate(GitObservation({},phase).allowed):
                        p=json.loads(json.dumps(process));p.update(role='discovery',argv=['/usr/bin/git',*argv[1:]],environment=dict(ENV),pid=501+index,pgid=501+index,parentPid=100)
                        start=(100 if phase=='before' else 30000)+index*100;p.update(spawnMonoNs=start,reapMonoNs=start+1)
                        output=((source['head']+'\n'),(source['tree']+'\n'),listing)[index].encode()
                        commands.append({'process':p,'stdoutHex':output.hex(),'stderrHex':''})
                    return encode({'schema':'bw.ring3.git.v1','phase':phase,'source':source,'commands':commands,'firstFailure':None,'secondary':[]})
                stage={'data':data,'export':{},'directories':set(),'log':[],'reads':[],'symlinks':set()}
                old_read=globals()['bounded_read']
                def read(path,cap,**kwargs):
                    try:name=Path(path).relative_to(PACKET).as_posix()
                    except ValueError:return old_read(path,cap,**kwargs)
                    stage['reads'].append(name)
                    if name not in data:raise FileNotFoundError('inert missing '+name)
                    need(len(data[name])<=cap,'inert original extent cap');return data[name]
                def iterdir(path):
                    prefix=Path(path).relative_to(PACKET).as_posix();prefix='' if prefix=='.' else prefix+'/'
                    names={name[len(prefix):].split('/')[0] for name in data if name.startswith(prefix)}
                    if not prefix:names.update(('inputs','js','qemu'))
                    return iter([path/name for name in sorted(names)])
                def lstat(path):
                    relative=str(path).replace('/checkout/','')
                    isdir=relative in ('/checkout','build',str(PACKET),*(str(PACKET/name) for name in ('inputs','js','qemu')))
                    mode=0o120777 if relative in stage['symlinks'] else 0o40755 if isdir else 0o100644
                    return SimpleNamespace(st_mode=mode,st_uid=1001,st_gid=1002)
                def mkdir(path,mode=0o777):
                    name=str(path);need(name not in stage['directories'],'exclusive export directory');stage['directories'].add(name)
                def write(path,raw,cap):
                    name=Path(path).relative_to(EXPORT).as_posix();need(name not in stage['export'],'exclusive staged original')
                    need(len(raw)<=cap,'staged encoding cap');stage['export'][name]=raw
                observer=Mock();observer.capture.return_value=(trace('after'),FirstFailure())
                with patch.dict(globals(),bounded_read=read,write_new=write),patch.object(Path,'iterdir',iterdir),\
                     patch.object(Path,'lstat',lstat),patch.object(Path,'mkdir',mkdir),patch.object(os,'getpid',return_value=100),\
                     patch.dict(globals(),entry_proc=lambda path:'0::/actions/job\n' if path.endswith('cgroup') else ''.join(k+':\t'+v+'\n' for k,v in state['caps'].items())):
                    yield outside,state['env'],trace('before'),observer,stage

        @contextlib.contextmanager
        def preparation_original_edges(self):
            # New full-phase fixture is causally coherent; old phase-local
            # fake ticks remain held and are not advertised as V5 positives.
            with self.finalizer_edges() as (outside,env,pre,post,state):
                entry=final_json(state['data']['.entry.json']);trace=final_json(pre)
                process=json.loads(json.dumps(outside['process']))
                process.update(role='preparation',pid=401,pgid=401,startTicks=901,
                    argv=[entry['python']['path'],'-I','-B',RUN_FILE,'--prepare'],spawnMonoNs=50,reapMonoNs=500)
                for command in trace['commands']:command['process']['parentPid']=401
                pre=encode(trace)
                with self.ownership_edges() as (owner,parent,kernel):
                    owner.admit();owner.begin_spawn();ownership,found=owner.finish({'waitStatus':0});self.assertIsNone(found.first)
                ops=EntryComposition(env);ops.python=entry['python'];ops.bootstrap.invoker={'uid':entry['uid'],'gid':entry['gid']}
                ops.pre_git=pre;ops.preparation={'process':process,'streams':{'stdout':preparation_frame(pre),'stderr':b''},'ownership':ownership}
                with patch.object(time,'monotonic_ns',return_value=600):ops.freeze_preparation_original(FirstFailure())
                yield ops,outside,env,pre,post,state

        def test_preparation_original_actual_freeze_and_full_finalizer_log_only_positive(self):
            with self.preparation_original_edges() as (ops,outside,env,pre,post,state):
                raw=ops._preparation_original;entry=final_json(state['data']['.entry.json'])
                value=check_preparation_original(raw,pre,outside,entry,env)
                self.assertEqual(value['process']['pid'],401);self.assertEqual(preparation_body(ops.preparation['streams']['stdout']),pre)
                ops.preparation['process']['pid']=999;ops.preparation['streams']['stdout']=b'caller replacement'
                ops.preparation['ownership']['identity']['inode']=999;ops.preparation_original=b'public replacement'
                self.assertEqual(ops._preparation_original,raw)
                result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,
                    emit=lambda line:state['log'].append(line) or len(line),flush=lambda:None,preparation_original=raw)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first);self.assertEqual(set(state['export']),PACKET_ROLES)
                self.assertNotIn('preparation.phase.json',state['export']);self.assertEqual(len(INTERNAL_NAMES),5)
                groups=[final_json(line[len(b'RING3_ORIGINAL '):]) for line in state['log']]
                rows=[row for row in groups if row['name']=='preparation.phase.json']
                self.assertTrue(rows);self.assertEqual(base64.b64decode(''.join(row['data'] for row in rows)),raw)

        def test_preparation_original_equal_ticks_and_reused_reaped_pid_are_allowed(self):
            with self.preparation_original_edges() as (ops,outside,env,pre,post,state):
                value=final_json(ops._preparation_original);value['captureMonoNs']=value['process']['reapMonoNs']
                value['process']['pid']=value['process']['pgid']=outside['process']['pid']
                trace=final_json(pre)
                for row in trace['commands']:row['process']['parentPid']=value['process']['pid']
                pre=encode(trace);wire=preparation_frame(pre)
                value['stdout']={'bytes':len(wire),'sha256':sha(wire),'base64':base64.b64encode(wire).decode()}
                value['preGit']={'bytes':len(pre),'sha256':sha(pre)}
                self.assertEqual(check_preparation_original(encode(value),pre,outside,final_json(state['data']['.entry.json']),env)['captureMonoNs'],500)

        def test_preparation_original_reencoded_closed_typed_descriptor_and_timing_refusals(self):
            for fault in ('unknown','attempt-float','pid-float','parent','python','invoker','argv','environment','signal','capture-early','capture-late','prep-span','git-parent','git-before','git-overlap','git-after','git-span','frame','pre-ref'):
                with self.preparation_original_edges() as (ops,outside,env,pre,post,state):
                    value=final_json(ops._preparation_original);process=value['process']
                    if fault=='unknown':value['unknown']=True
                    elif fault=='attempt-float':value['attempt']=1.0
                    elif fault=='pid-float':process['pid']=float(process['pid'])
                    elif fault=='parent':process['parentPid']+=1
                    elif fault=='python':value['python']['bytes']=float(value['python']['bytes'])
                    elif fault=='invoker':value['invoker']['uid']=float(value['invoker']['uid'])
                    elif fault=='argv':process['argv'][-1]='--run'
                    elif fault=='environment':process['environment']['LD_PRELOAD']='injected'
                    elif fault=='signal':process['signal']=15
                    elif fault=='capture-early':value['captureMonoNs']=499
                    elif fault=='capture-late':value['captureMonoNs']=outside['process']['spawnMonoNs']+1
                    elif fault=='prep-span':process['spawnMonoNs']=1;process['reapMonoNs']=120000000002;value['captureMonoNs']=process['reapMonoNs'];outside['process']['spawnMonoNs']=value['captureMonoNs']
                    elif fault.startswith('git-'):
                        trace=final_json(pre);commands=trace['commands']
                        if fault=='git-parent':commands[0]['process']['parentPid']+=1
                        elif fault=='git-before':commands[0]['process']['spawnMonoNs']=49
                        elif fault=='git-overlap':commands[1]['process']['spawnMonoNs']=100
                        elif fault=='git-after':commands[-1]['process']['reapMonoNs']=501
                        else:
                            process.update(spawnMonoNs=1,reapMonoNs=12000000001);value['captureMonoNs']=12000000001;outside['process']['spawnMonoNs']=12000000001
                            commands[0]['process'].update(spawnMonoNs=1,reapMonoNs=10000000002)
                        pre=encode(trace);wire=preparation_frame(pre)
                        value['stdout']={'bytes':len(wire),'sha256':sha(wire),'base64':base64.b64encode(wire).decode()};value['preGit']={'bytes':len(pre),'sha256':sha(pre)}
                    elif fault=='frame':
                        wire=preparation_frame(pre)+b'suffix';value['stdout']={'bytes':len(wire),'sha256':sha(wire),'base64':base64.b64encode(wire).decode()}
                    else:value['preGit']['bytes']+=1
                    with self.assertRaises((ValueError,TypeError,KeyError)):
                        check_preparation_original(encode(value),pre,outside,final_json(state['data']['.entry.json']),env)

        def test_preparation_original_reencoded_ownership_refusals_preserve_fixed_packet(self):
            for fault in ('root-owner','identity','limits','nested','oom','kill','session','unknown-terminal','close','partial'):
                with self.preparation_original_edges() as (ops,outside,env,pre,post,state):
                    value=final_json(ops._preparation_original);owner=value['ownership']
                    if fault=='root-owner':owner['owner']['uid']=1001
                    elif fault=='identity':owner['identity']['inode']+=1
                    elif fault=='limits':owner['beforeCleanup']['raw']['cpuMax']='200000 100000\n'
                    elif fault=='nested':owner['beforeCleanup']['raw']['pidsCurrent']='1\n'
                    elif fault=='oom':owner['beforeCleanup']['raw']['memoryEvents']=owner['beforeCleanup']['raw']['memoryEvents'].replace('oom 0','oom 1')
                    elif fault=='kill':owner['killAttempted']=True
                    elif fault=='session':owner['sessionSignalAttempted']=True
                    elif fault=='unknown-terminal':owner['cleanupTerminal']={'waitStatus':0}
                    elif fault=='close':owner['closeSucceeded']=False
                    else:owner['partial']['identity']['inode']+=1
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,
                        emit=lambda line:state['log'].append(line) or len(line),flush=lambda:None,preparation_original=encode(value))
                    self.assertFalse(result['pass']);self.assertIsNotNone(failure.first)
                    self.assertNotIn('resources.json',state['export']);self.assertNotIn('preparation.phase.json',state['export'])
                    self.assertIn('audit.json',state['export'])

        def test_preparation_original_capture_follows_finish_precedes_outside_and_is_not_recaptured(self):
            with self.composition_edges() as (parent,state):
                freeze=parent.freeze_preparation_original
                def captured(failure):
                    self.assertEqual(state['phaseEvents'][-1],'preparation-descendants');freeze(failure)
                    state['capture']=parent._preparation_original
                parent.freeze_preparation_original=captured
                outside=parent.outside
                def launch():
                    self.assertEqual(parent._preparation_original,state['capture'])
                    parent.preparation['streams']['stdout']=b'altered public dictionary'
                    return outside()
                parent.outside=launch
                result,failure=compose_entry(parent);self.assertTrue(result['pass']);self.assertIsNone(failure.first)
                self.assertEqual(parent._preparation_original,state['capture'])
                with self.assertRaisesRegex(ValueError,'no recapture'):freeze(FirstFailure())

        def test_preparation_original_public_bytes_cannot_replace_missing_own_capture_before_outside(self):
            with self.composition_edges() as (parent,state):
                parent.freeze_preparation_original=Mock();parent.preparation_original=b'public replacement'
                result,failure=compose_entry(parent)
                self.assertFalse(result['pass']);self.assertIsNotNone(failure.first)
                self.assertNotIn('outside',state['phaseEvents']);self.assertNotIn('finalize',state['phaseEvents'])
                self.assertIsNone(parent._preparation_original)

        def test_preparation_original_capture_cap_or_encode_failure_stops_outside_keeps_original_primary(self):
            for fault in ('cap','encode','prior'):
                with self.composition_edges() as (parent,state):
                    if fault=='prior':state['preStatus']=1
                    finish=parent.finish_preparation_ownership
                    def finished(process):
                        finish(process)
                        if fault=='cap':parent.preparation['ownership']={'partial':'X'*JSON_CAP}
                    parent.finish_preparation_ownership=finished;original_encode=encode
                    def encoded(value):
                        if fault in ('encode','prior') and type(value) is dict and value.get('schema')=='bw.ring3.preparation-original.v1':raise OSError('CAPTURE_ENCODING')
                        return original_encode(value)
                    with patch.dict(globals(),encode=encoded):result,failure=compose_entry(parent)
                    self.assertFalse(result['pass']);self.assertNotIn('outside',state['phaseEvents']);self.assertIsNone(parent._preparation_original)
                    self.assertEqual(parent.preparation['streams']['stdout'],state['preWire'])
                    if fault=='prior':
                        self.assertNotEqual(failure.first['message'],'CAPTURE_ENCODING')
                        self.assertIn('CAPTURE_ENCODING',[row['message'] for row in failure.secondary])
                    else:self.assertEqual(failure.first['message'],'preparation original encoding cap' if fault=='cap' else 'CAPTURE_ENCODING')

        def test_preparation_original_failed_prefixes_are_frozen_before_later_errors(self):
            with self.composition_edges() as (parent,state):
                parent.validate();state['preStatus']=1;failure=FirstFailure();parent.prepare(failure)
                raw=parent._preparation_original;value=final_json(raw)
                self.assertIsNotNone(value['firstFailure']);self.assertEqual(value['firstFailure'],failure.first)
                self.assertIsNone(value['preGit']);self.assertEqual(base64.b64decode(value['stdout']['base64']),state['preWire'])
                self.assertEqual(value['process'],parent.preparation['process'])
                failure.add(OSError('LATER_RETENTION'),'retention');parent.preparation['streams']['stdout']=b'changed'
                self.assertEqual(parent._preparation_original,raw)
                self.assertNotIn('LATER_RETENTION',[row['message'] for row in value['secondary']])
            with self.preparation_original_edges() as (parent,outside,env,pre,post,state):
                parent._preparation_original=None
                with patch.object(time,'monotonic_ns',return_value=0),self.assertRaisesRegex(ValueError,'capture clock'):
                    parent.freeze_preparation_original(FirstFailure())
                self.assertIsNone(parent._preparation_original)

        def test_preparation_original_emitter_uses_same_individual_aggregate_and_encoded_caps(self):
            for fault in ('individual','aggregate','short','flush'):
                originals={'preparation.phase.json':b'raw original'};lines=[];failure=FirstFailure()
                failure.add(ValueError('FIRST_PHASE'),'preparation')
                if fault=='individual':originals['preparation.phase.json']=b'X'*(JSON_CAP+1)
                elif fault=='aggregate':originals={name:b'X'*JSON_CAP for name in INTERNAL_NAMES};originals['preparation.phase.json']=b'X'
                def emit(line):lines.append(line);return len(line)-1 if fault=='short' else len(line)
                def flush():
                    if fault=='flush':raise OSError('FLUSH_FAILED')
                progress=emit_originals(originals,emit,failure,flush)
                self.assertFalse(progress['complete']);self.assertEqual(failure.first['message'],'FIRST_PHASE');self.assertTrue(failure.secondary)
                self.assertLessEqual(progress['encodedBytes'],8<<20)
                if fault in ('individual','aggregate'):self.assertEqual(lines,[])
            with self.preparation_original_edges() as (parent,outside,env,pre,post,state):
                failure=FirstFailure();lines=[]
                progress=emit_originals({'preparation.phase.json':parent._preparation_original},lambda line:lines.append(line) or len(line),failure,lambda:None)
                self.assertTrue(progress['complete']);self.assertIsNone(failure.first)
                rows=[final_json(line[len(b'RING3_ORIGINAL '):]) for line in lines]
                self.assertTrue(all(len(row['data'])<=3072 for row in rows));self.assertEqual(progress['encodedBytes'],sum(map(len,lines)))
                self.assertEqual(base64.b64decode(''.join(row['data'] for row in rows)),parent._preparation_original)

        def test_preparation_original_failure_emission_only_after_verified_drop_and_first_survives(self):
            for fault in ('none','drop','readback','emit','flush'):
                with self.composition_edges() as (parent,state):
                    parent.validate();parent._preparation_original=b'original failed phase prefix'
                    failure=FirstFailure();failure.add(ValueError('FIRST_PREPARATION'),'preparation');lines=[];attempted=[]
                    if fault=='drop':parent.bootstrap.drop=Mock(side_effect=OSError('DROP_FAILED'))
                    elif fault=='readback':parent.bootstrap.drop=Mock()
                    def emit(raw):attempted.append(raw);entry_ids(1001,1002);lines.append(raw);return len(raw)-1 if fault=='emit' else len(raw)
                    def flush():
                        entry_ids(1001,1002)
                        if fault=='flush':raise OSError('FLUSH_FAILED')
                    with patch.object(sys,'stdout',SimpleNamespace(buffer=SimpleNamespace(write=emit,flush=flush))):
                        result=parent.failure_only(failure)
                    self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'FIRST_PREPARATION')
                    if fault in ('drop','readback'):self.assertEqual(attempted,[]);self.assertEqual(lines,[])
                    else:self.assertTrue(lines);self.assertEqual(parent._preparation_log['complete'],fault=='none')

        def test_finalizer_closed_stage_exact_originals_and_lexical_nineteen_rows(self):
            with self.finalizer_edges() as (outside,env,pre,post,state):
                result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,
                    emit=lambda line:state['log'].append(line) or len(line),flush=lambda:None)
                self.assertTrue(result['pass']);self.assertIsNone(failure.first);self.assertEqual(set(state['export']),PACKET_ROLES)
                audit=final_json(state['export']['audit.json'])
                self.assertEqual(audit['roles'],[{'path':name,'bytes':len(state['export'][name]),'sha256':sha(state['export'][name])}
                    for name in sorted(PACKET_ROLES-{'audit.json'})])
                self.assertEqual(state['export']['js/report.json'],state['data']['js/report.json'])
                self.assertFalse(set(INTERNAL_NAMES)&set(state['export']))
                resources=final_json(state['export']['resources.json'])
                self.assertEqual(resources['controller']['after'],outside['cleanup']['beforeCleanup']['controller'])
                names={final_json(line[len(b'RING3_ORIGINAL '):])['name'] for line in state['log']}
                self.assertEqual(names,set(INTERNAL_NAMES)-{'.entry-failure.json'}|{'git.before.json','git.after.json'})

        def test_finalizer_authoritative_first_survives_missing_facts_and_child_rows(self):
            with self.finalizer_edges() as (outside,env,pre,post,state):
                failure=FirstFailure();failure.add(ValueError('AUTHORITATIVE'),'outside')
                child=final_json(state['data']['.controller.json']);child['firstFailure']={'phase':'child','name':'Fault','message':'ORIGINAL CHILD'}
                state['data']['.controller.json']=encode(child);state['data'].pop('.outside.json')
                result,failure=finalize_packet(outside,failure,pre,env,post_observer=post,emit=lambda line:len(line),flush=lambda:None)
                self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'AUTHORITATIVE')
                self.assertIn('ORIGINAL CHILD',[row['message'] for row in failure.secondary])
                self.assertIn('ObservationLimit',[row['name'] for row in failure.secondary])
                self.assertIn('audit.json',state['export'])

        def test_finalizer_missing_or_retrospective_pre_git_refuses_positive(self):
            for fault in ('missing','late','raw-head'):
                with self.finalizer_edges() as (outside,env,pre,post,state):
                    if fault=='missing':pre=None
                    else:
                        value=final_json(pre)
                        if fault=='late':value['commands'][0]['process']['reapMonoNs']=outside['process']['reapMonoNs']+1
                        else:value['commands'][0]['stdoutHex']=b'wrong\n'.hex()
                        pre=encode(value)
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,emit=lambda line:len(line),flush=lambda:None)
                    self.assertFalse(result['pass']);self.assertIsNotNone(failure.first)

        def test_finalizer_git_typed_source_alias_requires_canonical_json_join(self):
            with self.finalizer_edges() as (outside,env,pre,post,state):
                source=final_json(state['data']['source.before.json'])
                self.assertEqual(check_git_trace(pre,'before',source,outside['process'])['source'],source)
                trace=final_json(pre);trace['source']['files']['LICENSE']['bytes']=float(source['files']['LICENSE']['bytes'])
                # The raw HEAD/tree/tree rows still match. Reencode the complete
                # trace; the compound source join must reject the number alias.
                with self.assertRaises(ValueError):check_git_trace(encode(trace),'before',source,outside['process'])

        def test_finalizer_reencoded_typed_compound_and_pid_aliases_refuse(self):
            for fault in ('source-after','runtime-after','before-pid','controller-pid','guest-parent','guest-process','identity','before-procs','input-refs','js-refs','outside-rusage'):
                with self.finalizer_edges() as (outside,env,pre,post,state):
                    def change(name,callback):
                        value=final_json(state['data'][name]);callback(value);state['data'][name]=encode(value)
                    def number_alias(value):
                        for key,item in value.items():
                            if type(item) is int:value[key]=float(item);return True
                            if type(item) is dict and number_alias(item):return True
                        return False
                    if fault=='source-after':change('source.after.json',lambda v:v['files']['LICENSE'].update(bytes=float(v['files']['LICENSE']['bytes'])))
                    elif fault=='runtime-after':change('runtime.after.json',lambda v:self.assertTrue(number_alias(v)))
                    elif fault=='before-pid':change('.controller.before.json',lambda v:v.update(pid=float(v['pid'])))
                    elif fault=='controller-pid':change('.controller.json',lambda v:v.update(pid=float(v['pid'])))
                    elif fault=='guest-parent':
                        change('js/process.json',lambda v:v.update(parentPid=float(v['parentPid'])))
                        change('.controller.json',lambda v:v['processes'].update(js=final_json(state['data']['js/process.json'])))
                    elif fault=='guest-process':change('.controller.json',lambda v:v['processes']['js'].update(startTicks=float(v['processes']['js']['startTicks'])))
                    elif fault=='identity':change('.entry.json',lambda v:v['cgroups']['controller']['identity'].update(inode=float(v['cgroups']['controller']['identity']['inode'])))
                    elif fault=='before-procs':
                        change('.controller.before.json',lambda v:v['before']['controller'].update(procs=[101.0]))
                        change('.controller.json',lambda v:v.update(before=final_json(state['data']['.controller.before.json'])['before']))
                    elif fault=='input-refs':
                        change('.controller.json',lambda v:[v[key]['fixture.rom'].update(bytes=float(v[key]['fixture.rom']['bytes'])) for key in ('inputsBefore','barrierInputs','inputsAfter')])
                    elif fault=='js-refs':change('.controller.json',lambda v:v['jsOriginals']['report.json'].update(bytes=float(v['jsOriginals']['report.json']['bytes'])))
                    elif fault=='outside-rusage':change('.outside.json',lambda v:v['process']['rusage'].update(maxRssKiB=float(v['process']['rusage']['maxRssKiB'])))
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,emit=lambda line:len(line),flush=lambda:None)
                    self.assertFalse(result['pass'],fault);self.assertNotIn('resources.json',state['export'],fault)
                    self.assertIsNotNone(failure.first,fault)

        def test_finalizer_reencoded_guest_intervals_require_controller_containment(self):
            for fault in ('outer-reap','js-before-parent','qemu-before-js','reversed','float','guest-over-cap'):
                with self.finalizer_edges() as (outside,env,pre,post,state):
                    def change_guest(role,callback):
                        guest=final_json(state['data'][role+'/process.json']);callback(guest)
                        state['data'][role+'/process.json']=encode(guest)
                        controller=final_json(state['data']['.controller.json']);controller['processes'][role]=guest
                        state['data']['.controller.json']=encode(controller)
                    if fault=='outer-reap':outside['process']['reapMonoNs']=outside['process']['spawnMonoNs']+1
                    elif fault=='js-before-parent':change_guest('js',lambda g:g.update(spawnMonoNs=outside['process']['spawnMonoNs']-1))
                    elif fault=='qemu-before-js':change_guest('qemu',lambda g:g.update(spawnMonoNs=final_json(state['data']['js/process.json'])['reapMonoNs']-1))
                    elif fault=='reversed':change_guest('js',lambda g:g.update(spawnMonoNs=g['reapMonoNs']+1))
                    elif fault=='float':change_guest('js',lambda g:g.update(spawnMonoNs=float(g['spawnMonoNs'])))
                    else:
                        change_guest('qemu',lambda g:g.update(reapMonoNs=g['spawnMonoNs']+CHILD_NS+1))
                        outside['process']['reapMonoNs']=final_json(state['data']['qemu/process.json'])['reapMonoNs']
                        trace=final_json(post.capture.return_value[0])
                        for index,row in enumerate(trace['commands']):
                            start=outside['process']['reapMonoNs']+index*100+1
                            row['process'].update(spawnMonoNs=start,reapMonoNs=start+1)
                        post.capture.return_value=(encode(trace),FirstFailure())
                    original=final_json(state['data']['.outside.json']);original['process']=outside['process']
                    state['data']['.outside.json']=encode(original)
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,emit=lambda line:len(line),flush=lambda:None)
                    self.assertFalse(result['pass'],fault);self.assertNotIn('resources.json',state['export'],fault)
                    self.assertIsNotNone(failure.first,fault)

        def test_finalizer_cleanup_or_wrong_controller_join_never_yields_resources(self):
            for fault in ('cleanup','before','pid'):
                with self.finalizer_edges() as (outside,env,pre,post,state):
                    if fault=='cleanup':outside['cleanup']['cgroupKillAttempted']=True
                    elif fault=='before':outside['cleanup']['beforeCleanup']['controller']['procs']=[101]
                    else:outside['process']['pid']=999
                    state['data']['.outside.json']=encode(dict(outside,firstFailure=None,secondary=[],streamsHex={'stdout':'','stderr':''}))
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,emit=lambda line:len(line),flush=lambda:None)
                    self.assertFalse(result['pass']);self.assertNotIn('resources.json',state['export'])

        def test_finalizer_tree_refusal_still_reads_only_known_originals_logs_and_failure_stage(self):
            for fault in ('unknown','stale','symlink'):
                with self.finalizer_edges() as (outside,env,pre,post,state):
                    if fault=='unknown':state['data']['unknown.bin']=b'NEVER READ'
                    elif fault=='stale':state['data']['audit.json']=b'STALE ORIGINAL'
                    else:state['symlinks'].add(str(PACKET/'js/stdout'))
                    result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,
                        emit=lambda line:state['log'].append(line) or len(line),flush=lambda:None)
                    self.assertFalse(result['pass']);self.assertEqual(failure.first['phase'],'finalizer-tree')
                    self.assertNotIn('unknown.bin',state['reads']);self.assertTrue(state['log']);self.assertIn('audit.json',state['export'])
                    if fault=='symlink':self.assertNotIn('js/stdout',state['reads'])

        def test_finalizer_stage_failure_keeps_original_primary_and_other_available_roles(self):
            with self.finalizer_edges() as (outside,env,pre,post,state):
                failure=FirstFailure();failure.add(ValueError('FIRST'),'outside')
                original=globals()['write_new']
                def write(path,raw,cap):
                    if Path(path).name=='stdout':raise OSError('STAGE')
                    original(path,raw,cap)
                with patch.dict(globals(),write_new=write):
                    result,failure=finalize_packet(outside,failure,pre,env,post_observer=post,emit=lambda line:len(line),flush=lambda:None)
                self.assertEqual(failure.first['message'],'FIRST');self.assertFalse(result['pass'])
                self.assertIn('audit.json',state['export']);self.assertIn('js/stderr',state['export'])

        def test_log_original_chunking_exact_roundtrip_and_flush_before_complete(self):
            originals={'.entry.json':b'A'*10000,'git.before.json':b'RAW'};lines=[];failure=FirstFailure();flushed=[]
            progress=emit_originals(originals,lambda line:lines.append(line) or len(line),failure,lambda:flushed.append(True))
            self.assertTrue(progress['complete']);self.assertEqual(flushed,[True]);self.assertIsNone(failure.first)
            reconstructed={}
            for line in lines:
                value=final_json(line[len(b'RING3_ORIGINAL '):]);self.assertLessEqual(len(value['data']),3072)
                reconstructed.setdefault(value['name'],'');reconstructed[value['name']]+=value['data']
            self.assertEqual({name:base64.b64decode(value,validate=True) for name,value in reconstructed.items()},originals)
            self.assertEqual(progress['encodedBytes'],sum(map(len,lines)))

        def test_log_short_write_flush_and_caps_preserve_first_no_complete_claim(self):
            for fault in ('short','flush','aggregate','individual'):
                failure=FirstFailure();failure.add(ValueError('FIRST'),'outside');flushed=[]
                originals={'.entry.json':b'A'}
                if fault=='aggregate':originals={name:b'A'*(1<<20) for name in INTERNAL_NAMES};originals['git.before.json']=b'X'
                if fault=='individual':originals={'git.before.json':b'A'*(GIT_TRACE_CAP+1)}
                def flush():
                    flushed.append(True)
                    if fault=='flush':raise OSError('FLUSH')
                progress=emit_originals(originals,lambda line:len(line)-1 if fault=='short' else len(line),failure,flush)
                self.assertFalse(progress['complete']);self.assertEqual(failure.first['message'],'FIRST');self.assertTrue(failure.secondary);self.assertEqual(flushed,[True])

        def test_finalizer_flush_error_keeps_failure_audit_and_source_originals(self):
            with self.finalizer_edges() as (outside,env,pre,post,state):
                before=dict(state['data'])
                def flush():raise OSError('FLUSH')
                result,failure=finalize_packet(outside,FirstFailure(),pre,env,post_observer=post,emit=lambda line:len(line),flush=flush)
                self.assertFalse(result['pass']);self.assertEqual(failure.first['message'],'FLUSH');self.assertFalse(result['log']['complete'])
                self.assertEqual(state['data'],before);self.assertEqual(final_json(state['export']['audit.json'])['firstFailure'],failure.first)

        def test_outside_git_actual_fixed_callback_three_originals_and_no_arbitrary_command(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                source=state['source'];listing=''.join(source['files'][name]['mode']+' blob '+source['files'][name]['blob']+'\t'+name+'\n' for name in sorted(SOURCE_PATHS)).encode()
                outputs=[(source['head']+'\n').encode(),(source['tree']+'\n').encode(),listing];created=[]
                def factory(argv):
                    created.append(argv);return Fake([[('stdout',outputs[len(created)-1])]],status())
                with patch.dict(globals(),outside_unprivileged=lambda env:(1001,1002)):
                    observer=GitObservation(state['env'],'after',factory);raw,failure=observer.capture('a'*40)
                    self.assertIsNone(failure.first);trace=final_json(raw);self.assertEqual(len(trace['commands']),3)
                    self.assertEqual(trace['source'],source);self.assertTrue(all(argv[0]=='/usr/bin/git' for argv in created))
                    with self.assertRaises(ValueError):observer.command(['git','fetch'],100)
                    self.assertEqual(len(created),3)

        @contextlib.contextmanager
        def controller_edges(self,fail_probe=None):
            with self.entry_edges() as (entry,state):
                state.update(uids=(1001,)*3,gids=(1002,)*3,groups=[],migrated=True)
                state['inputs']={'fixture.rom':b'R'*65536,'fixture.json':encode({'authored':'inert input'})}
                state['rawJs']={'report.json':encode({'schema':'bw.ring3.js-probe.v1','firstFailure':None}),
                    'observations.json':b'[]\n','writes.json':b'[]\n',
                    'memory.before.bin':bytes(1<<20),'memory.after.bin':bytes(1<<20)}
                state.update(writes=[],factories=[],mode={},readCalls=[])
                files,probe,calls=self.discovery_edges(fail_role=fail_probe)
                plan=RuntimeDiscovery(files,probe)
                old_observe=Cgroups.observe
                def observe(groups,role):
                    value=old_observe(groups,role)
                    if role=='enclosing':value['raw'].update(pidsCurrent='1\n',cgroupEvents='populated 1\nfrozen 0\n')
                    return value
                directories={'/checkout','/checkout/build','/checkout/build/i80386-ring3-int-iret',
                    *('/checkout/build/i80386-ring3-int-iret/'+name for name in ('inputs','js','qemu'))}
                def read(path,cap,*,with_mode=False):
                    name=str(path);state['readCalls'].append((name,with_mode))
                    if Path(path)==ENTRY_FILE:data=encode(state['owner'])
                    elif Path(path)==PACKET/'source.before.json':data=encode(state['source'])
                    elif name in state['sourceData']:data=state['sourceData'][name]
                    elif Path(path).parent==PACKET/'inputs':data=state['inputs'][Path(path).name]
                    elif Path(path).parent==PACKET/'js':data=state['rawJs'][Path(path).name]
                    else:raise FileNotFoundError('inert missing role '+name)
                    need(len(data)<=cap,'inert observed role cap')
                    return (data,state['mode'].get(name,'100644')) if with_mode else data
                def write(path,data,cap):
                    need(len(data)<=cap,'actual retained encoding cap');state['writes'].append((str(path),data))
                ops=ControllerOps(state['env'])
                def factory(groups,role,argv):
                    state['factories'].append(role)
                    state['barrierWritesAtFactory']=[path for path,data in state['writes']]
                    fake=Fake([[('stdout',role.encode()+b'-opaque')]],status(0 if role=='js' else 1));return fake
                ops.child_factory=factory
                with patch.object(Path,'lstat',lambda path:SimpleNamespace(st_mode=0o40755 if str(path) in directories else 0o100644,st_uid=1001,st_gid=1002)),\
                     patch.object(Cgroups,'observe',observe),patch.dict(globals(),bounded_read=read,write_new=write,
                        ROM_SHA=sha(state['inputs']['fixture.rom']),FIXTURE_JSON_SHA=sha(encode(entry_json(state['inputs']['fixture.json']))[:-1]),
                        controller_runtime_discovery=lambda groups:plan),\
                     patch.object(RuntimeFiles,'read',lambda self,path,cap:files.read(path,cap)),\
                     patch.object(RuntimeFiles,'alias',lambda self,path:files.alias(path)),\
                     patch.object(subprocess,'Popen',side_effect=AssertionError('no real process in inert controller controls')):
                    yield ops,state,plan,files,calls

        def test_controller_actual_serial_glue_barrier_and_raw_originals(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                original=dict(state['rawJs']);_,failure=controller_execute(ops)
                self.assertIsNone(failure.first);self.assertEqual(state['factories'],['js','qemu']);self.assertEqual(len(calls),11)
                self.assertEqual(state['rawJs'],original);self.assertEqual(ops.raw_js,original)
                paths=[name for name,data in state['writes']]
                self.assertNotIn(str(PACKET/'source.before.json'),paths)
                self.assertFalse(any(str(PACKET/'js'/name) in paths for name in ControllerOps.JS_FILES))
                self.assertIn(str(PACKET/'runtime.before.json'),state['barrierWritesAtFactory'])
                self.assertIn(str(PACKET/'.controller.before.json'),state['barrierWritesAtFactory'])
                self.assertIn(str(PACKET/'source.after.json'),paths);self.assertIn(str(PACKET/'runtime.after.json'),paths)
                self.assertEqual(ops.before['controller']['procs'],[101]);self.assertEqual(ops.before['enclosing']['procs'],[])
                self.assertEqual(set(path for path,mode in state['readCalls'] if mode),SOURCE_PATHS)
                self.assertEqual(set(path for path,cap in files.reads[-len(plan.files):]),set(plan.files))
                qreport=entry_json(dict(state['writes'])[str(PACKET/'qemu/report.json')])
                self.assertEqual(qreport['outputSha256'],sha(b'qemu-opaque'));self.assertIsNone(qreport['firstFailure'])

        def test_controller_descriptor_fixed_fields_and_unknown_role_refusal(self):
            runtime={'executables':{'node':{'path':'/node'},'qemu':{'path':'/qemu'}}}
            js=guest_argv('js',runtime);self.assertEqual(js,['/node','--input-type=module','--eval',JS_DRIVER])
            self.assertIn("{flag:'wx'}",JS_DRIVER);self.assertNotIn('createCPU',JS_DRIVER)
            qemu=guest_argv('qemu',runtime)
            self.assertEqual(qemu[:11],['/qemu','-no-user-config','-nodefaults','-machine','pc','-accel','tcg','-cpu','486','-m','16M'])
            self.assertIn('isa-debug-exit,iobase=0xf4,iosize=0x04',qemu);self.assertEqual(qemu[-2:],['-no-reboot','-no-shutdown'])
            with self.assertRaises(ValueError):guest_argv('arbitrary',runtime)

        def test_controller_barrier_failure_prevents_every_guest_factory_and_still_reads_after(self):
            for fault in ('source','input','retention','census'):
                with self.controller_edges() as (ops,state,plan,files,calls):
                    ops.admit();ops.discover()
                    if fault=='source':state['mode'][RUN_FILE]='100755'
                    elif fault=='input':state['inputs']['fixture.rom']=b'X'*65536
                    elif fault=='census':state['snapshots']['js']['procs']=[999]
                    original_write=globals()['write_new']
                    def write(path,data,cap):
                        if fault=='retention' and path==PACKET/'runtime.before.json':raise OSError('BARRIER WRITE')
                        original_write(path,data,cap)
                    with patch.dict(globals(),write_new=write):
                        with self.assertRaises(ObservedFailure):ops.barrier()
                        failure=FirstFailure();failure.add(ValueError('FIRST'),'held');ops.after_all(failure)
                    self.assertEqual(state['factories'],[]);self.assertEqual(failure.first['message'],'FIRST')
                    self.assertEqual(set(ops.source_after['files']),SOURCE_PATHS);self.assertEqual(set(ops.inputs_after),{'fixture.rom','fixture.json'})
                    self.assertEqual(set(ops.runtime_after['qemuPackage']['files']),set(plan.files))

        def test_controller_js_process_failure_stops_qemu_but_all_after_reads_continue(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                def factory(groups,role,argv):
                    state['factories'].append(role);return Fake([[('stdout',b'partial')]],status(1))
                ops.child_factory=factory;_,failure=controller_execute(ops)
                self.assertEqual(state['factories'],['js']);self.assertEqual(failure.first['phase'],'js-terminal')
                self.assertEqual(ops.streams['js']['stdout'],b'partial');self.assertEqual(len(calls),11)
                self.assertIsNotNone(ops.source_after);self.assertIsNotNone(ops.runtime_after);self.assertEqual(len(ops.inputs_after),2)

        def test_controller_probe_failure_rereads_every_partial_runtime_key_without_reprobe(self):
            with self.controller_edges(fail_probe='ldd-qemu') as (ops,state,plan,files,calls):
                _,failure=controller_execute(ops)
                self.assertEqual(failure.first['message'],'ORIGINAL_PROBE_FAILURE');self.assertEqual(state['factories'],[])
                self.assertIsNone(ops.runtime_before);self.assertEqual(set(ops.runtime_after['files']),set(plan.files))
                self.assertEqual([role for role,argv in calls].count('ldd-qemu'),1)
                self.assertIsNotNone(ops.source_after);self.assertEqual(len(ops.inputs_after),2)

        def test_controller_process_encoding_failure_still_attempts_both_streams_and_js_reads(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                process={'bad':object()}
                with self.assertRaises(ObservedFailure) as caught:ops.retain_guest('js',process,{'stdout':b'RAW','stderr':b'ERR'})
                self.assertEqual(caught.exception.firstFailure['name'],'TypeError')
                saved=dict(state['writes']);self.assertEqual(saved[str(PACKET/'js/stdout')],b'RAW');self.assertEqual(saved[str(PACKET/'js/stderr')],b'ERR')
                self.assertEqual(set(ops.raw_js),set(ControllerOps.JS_FILES))

        def test_controller_original_report_refusal_stops_next_guest_without_synthetic_js_files(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                primary={'phase':'original-probe','name':'Fault','message':'ORIGINAL'}
                state['rawJs']['report.json']=encode({'schema':'bw.ring3.js-probe.v1','firstFailure':primary})
                _,failure=controller_execute(ops)
                self.assertEqual(failure.first,primary);self.assertEqual(state['factories'],['js'])
                self.assertEqual(ops.raw_js['report.json'],state['rawJs']['report.json'])

        def test_controller_retention_failure_stops_qemu_and_after_failures_keep_exact_first(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                original=globals()['write_new']
                def write(path,data,cap):
                    if path==PACKET/'js/process.json':raise OSError('FIRST RETENTION')
                    if path==PACKET/'source.after.json':raise OSError('AFTER RETENTION')
                    original(path,data,cap)
                with patch.dict(globals(),write_new=write):_,failure=controller_execute(ops)
                self.assertEqual(failure.first['message'],'FIRST RETENTION');self.assertEqual(state['factories'],['js'])
                self.assertIsNotNone(ops.source_after);self.assertIsNotNone(ops.runtime_after);self.assertEqual(len(ops.inputs_after),2)
                self.assertIn('AFTER RETENTION',[x['message'] for x in failure.secondary])

        def test_source_facts_all_twelve_reads_retain_mode_drift_and_individual_errors(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                seen=[]
                def read(path):
                    seen.append(path)
                    if path==RUN_FILE:raise OSError('FIRST SOURCE')
                    return state['sourceData'][path],'100755'
                observed,failure=source_facts(state['source'],read)
                self.assertEqual(set(seen),SOURCE_PATHS);self.assertEqual(len(seen),12)
                self.assertEqual(failure.first['message'],'FIRST SOURCE');self.assertEqual(observed['files'][RUN_FILE]['firstFailure']['message'],'FIRST SOURCE')
                self.assertTrue(all(row['mode']=='100755' for path,row in observed['files'].items() if path!=RUN_FILE))

        def test_input_readback_attempts_both_and_retains_actual_drift(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                before,first=input_facts();self.assertIsNone(first.first);seen=[]
                def read(path,cap):
                    seen.append(Path(path).name)
                    if Path(path).name=='fixture.rom':raise OSError('FIRST INPUT')
                    return state['inputs'][Path(path).name]
                after,failure=input_facts(before,read)
                self.assertEqual(seen,['fixture.rom','fixture.json']);self.assertEqual(failure.first['message'],'FIRST INPUT')
                self.assertEqual(after,{'fixture.json':state['inputs']['fixture.json']})

        def test_controller_after_all_attempts_inputs_runtime_despite_source_file_faults(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                ops.admit();ops.discover();before=dict(state['inputs']);state['inputs']['fixture.json']=b'{}'
                files_before=len(files.reads)
                def read(path):raise OSError('SOURCE AFTER')
                original_source=globals()['source_facts']
                with patch.dict(globals(),source_facts=lambda template:original_source(template,read)):
                    failure=FirstFailure();failure.add(ValueError('FIRST GUEST'),'guest');ops.after_all(failure)
                self.assertEqual(failure.first['message'],'FIRST GUEST');self.assertEqual(ops.inputs_after['fixture.json'],b'{}')
                self.assertEqual(set(path for path,cap in files.reads[files_before:]),set(plan.files))
                self.assertEqual(set(ops.source_after['files']),SOURCE_PATHS)

        def test_controller_wrapper_after_and_retention_faults_never_replace_execution_first(self):
            ops=Mock();ops.admit.side_effect=ValueError('FIRST');ops.after_all.side_effect=OSError('AFTER');ops.retain_control.side_effect=OSError('RETAIN')
            _,failure=controller_execute(ops)
            self.assertEqual(failure.first['message'],'FIRST');self.assertEqual([x['message'] for x in failure.secondary],['AFTER','RETAIN'])
            ops.after_all.assert_called_once();ops.retain_control.assert_called_once();ops.discover.assert_not_called()

        def test_actual_source_fd_mode_readback_and_mode_change_refusal(self):
            for mode in (0o100644,0o100755):
                first=SimpleNamespace(st_mode=mode,st_dev=1,st_ino=2,st_size=3,st_mtime_ns=4)
                for changed in (False,True):
                    after=SimpleNamespace(**vars(first));after.st_mode=mode^0o111 if changed else mode
                    with patch.object(os,'open',return_value=7),patch.object(os,'fstat',side_effect=[first,after]),\
                         patch.object(os,'read',side_effect=[b'abc',b'']),patch.object(os,'close'):
                        if changed:
                            with self.assertRaisesRegex(ValueError,'stable source mode'):bounded_read('/fixed',3,with_mode=True)
                        else:self.assertEqual(bounded_read('/fixed',3,with_mode=True),(b'abc','100755' if mode&0o111 else '100644'))

        def test_controller_after_combined_source_input_alias_drift_retains_all_observations(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                ops.admit();ops.discover();ops.barrier()
                state['mode'][RUN_FILE]='100755';state['inputs']['fixture.rom']=b'X'*65536
                files.aliases['/lib']={'linkText':'wrong','target':'/changed'}
                failure=FirstFailure();failure.add(ValueError('FIRST GUEST'),'guest');ops.after_all(failure)
                self.assertEqual(failure.first['message'],'FIRST GUEST')
                self.assertEqual(ops.source_after['files'][RUN_FILE]['mode'],'100755')
                self.assertEqual(ops.inputs_after['fixture.rom'],b'X'*65536)
                self.assertEqual(ops.runtime_after['qemuPackage']['aliases']['/lib']['target'],'/changed')
                self.assertEqual(len(calls),11)

        def test_controller_terminal_leaf_refusal_prevents_next_guest(self):
            with self.controller_edges() as (ops,state,plan,files,calls):
                def factory(groups,role,argv):
                    state['factories'].append(role);fake=Fake(terminal=status())
                    def reap():state['snapshots']['js']['procs']=[999];return status()
                    fake.reap=reap;return fake
                ops.child_factory=factory;_,failure=controller_execute(ops)
                self.assertEqual(state['factories'],['js']);self.assertEqual(failure.first['phase'],'js-terminal-census')
                self.assertEqual(ops.last_census['js']['procs'],[999]);self.assertIsNotNone(ops.source_after)

        @contextlib.contextmanager
        def outside_edges(self):
            ids={name:{'device':3,'inode':index+1} for index,name in enumerate(('enclosing','controller','js','qemu'))}
            state={'empty':True,'events':[],'membership':'0::/actions/job\n','t':0,'saved':[],'drift':None}
            bootstrap=Mock(invoker={'uid':1001,'gid':1002})
            bootstrap.environ={'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1','BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40}
            bootstrap.owner={'python':{'path':'/usr/bin/python3.12'},'cgroups':{k:{'identity':v} for k,v in ids.items()}}
            bootstrap.groups.root=Path('/sys/fs/cgroup/bw-ring3-123-1');bootstrap.groups.identities=ids
            bootstrap.groups.path.side_effect=lambda role:bootstrap.groups.root if role=='enclosing' else bootstrap.groups.root/role
            def observe(role):
                state['events'].append(('observe',role));populated=not state['empty'] and role in ('enclosing','controller')
                identity=dict(ids[role])
                if state['drift']==role:identity['inode']=99
                return {'identity':identity,'limits':dict(LIMITS),'procs':[101] if populated and role=='controller' else [],
                    'raw':{'pidsCurrent':str(int(populated)),'cgroupEvents':'populated '+str(int(populated))+'\nfrozen 0\n',
                        'cpuStat':'usage_usec 0\n','memoryEvents':'oom 0\n','memoryCurrent':'0\n','memoryPeak':'0\n'}}
            bootstrap.groups.observe.side_effect=observe
            bootstrap.drop.side_effect=lambda:state['events'].append(('drop',))
            owner=OutsideOwner(bootstrap);owner.admitted=True;owner.child=Mock(process=Mock(pid=101,returncode=0))
            owner.child.reap.return_value=None
            def clock():state['t']+=100000000;return state['t']
            owner.now=clock;owner.pause=Mock()
            def opened(path,flags,**kwargs):
                state['events'].append(('open',str(path),kwargs));return 8 if 'dir_fd' in kwargs else 7
            def write(fd,data):state['events'].append(('kill-write',fd,data));state['empty']=True;return len(data)
            with contextlib.ExitStack() as stack:
                patches=[patch.dict(globals(),entry_proc=lambda path:state['membership']),
                    patch.dict(globals(),entry_ids=lambda *ids:state['events'].append(('ids',ids))),
                    patch.dict(globals(),write_new=lambda path,data,cap:state['saved'].append((path,json.loads(data)))),
                    patch.object(os,'getpid',return_value=100),patch.object(os,'open',side_effect=opened),
                    patch.object(os,'write',side_effect=write),patch.object(os,'close'),
                    patch.object(os,'fstat',return_value=SimpleNamespace(st_mode=0o40755,st_dev=3,st_ino=1,st_uid=1001,st_gid=1002)),
                    patch.object(sys,'stderr',Mock(buffer=io.BytesIO()))]
                for item in patches:stack.enter_context(item)
                yield owner,state

        def test_all_profiles_late_terminal_refuses_without_signalling_reaped_pid(self):
            for profile,role,budget in (('guest','js',CHILD_NS),('discovery','discovery',10000000000),('controller','controller',600000000000)):
                ops=Fake(terminal=status(),now_step=budget+1)
                process,_=collect_child(ops,role,['owned'],profile=profile)
                self.assertTrue(process['timedOut']);self.assertIn('wall bound',process['firstFailure']['message'])
                self.assertEqual(process['exitCode'],0);self.assertEqual(process['waitStatus'],0)
                self.assertNotIn('kill',ops.calls)
                exact,_=collect_child(Fake(terminal=status(),now_step=budget),role,['owned'],profile=profile)
                self.assertFalse(exact['timedOut']);self.assertIsNone(exact['firstFailure'])

        def test_controller_profile_caps_timeout_and_unknowns(self):
            ops=Fake([[('stderr',b'x'*16385)]],status())
            process,streams=collect_child(ops,'controller',['owned'],profile='controller')
            self.assertEqual(streams['stderr'],b'x'*16384);self.assertIn('stderr byte cap',process['firstFailure']['message'])
            timed=Fake(now_step=600000000000)
            process,_=collect_child(timed,'controller',['owned'],profile='controller')
            self.assertTrue(process['timedOut']);self.assertIsNone(process['exitCode']);self.assertIsNone(process['waitStatus'])
            self.assertEqual(timed.calls.count('kill'),1);self.assertLess(len(timed.calls),15)

        def test_outside_fixed_child_descriptor_environment_and_no_migration_preexec(self):
            with self.outside_edges() as (owner,state):
                owner.validate();child=owner.create_child()
                self.assertEqual(child.argv,['/usr/bin/python3.12','-I','-B',RUN_FILE,'--bootstrap'])
                self.assertEqual(child.environment,dict(ENV,**owner.bootstrap.environ,SUDO_UID='1001',SUDO_GID='1002'))
                stat_text='101 (held) '+' '.join(['0']*19+['123'])
                with patch.object(Cgroups,'text',return_value=stat_text),patch.object(resource,'setrlimit') as limits,\
                     patch.object(os,'getpid',return_value=101),patch.object(os,'getpgrp',return_value=101),\
                     patch.object(os,'write',return_value=24) as write:
                    child.preexec(9)
                    self.assertEqual(struct.unpack('<QQQ',write.call_args.args[1]),(101,101,123));self.assertEqual(limits.call_count,3)
                owner.bootstrap.groups.move_child.assert_not_called();owner.bootstrap.enter.assert_not_called()

        def test_outside_actual_spawn_wait_policy_and_closed_environment(self):
            with self.outside_edges() as (owner,state):
                child=owner.create_child();events=[]
                stdout,stderr,selector=Mock(),Mock(),Mock();stdout.fileno.return_value=10;stderr.fileno.return_value=11
                process=Mock(pid=101,stdout=stdout,stderr=stderr)
                def create(*args,**kwargs):events.append('spawn');return process
                with patch.object(signal,'signal',side_effect=lambda *a:events.append('reset')) as reset,\
                     patch.object(signal,'getsignal'),patch.object(subprocess,'Popen',side_effect=create) as popen,\
                     patch.object(os,'pipe2',return_value=(7,8)),patch.object(os,'read',return_value=struct.pack('<QQQ',101,101,123)),\
                     patch.object(os,'set_blocking'),patch.object(selectors,'DefaultSelector',return_value=selector):
                    identity=child.spawn();child.close()
                    self.assertEqual(identity,{'pid':101,'pgid':101,'parentPid':100,'startTicks':123})
                    self.assertEqual(events,['reset','spawn']);reset.assert_called_once_with(signal.SIGCHLD,signal.SIG_DFL)
                    self.assertEqual(popen.call_args.kwargs['env'],child.environment)
                    self.assertTrue(popen.call_args.kwargs['start_new_session']);self.assertTrue(popen.call_args.kwargs['close_fds'])
                with patch.object(signal,'signal',side_effect=ValueError('RESET')),patch.object(subprocess,'Popen') as popen:
                    with self.assertRaisesRegex(ValueError,'RESET'):child.spawn()
                    popen.assert_not_called()

        def test_outside_natural_terminal_observations_then_drop_before_retention(self):
            with self.outside_edges() as (owner,state):
                facts,failure=owner.finish({'waitStatus':0})
                self.assertIsNone(failure.first);self.assertFalse(facts['sessionSignalAttempted']);self.assertFalse(facts['cgroupKillAttempted'])
                self.assertEqual(facts['polls'],1);owner.child.kill.assert_not_called();owner.child.reap.assert_not_called()
                self.assertEqual(len([e for e in state['events'] if e[0]=='observe']),8)
                owner.retain(failure,{'cleanup':facts},{'stdout':b'original','stderr':b''})
                self.assertEqual(state['events'][-2:],[('drop',),('ids',(1001,1002))])
                self.assertEqual(state['saved'][0][0],PACKET/'.outside.json')
                self.assertEqual(state['saved'][0][1]['streamsHex']['stdout'],b'original'.hex())

        def test_outside_precleanup_defect_survives_successful_empty_cleanup(self):
            with self.outside_edges() as (owner,state):
                state['empty']=False
                facts,failure=owner.finish({'waitStatus':0})
                self.assertEqual(failure.first['phase'],'outside-precleanup-census')
                self.assertTrue(facts['cgroupKillAttempted']);self.assertFalse(facts['sessionSignalAttempted'])
                self.assertEqual(facts['beforeCleanup']['controller']['procs'],[101])
                self.assertEqual(facts['afterCleanup']['controller']['procs'],[])
                owner.child.kill.assert_not_called()  # Reaped leader cannot be signalled even with descendants.

        def test_outside_live_session_cleanup_preserves_unknown_terminal_failure(self):
            with self.outside_edges() as (owner,state):
                owner.child.process.returncode=None;owner.child.reap.return_value=status()
                facts,failure=owner.finish({'waitStatus':None})
                self.assertEqual(failure.first['phase'],'outside-terminal');owner.child.kill.assert_called_once()
                self.assertTrue(facts['sessionSignalAttempted']);self.assertEqual(facts['cleanupTerminal']['waitStatus'],0)

        def test_outside_recorded_reap_prevents_session_signal_even_with_stale_popen_field(self):
            with self.outside_edges() as (owner,state):
                owner.child.process.returncode=None
                facts,failure=owner.finish({'waitStatus':0})
                owner.child.kill.assert_not_called();owner.child.reap.assert_not_called()
                self.assertFalse(facts['sessionSignalAttempted'])

        def test_outside_membership_blocks_creation_and_enclosing_kill(self):
            with self.outside_edges() as (owner,state):
                state['membership']='0::/bw-ring3-123-1/controller\n'
                with self.assertRaisesRegex(ValueError,'remain outside'):owner.create_child()
                with patch.object(os,'open') as opened:
                    with self.assertRaisesRegex(ValueError,'remain outside'):owner.kill_enclosing()
                    opened.assert_not_called()

        def test_outside_enclosing_write_anchors_held_directory_and_refuses_identity_drift(self):
            with self.outside_edges() as (owner,state):
                owner.kill_enclosing()
                self.assertEqual(state['events'][-2:], [('open','cgroup.kill',{'dir_fd':7}),('kill-write',8,b'1')])
                for info in (SimpleNamespace(st_mode=0o40755,st_dev=3,st_ino=99,st_uid=1001,st_gid=1002),
                             SimpleNamespace(st_mode=0o40755,st_dev=3,st_ino=1,st_uid=999,st_gid=1002)):
                    with patch.object(os,'fstat',return_value=info),patch.object(os,'write') as write:
                        with self.assertRaisesRegex(ValueError,'held enclosing directory'):owner.kill_enclosing()
                        write.assert_not_called()

        def test_outside_enclosing_open_write_close_failures_preserve_original(self):
            for edge in ('openat','write'):
                with self.outside_edges() as (owner,state):
                    first=OSError('FIRST-'+edge)
                    def opened(path,flags,**kwargs):
                        if kwargs and edge=='openat':raise first
                        return 8 if kwargs else 7
                    with patch.object(os,'open',side_effect=opened),patch.object(os,'write',side_effect=first),\
                         patch.object(os,'close',side_effect=OSError('CLOSE')) as close:
                        with self.assertRaises(OSError) as caught:owner.kill_enclosing()
                        self.assertIs(caught.exception,first);self.assertTrue(first.ring3_secondary)
                        self.assertEqual(close.call_count,1 if edge=='openat' else 2)

        def test_outside_cleanup_clock_and_iteration_bounds_keep_uncertainty(self):
            with self.outside_edges() as (owner,state):
                state['empty']=False;owner.kill_enclosing=Mock(side_effect=OSError('KILL'))
                owner.now=lambda:0
                facts,failure=owner.finish({'waitStatus':None})
                self.assertEqual(facts['polls'],128);self.assertIsNotNone(failure.first)
                self.assertTrue(any(x['phase']=='outside-cleanup' for x in failure.secondary))

        def test_outside_wrapper_preserves_collector_primary_through_finish_and_retention(self):
            child=Fake(spawn_error=ValueError('FIRST'),terminal=status());child.argv=['owned']
            ops=Mock();ops.create_child.return_value=child;ops.finish.side_effect=OSError('CENSUS');ops.retain.side_effect=OSError('RETAIN')
            facts,failure=outside_controller(ops)
            self.assertEqual(failure.first['message'],'FIRST')
            self.assertEqual([x['message'] for x in failure.secondary],['CENSUS','RETAIN'])
            ops.finish.assert_called_once();ops.retain.assert_called_once();self.assertEqual(facts['process']['waitStatus'],0)

        def test_outside_wrapper_unconditionally_finishes_after_validation_failure(self):
            with self.outside_edges() as (owner,state):
                owner.admitted=False;owner.bootstrap.validate.side_effect=ValueError('FIRST')
                facts,failure=outside_controller(owner)
                self.assertEqual(failure.first['message'],'FIRST')
                self.assertEqual(failure.secondary[0]['phase'],'outside-ownership')
                owner.bootstrap.drop.assert_called_once();self.assertEqual(state['events'],[('drop',),('ids',(1001,1002))])

        def test_outside_interrupted_finish_retains_earlier_defect_and_partial_facts(self):
            with self.outside_edges() as (owner,state):
                state['empty']=False
                child=Fake(terminal=status());child.argv=['owned'];child.process=Mock(pid=101,returncode=0)
                owner.create_child=Mock(return_value=child);owner.child=child
                owner.now=Mock(side_effect=OSError('CLOCK'))
                facts,failure=outside_controller(owner)
                self.assertEqual(failure.first['phase'],'outside-precleanup-census')
                self.assertEqual(failure.secondary[-1]['message'],'CLOCK')
                self.assertEqual(facts['cleanup']['beforeCleanup']['controller']['procs'],[101])
                self.assertTrue(facts['cleanup']['cgroupKillAttempted']);self.assertIsNone(facts['cleanup']['afterCleanup'])

        def test_outside_drop_or_retention_failure_preserves_original_and_no_root_write(self):
            for edge in ('drop','write'):
                with self.outside_edges() as (owner,state):
                    failure=FirstFailure();failure.add(ValueError('FIRST'),'controller')
                    if edge=='drop':owner.bootstrap.drop.side_effect=OSError('DROP')
                    with patch.dict(globals(),write_new=Mock(side_effect=OSError('WRITE'))) as scope:
                        owner.retain(failure,{}, {'stdout':b'','stderr':b''})
                        self.assertEqual(failure.first['message'],'FIRST')
                        self.assertEqual(failure.secondary[0]['message'],'DROP' if edge=='drop' else 'WRITE')
                        if edge=='drop':scope['write_new'].assert_not_called()

        @contextlib.contextmanager
        def entry_edges(self):
            """All OS edges of the actual entry methods are inert here."""
            env={'SUDO_UID':'1001','SUDO_GID':'1002','GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1',
                 'BW_EXPECTED_HEAD':'a'*40,'BW_EXPECTED_TREE':'b'*40}
            source_data={name:('authored '+name).encode() for name in SOURCE_PATHS}
            source={'schema':'bw.ring3.source.v1','head':'a'*40,'tree':'b'*40,'files':{
                name:{'bytes':len(data),'sha256':sha(data),'mode':'100644',
                      'blob':hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()}
                for name,data in source_data.items()}}
            snapshots={role:{'identity':{'device':3,'inode':index+1},'limits':dict(LIMITS),
                'procs':[],'raw':{'pidsCurrent':'0\n','cgroupEvents':'populated 0\nfrozen 0\n',
                    'memoryEvents':'oom 0\n','cpuStat':'usage_usec 0\n','memoryCurrent':'0\n','memoryPeak':'0\n'}}
                for index,role in enumerate(('enclosing','controller','js','qemu'))}
            owner={'schema':'bw.ring3.entry.v1','uid':1001,'gid':1002,'root':'/sys/fs/cgroup/bw-ring3-123-1',
                'sourceSha256':sha(encode(source)),'python':{'path':'/usr/bin/python3.12','bytes':6,'sha256':sha(b'python')},
                'cgroups':json.loads(json.dumps(snapshots))}
            state={'env':env,'source':source,'sourceData':source_data,'owner':owner,'snapshots':snapshots,
                'uids':(0,0,0),'gids':(0,0,0),'groups':[0],'caps':{k:'0'*16 for k in ('CapInh','CapPrm','CapEff','CapAmb')},
                'events':[],'reads':[],'retained':[],'migrated':False,'pythonMode':0o100755,'dirGid':1002,
                'redirect':{},'directoryOwners':{}}
            def read(path,cap):
                state['reads'].append(str(path))
                if Path(path)==ENTRY_FILE:return state.get('ownerRaw',encode(state['owner']))
                if Path(path)==PACKET/'source.before.json':return state.get('sourceRaw',encode(state['source']))
                return state['sourceData'][str(path)]
            def resolve(path,strict=False):
                if str(path) in state['redirect']:return Path(state['redirect'][str(path)])
                if str(path)==__file__:return Path('/checkout')/RUN_FILE
                return path if path.is_absolute() else Path('/checkout')/path
            def lstat(path):
                directory=str(path) in ('/checkout','/checkout/build','/checkout/build/i80386-ring3-int-iret')
                uid,gid=state['directoryOwners'].get(str(path),(1001,1002))
                return SimpleNamespace(st_mode=0o40755 if directory else 0o100644,st_uid=uid,st_gid=gid)
            def observe(groups,role):
                value=json.loads(json.dumps(state['snapshots'][role]))
                if state['migrated'] and role=='controller':
                    value['procs']=[101];value['raw'].update(pidsCurrent='1\n',cgroupEvents='populated 1\nfrozen 0\n')
                return value
            def proc(path,**kwargs):
                if str(path)=='/proc/self/cgroup':return '0::/bw-ring3-123-1/controller\n'
                self.assertEqual(str(path),'/proc/self/status')
                return ''.join(k+':\t'+v+'\n' for k,v in state['caps'].items())
            def migrate(fd,data):state['events'].append(('move',data));state['migrated']=True;return len(data)
            def open_path(path,flags):state['kernelPath']=str(path);return 7
            def setgroups(value):state['events'].append(('groups',value));state['groups']=value
            def setgid(*value):state['events'].append(('gids',value));state['gids']=value
            def setuid(*value):state['events'].append(('uids',value));state['uids']=value
            with contextlib.ExitStack() as stack:
                patches=[patch.object(os,'getresuid',side_effect=lambda:state['uids']),
                    patch.object(os,'getresgid',side_effect=lambda:state['gids']),patch.object(os,'getgroups',side_effect=lambda:state['groups']),
                    patch.object(os,'setgroups',side_effect=setgroups),patch.object(os,'setresgid',side_effect=setgid),
                    patch.object(os,'setresuid',side_effect=setuid),patch.object(os,'getpid',return_value=101),
                    patch.object(os,'open',side_effect=open_path),patch.object(os,'read',side_effect=lambda fd,cap:proc(Path(state['kernelPath'])).encode()),
                    patch.object(os,'write',side_effect=migrate),patch.object(os,'close'),
                    patch.object(os,'execve',side_effect=lambda *a:state['events'].append(('exec',a))),
                    patch.object(Path,'cwd',return_value=Path('/checkout')),patch.object(Path,'resolve',resolve),
                    patch.object(Path,'lstat',lstat),
                    patch.object(Path,'stat',lambda path:SimpleNamespace(st_mode=state['pythonMode'],st_gid=state['dirGid'])),
                    patch.object(Path,'read_text',proc),patch.object(Cgroups,'observe',observe),
                    patch.object(Cgroups,'path',lambda groups,role:groups.root if role=='enclosing' else groups.root/role),
                    patch.object(RuntimeFiles,'resolve',return_value=('/usr/bin/python3.12',{})),
                    patch.object(RuntimeFiles,'read',return_value=b'python'),patch.dict(globals(),bounded_read=read),
                    patch.dict(globals(),write_new=lambda path,data,cap:state['retained'].append((path,json.loads(data)))),
                    patch.object(sys,'stderr',Mock(buffer=io.BytesIO()))]
                for item in patches:stack.enter_context(item)
                yield BootstrapOps(env),state

        def test_entry_actual_methods_migrate_drop_and_fixed_exec_in_order(self):
            with self.entry_edges() as (ops,state),patch.object(subprocess,'Popen') as child:
                ops.validate();ops.enter();ops.drop()
                with self.assertRaisesRegex(RuntimeError,'exec unexpectedly returned'):ops.execute()
                child.assert_not_called()
                self.assertEqual([x[0] for x in state['events']],['move','groups','gids','uids','exec'])
                self.assertEqual(state['events'][0],('move',b'101'))
                self.assertEqual(state['events'][2:4],[('gids',(1002,)*3),('uids',(1001,)*3)])
                executable,argv,environment=state['events'][-1][1]
                self.assertEqual(executable,'/usr/bin/python3.12')
                self.assertEqual(argv,[executable,'-I','-B',RUN_FILE,'--controller'])
                self.assertEqual(environment,dict(ENV,**{k:state['env'][k] for k in
                    ('GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','BW_EXPECTED_HEAD','BW_EXPECTED_TREE')}))
                self.assertNotIn('SUDO_UID',environment)

        def test_entry_validation_refuses_source_python_owner_and_leaf_drift(self):
            mutations=(lambda s:s['env'].update(GITHUB_RUN_ATTEMPT='2'),
                lambda s:s['owner'].update(uid=1003),lambda s:(s['source']['files'].pop(RUN_FILE),s['owner'].update(sourceSha256=sha(encode(s['source'])))),
                lambda s:s['sourceData'].update({RUN_FILE:b'changed'}),
                lambda s:s['owner']['python'].update(sha256='c'*64),lambda s:s.update(pythonMode=0o104755),
                lambda s:s['snapshots']['controller']['identity'].update(inode=99),
                lambda s:s['snapshots']['js']['limits'].update(pidsMax='65'),
                lambda s:s['snapshots']['qemu'].update(procs=[999]),lambda s:s.update(dirGid=1003))
            for mutate in mutations:
                with self.entry_edges() as (ops,state):
                    mutate(state)
                    ops.environ=dict(state['env'])
                    with self.assertRaises(ValueError):ops.validate()
                    self.assertEqual(state['events'],[])

        def test_entry_requires_root_and_trusted_invoker_before_owner_read(self):
            for change in ('root','uid','gid'):
                with self.entry_edges() as (ops,state):
                    if change=='root':state['uids']=(1001,)*3
                    else:state['env']['SUDO_'+change.upper()]='0';ops.environ=dict(state['env'])
                    with self.assertRaises(ValueError):ops.validate()
                    self.assertIsNone(ops.invoker);self.assertIsNone(ops.owner)

        def test_entry_duplicate_and_nonfinite_json_refuse_before_migration(self):
            for document in ('owner','source'):
                for token in ('duplicate','NaN','1e999'):
                    with self.entry_edges() as (ops,state):
                        raw=encode(state[document]);key=b'"uid":1001' if document=='owner' else b'"head":"'+b'a'*40+b'"'
                        replacement=key+b','+key if token=='duplicate' else key.split(b':')[0]+b':'+token.encode()
                        raw=raw.replace(key,replacement,1);self.assertNotEqual(raw,encode(state[document]))
                        state[document+'Raw']=raw
                        if document=='source':state['owner']['sourceSha256']=sha(raw)
                        with self.assertRaisesRegex(ValueError,'internal entry JSON'):ops.validate()
                        self.assertEqual(state['events'],[])

        def test_entry_directory_escape_or_wrong_owner_refuses_before_facts_read(self):
            for directory in ('/checkout','/checkout/build','/checkout/build/i80386-ring3-int-iret'):
                for fault in ('redirect','uid','gid'):
                    with self.entry_edges() as (ops,state):
                        if fault=='redirect':state['redirect'][directory]='/outside'
                        else:state['directoryOwners'][directory]=(1003,1002) if fault=='uid' else (1001,1003)
                        with self.assertRaisesRegex(ValueError,'checkout and packet directories'):ops.validate()
                        self.assertEqual(state['reads'],[]);self.assertEqual(state['events'],[])

        def test_entry_frozen_snapshot_extra_fields_refuse(self):
            for place in ('outer','identity','raw'):
                with self.entry_edges() as (ops,state):
                    frozen=state['owner']['cgroups']['controller']
                    (frozen if place=='outer' else frozen[place])['extra']=0
                    with self.assertRaisesRegex(ValueError,'closed frozen entry snapshot'):ops.validate()
                    self.assertEqual(state['events'],[])

        def test_entry_kernel_reads_are_capped_and_preserve_read_error(self):
            for path in ('/proc/self/status','/proc/self/cgroup'):
                with patch.object(os,'open',return_value=7) as opened,patch.object(os,'read',return_value=b'x'*4097),patch.object(os,'close'):
                    with self.assertRaisesRegex(ValueError,'kernel observation cap'):entry_proc(path)
                    opened.assert_called_once_with(Path(path),os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
                first=OSError('READ')
                with patch.object(os,'open',return_value=7),patch.object(os,'read',side_effect=first),patch.object(os,'close',side_effect=OSError('CLOSE')):
                    with self.assertRaises(OSError) as caught:entry_proc(path)
                    self.assertIs(caught.exception,first);self.assertEqual(first.ring3_secondary[-1]['message'],'CLOSE')

        def test_entry_missing_or_nonzero_each_capability_prevents_exec(self):
            for field in ('CapInh','CapPrm','CapEff','CapAmb'):
                for value in (None,'0000000000000001'):
                    with self.entry_edges() as (ops,state):
                        ops.validate();ops.enter()
                        if value is None:state['caps'].pop(field)
                        else:state['caps'][field]=value
                        with self.assertRaisesRegex(ValueError,'capability'):ops.drop()
                        self.assertNotIn('exec',[x[0] for x in state['events']])

        def test_entry_failed_drop_or_saved_id_readback_never_execs(self):
            for edge in ('groups','gids','uids','saved'):
                with self.entry_edges() as (ops,state):
                    ops.validate();ops.enter()
                    if edge=='saved':
                        patcher=patch.object(os,'setresuid',side_effect=lambda *v:state.update(uids=(v[0],v[1],0)))
                    else:patcher=patch.object(os,{'groups':'setgroups','gids':'setresgid','uids':'setresuid'}[edge],side_effect=OSError('DROP'))
                    with patcher:
                        with self.assertRaises((OSError,ValueError)):ops.drop()
                    self.assertNotIn('exec',[x[0] for x in state['events']])

        def test_entry_migration_first_error_survives_close_and_never_drops(self):
            with self.entry_edges() as (ops,state):
                ops.validate();first=PermissionError('MIGRATION')
                with patch.object(os,'write',side_effect=first),patch.object(os,'close',side_effect=OSError('CLOSE')):
                    with self.assertRaises(PermissionError) as caught:ops.enter()
                    self.assertIs(caught.exception,first);self.assertEqual(first.ring3_secondary[0]['message'],'CLOSE')
                self.assertEqual(state['events'],[])

        def test_entry_leaf_drift_after_drop_prevents_exec(self):
            with self.entry_edges() as (ops,state):
                ops.validate();ops.enter();ops.drop()
                state['snapshots']['controller']['identity']['inode']=99
                with self.assertRaisesRegex(ValueError,'sole controller PID and leaf identity'):ops.execute()
                self.assertNotIn('exec',[x[0] for x in state['events']])

        def test_entry_preowner_failure_retained_only_after_trusted_drop(self):
            with self.entry_edges() as (ops,state):
                ops.environ['BW_EXPECTED_HEAD']='bad'
                failure=controller_bootstrap(ops)
                self.assertEqual(failure.first['message'],'exact entry source binding')
                self.assertIsNone(ops.owner)
                self.assertEqual([x[0] for x in state['events']],['groups','gids','uids'])
                self.assertEqual(state['retained'][0][0],ENTRY_FAILURE)
                self.assertEqual(state['retained'][0][1]['firstFailure'],failure.first)
                self.assertEqual(state['uids'],(1001,)*3)

        def test_entry_unknown_invoker_or_failed_retention_drop_never_writes(self):
            for edge in ('invoker','drop'):
                with self.entry_edges() as (ops,state):
                    if edge=='invoker':ops.environ['SUDO_UID']='bad'
                    else:ops.environ['BW_EXPECTED_HEAD']='bad'
                    with patch.object(os,'setgroups',side_effect=OSError('DROP')):
                        failure=controller_bootstrap(ops)
                    self.assertEqual(state['retained'],[])
                    self.assertIn('trusted positive' if edge=='invoker' else 'exact entry',failure.first['message'])
                    self.assertTrue(failure.secondary)

        def test_entry_retention_failure_stays_secondary_to_original(self):
            with self.entry_edges() as (ops,state):
                ops.environ['BW_EXPECTED_HEAD']='bad'
                with patch.dict(globals(),write_new=Mock(side_effect=OSError('RETAIN'))):
                    failure=controller_bootstrap(ops)
                self.assertEqual(failure.first['message'],'exact entry source binding')
                self.assertEqual(failure.secondary[0]['message'],'RETAIN')

        def test_entry_wrapper_stops_at_each_failure_and_preserves_exact_first(self):
            for phase in ('validate','enter','drop','execute'):
                events=[];ops=Mock();first=ValueError('FIRST-'+phase)
                for name in ('validate','enter','drop','execute'):
                    def call(name=name):
                        events.append(name)
                        if name==phase:raise first
                    getattr(ops,name).side_effect=call
                ops.retain.side_effect=OSError('RETAIN')
                failure=controller_bootstrap(ops)
                self.assertEqual(events,list(('validate','enter','drop','execute')[:('validate','enter','drop','execute').index(phase)+1]))
                self.assertEqual(failure.first,row(first,'bootstrap'));self.assertEqual(failure.secondary[0]['message'],'RETAIN')

        def test_natural_js_and_qemu_statuses(self):
            for role,code in (('js',0),('qemu',1)):
                ops=Fake([[('stdout',b'original')]],status(code))
                process,streams=collect_child(ops,role,['owned'])
                self.assertIsNone(process['firstFailure']);self.assertEqual(streams['stdout'],b'original')
                self.assertEqual(process['waitStatus'],code<<8);self.assertNotIn('kill',ops.calls)
                self.assertEqual(ops.calls[-1],'close')

        def test_drain_after_wait_without_eof(self):
            ops=Fake([[('stdout',b'first')],[('stdout',b'later')],[]],status())
            process,streams=collect_child(ops,'js',['owned'])
            self.assertEqual(streams['stdout'],b'firstlater');self.assertIsNone(process['firstFailure'])
            self.assertIn(('read',0),ops.calls)

        def test_stream_cap_keeps_exact_original_prefix(self):
            ops=Fake([[('stdout',b'a'*(STREAM_CAP+1))]],status())
            process,streams=collect_child(ops,'js',['owned'])
            self.assertEqual(streams['stdout'],b'a'*STREAM_CAP)
            self.assertEqual(process['firstFailure']['message'],'original stdout byte cap')
            self.assertEqual(ops.calls.count('kill'),1)

        def test_timeout_kill_and_reap_uncertainty_finite(self):
            ops=Fake(now_step=CHILD_NS)
            process,_=collect_child(ops,'js',['owned'])
            self.assertTrue(process['timedOut']);self.assertEqual(ops.calls.count('kill'),1)
            self.assertIsNone(process['waitStatus']);self.assertIn('wall bound',process['firstFailure']['message'])
            self.assertLess(len(ops.calls),15)

        def test_primary_survives_kill_and_close(self):
            ops=Fake(spawn_error=ValueError('FIRST'),kill_error=OSError('KILL'),close_error=OSError('CLOSE'))
            process,_=collect_child(ops,'js',['owned'])
            self.assertEqual(process['firstFailure']['message'],'FIRST')
            self.assertEqual([x['message'] for x in process['secondary']],['KILL','owned spawn-failure reap uncertainty','CLOSE'])

        def test_wrong_status_refuses(self):
            process,_=collect_child(Fake(terminal=status(1)),'js',['owned'])
            self.assertEqual(process['firstFailure']['phase'],'js-terminal')

        def test_serial_stops_before_qemu_and_preserves_exact_first(self):
            calls=[];failure=FirstFailure()
            def execute(role):
                calls.append(role)
                return {'firstFailure':{'phase':'machine','name':'Fault','message':'FIRST'},'secondary':[]},{}
            def retain(*args):raise OSError('RETAIN')
            def terminal(*args):raise OSError('CENSUS')
            run_serial(('js','qemu'),execute,retain,terminal,failure)
            self.assertEqual(calls,['js']);self.assertEqual(failure.first['phase'],'machine')
            self.assertEqual([x['message'] for x in failure.secondary],['RETAIN','CENSUS'])

        def test_serial_positive_exact_order(self):
            calls=[]
            def execute(role):calls.append(role);return {'firstFailure':None,'secondary':[]},{}
            failure=run_serial(('js','qemu'),execute,lambda *a:None,lambda *a:None,FirstFailure())
            self.assertIsNone(failure.first);self.assertEqual(calls,['js','qemu'])

        def test_retention_and_diagnostic_never_replace_first(self):
            failure=FirstFailure();failure.add(ValueError('FIRST'),'owner')
            def write(_):raise OSError('WRITE')
            def diagnostic(_):raise OSError('DIAGNOSTIC')
            retain_failure(failure,write,diagnostic)
            self.assertEqual(failure.first['message'],'FIRST')
            self.assertEqual([x['message'] for x in failure.secondary],['WRITE','DIAGNOSTIC'])

        def test_preexec_migration_limits_before_identity(self):
            events=[];groups=Mock();groups.move_child.side_effect=lambda *a:events.append(('move',a))
            ops=LinuxChild(groups,'js',['owned'])
            def limit(*args):events.append(('limit',args))
            fake_stat='100 (held) '+' '.join(['0']*19+['123'])
            with patch.object(os,'getpid',return_value=101),patch.object(os,'getpgrp',return_value=101),\
                 patch.object(Path,'read_text',return_value=fake_stat),\
                 patch.object(resource,'setrlimit',side_effect=limit),\
                 patch.object(os,'write',side_effect=lambda fd,b:events.append(('identity',b)) or len(b)),\
                 patch.object(os,'close'):
                ops.preexec(7)
            self.assertEqual(events[0],('move',('js',101)))
            self.assertEqual([x[0] for x in events],['move','limit','limit','limit','identity'])
            self.assertEqual(struct.unpack('<QQQ',events[-1][1]),(101,101,123))

        def test_preexec_move_failure_never_emits_identity(self):
            groups=Mock();groups.move_child.side_effect=PermissionError('MOVE')
            with patch.object(os,'getpid',return_value=101),patch.object(resource,'setrlimit') as limits,patch.object(os,'write') as write:
                with self.assertRaises(PermissionError):LinuxChild(groups,'js',['owned']).preexec(7)
                limits.assert_not_called();write.assert_not_called()

        def test_fixed_root_and_attempt_guards(self):
            self.assertEqual(str(expected_cgroup({'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'1'})), '/sys/fs/cgroup/bw-ring3-123-1')
            for run,attempt in (('../1','1'),('1','2'),('','1'),('1/2','1')):
                with self.assertRaises(ValueError):expected_cgroup({'GITHUB_RUN_ID':run,'GITHUB_RUN_ATTEMPT':attempt})

        def test_created_streams_owned_before_setup_failure_and_pipe_close(self):
            for edge in ('set_blocking','register'):
                stdout,stderr,selector=Mock(),Mock(),Mock()
                stdout.fileno.return_value=10;stderr.fileno.return_value=11
                process=Mock(pid=101,stdout=stdout,stderr=stderr)
                first=OSError('FIRST_SETUP');secondary=OSError('PIPE_CLOSE')
                if edge=='register':selector.register.side_effect=first
                def close(fd):
                    if fd==7:raise secondary
                with patch.object(subprocess,'Popen',return_value=process),\
                     patch.object(Path,'cwd',return_value=Path('/checkout')),\
                     patch.object(os,'pipe2',return_value=(7,8)),\
                     patch.object(os,'read',return_value=struct.pack('<QQQ',101,101,123)),\
                     patch.object(os,'close',side_effect=close),\
                     patch.object(os,'set_blocking',side_effect=first if edge=='set_blocking' else None),\
                     patch.object(selectors,'DefaultSelector',return_value=selector):
                    ops=LinuxChild(Mock(),'js',['owned'])
                    with self.assertRaises(OSError) as caught:ops.spawn()
                    self.assertIs(caught.exception,first)
                    self.assertEqual(first.ring3_secondary[0]['message'],'PIPE_CLOSE')
                    ops.close();ops.close()
                stdout.close.assert_called_once();stderr.close.assert_called_once();selector.close.assert_called_once()

        def test_spawn_failure_reaps_until_terminal(self):
            ops=Fake(spawn_error=OSError('FIRST'))
            def reap():
                ops.polls+=1
                return status() if ops.polls==2 else None
            ops.reap=reap
            process,_=collect_child(ops,'js',['owned'])
            self.assertEqual(process['firstFailure']['message'],'FIRST')
            self.assertEqual(ops.polls,2);self.assertEqual(process['waitStatus'],0)
            self.assertEqual(process['secondary'],[])

        def test_bounded_read_and_kernel_close_keep_first(self):
            for kernel in (False,True):
                first=OSError('FIRST_READ')
                info=Mock(st_mode=stat.S_IFREG|0o644,st_size=1)
                with patch.object(os,'open',return_value=7),patch.object(os,'fstat',return_value=info),\
                     patch.object(os,'read',side_effect=first),patch.object(os,'close',side_effect=OSError('SECOND_CLOSE')):
                    with self.assertRaises(OSError) as caught:
                        if kernel:Cgroups.text(None,'/owned')
                        else:bounded_read('/owned',10)
                self.assertIs(caught.exception,first)
                self.assertEqual(first.ring3_secondary[0]['message'],'SECOND_CLOSE')

        def test_retained_write_and_close_keep_first(self):
            first=OSError('FIRST_WRITE');stream=Mock()
            stream.write.side_effect=first;stream.close.side_effect=OSError('SECOND_CLOSE')
            with patch.object(os,'open',return_value=7),patch.object(os,'fdopen',return_value=stream):
                with self.assertRaises(OSError) as caught:write_new('/owned',b'original',100)
            self.assertIs(caught.exception,first)
            self.assertEqual(first.ring3_secondary[0]['message'],'SECOND_CLOSE')

        def runtime_template(self):
            return {'executables':{'node':{'path':'/node','bytes':3,'sha256':sha(b'old')}},
                'qemuPackage':{'files':{'/node':{'bytes':3,'sha256':sha(b'old'),'kind':'node-binary'}},
                    'aliases':{'/alias':{'linkText':'node','target':'/node'}},
                    'probes':[{'role':'node-version','stdout':'original prelaunch'}]}}

        def test_runtime_after_reads_every_file_alias_without_reexecuting_probes(self):
            template=self.runtime_template();calls=[]
            def file(path,cap):calls.append(('file',path));return b'old'
            def alias(path):calls.append(('alias',path));return {'linkText':'node','target':'/node'}
            def probe(value):calls.append(('probe',value['role']));return value
            before,failure=runtime_facts(template,file,alias,probe)
            after,later=runtime_facts(before,file,alias)
            self.assertIsNone(failure.first);self.assertIsNone(later.first);self.assertEqual(before,after)
            self.assertEqual(calls,[('file','/node'),('alias','/alias'),('probe','node-version'),('file','/node'),('alias','/alias')])

        def test_runtime_changed_after_file_and_alias_are_retained(self):
            for changed in ('file','alias'):
                template=self.runtime_template()
                after,failure=runtime_facts(template,
                    lambda p,c:b'new' if changed=='file' else b'old',
                    lambda p:{'linkText':'other' if changed=='alias' else 'node','target':'/other' if changed=='alias' else '/node'})
                self.assertEqual(failure.first['phase'],'runtime-after-drift');self.assertNotEqual(after,template)
                if changed=='file':self.assertEqual(after['qemuPackage']['files']['/node']['sha256'],sha(b'new'))
                else:self.assertEqual(after['qemuPackage']['aliases']['/alias']['target'],'/other')

        def test_runtime_read_error_retains_original_failure_fact(self):
            def file(*a):raise OSError('FIRST_FILE')
            after,failure=runtime_facts(self.runtime_template(),file,lambda p:{'linkText':'node','target':'/node'})
            self.assertEqual(failure.first['message'],'FIRST_FILE')
            self.assertEqual(after['qemuPackage']['files']['/node']['firstFailure']['message'],'FIRST_FILE')

        def test_capture_source_actual_hash_and_closed_graph(self):
            data={path:b'// authored inert source\n' for path in SOURCE_PATHS};head='a'*40;tree='b'*40;calls=[]
            def command(argv,cap):
                calls.append(argv)
                if argv[-1]=='HEAD':return (head+'\n').encode()
                if argv[-1]=='HEAD^{tree}':return (tree+'\n').encode()
                return ''.join('100644 blob '+hashlib.sha1(b'blob '+str(len(value)).encode()+b'\0'+value).hexdigest()+'\t'+path+'\n' for path,value in sorted(data.items())).encode()
            source=capture_source(head,command,lambda path,cap:data[path])
            self.assertEqual(set(source['files']),SOURCE_PATHS)
            self.assertTrue(all('--no-replace-objects' in argv and 'gc.auto=0' in argv and 'maintenance.auto=false' in argv for argv in calls))
            with self.assertRaisesRegex(ValueError,'live source/Git object mismatch'):
                capture_source(head,command,lambda path,cap:b'changed')

        def discovery_edges(self,fail_role=None,missing_module=False):
            class Files:
                aliases={'/bin':{'linkText':'usr/bin','target':'/usr/bin'},
                    '/lib':{'linkText':'usr/lib','target':'/usr/lib'},
                    '/lib64':{'linkText':'usr/lib64','target':'/usr/lib64'},
                    '/usr/lib64/ld-linux-x86-64.so.2':{'linkText':'../lib/x86_64-linux-gnu/ld-linux-x86-64.so.2','target':'/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'},
                    '/usr/bin/python3':{'linkText':'python3.12','target':'/usr/bin/python3.12'}}
                def __init__(self):self.reads=[];self.alias_reads=[]
                def resolve(self,path):
                    found={}
                    for _ in range(16):
                        matches=[name for name in self.aliases if path==name or path.startswith(name+'/')]
                        if not matches:return path,found
                        name=max(matches,key=len);record=self.aliases[name];found[name]=record
                        path=record['target']+path[len(name):]
                    raise ValueError('cycle')
                def read(self,path,cap):
                    self.reads.append((path,cap))
                    if path=='/usr/bin/ldd':return b'#!/bin/bash\n# reviewed inert observation script\n'
                    if path.endswith('.py'):return b'# manufactured Python source\n'
                    return b'\x7fELF'+path.encode()
                def alias(self,path):self.alias_reads.append(path);return dict(self.aliases[path])
                def is_file(self,path):
                    if path==TCG_MODULE:return not missing_module
                    return path in ('/lib64/ld-linux-x86-64.so.2','/usr/share/qemu/keymaps/en-us')
                def python_files(self):return ['/usr/lib/python3.12/os.py']
                def mapped_libraries(self):return ['/lib/x86_64-linux-gnu/libcrypto.so.3']
                def platform(self):return {'sysname':'Linux','release':'manufactured-not-runtime','machine':'x86_64'}
            files=Files();calls=[]
            def probe(role,argv):
                calls.append((role,argv));failure=FirstFailure()
                if role==fail_role:
                    failure.add(TimeoutError('ORIGINAL_PROBE_FAILURE'),'named-runtime-probe')
                    return {'role':role,'argv':argv,'environment':dict(ENV),'exitCode':None,'stdout':'original prefix','stderr':''},failure
                if role.startswith('ldd-'):
                    output='linux-vdso.so.1 (0x1234)\nlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x2345)\n/lib64/ld-linux-x86-64.so.2 (0x3456)\n'
                    if role=='ldd-tcg':output+='libtcg-needed.so.1 => /lib/x86_64-linux-gnu/libtcg-needed.so.1 (0x4567)\n'
                elif role=='package-version':output=''.join(name+'\t1:8.2.2+ds-0ubuntu1\t'+('amd64' if name=='qemu-system-x86' else 'all')+'\n' for name in PACKAGE_NAMES)
                elif role=='package-files':output='/.\n/usr/bin/qemu-system-i386\n'+TCG_MODULE+'\n/usr/share/qemu/keymaps/en-us\n'
                else:output={'node-version':'v22.23.3\n','python-version':'Python 3.12.3\n','qemu-version':'QEMU emulator version 8.2.2 (manufactured)\n'}[role]
                return {'role':role,'argv':argv,'environment':dict(ENV),'exitCode':0,'stdout':output,'stderr':''},failure
            return files,probe,calls

        def test_discovery_actual_plan_interoperates_with_held_reader(self):
            import importlib.util
            spec=importlib.util.spec_from_file_location('held_reader',Path(__file__).with_name('reader.py'))
            reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
            files,probe,calls=self.discovery_edges();plan=RuntimeDiscovery(files,probe)
            before=plan.discover();reader.runtime(before,before)
            self.assertEqual(len(calls),11);self.assertEqual(len({role for role,argv in calls}),11)
            self.assertIn(TCG_MODULE,before['qemuPackage']['files'])
            self.assertTrue(all(cap in (65536,268435456) for path,cap in files.reads))
            after,failure=runtime_facts(before,files.read,files.alias)
            self.assertEqual(before,after);self.assertIsNone(failure.first);self.assertEqual(len(calls),11)
            self.assertEqual(set(files.alias_reads),set(before['qemuPackage']['aliases']))

        def test_discovery_partial_probe_original_survives_exact_primary(self):
            files,probe,calls=self.discovery_edges(fail_role='package-files');plan=RuntimeDiscovery(files,probe)
            with self.assertRaises(ObservedFailure) as caught:plan.discover()
            failure=FirstFailure();failure.add(caught.exception,'wrapper')
            self.assertEqual(failure.first,{'phase':'named-runtime-probe','name':'TimeoutError','message':'ORIGINAL_PROBE_FAILURE'})
            self.assertEqual(plan.originals()['probes'][-1]['stdout'],'original prefix')
            self.assertNotIn('node-version',[role for role,argv in calls])

        def test_discovery_missing_module_refuses_without_fallback(self):
            files,probe,calls=self.discovery_edges(missing_module=True)
            with self.assertRaisesRegex(ValueError,'required named installed i386 TCG module'):RuntimeDiscovery(files,probe).discover()
            self.assertNotIn('ldd-tcg',[role for role,argv in calls])

        def test_discovery_prelaunch_readback_retains_changed_file(self):
            files,probe,calls=self.discovery_edges();original=files.read;counts={}
            def read(path,cap):
                counts[path]=counts.get(path,0)+1
                value=original(path,cap)
                return b'\x7fELFchanged' if path==RUNTIME_EXECUTABLES['node'] and counts[path]>=2 else value
            files.read=read;plan=RuntimeDiscovery(files,probe)
            with self.assertRaises(ObservedFailure) as caught:plan.discover()
            self.assertEqual(caught.exception.firstFailure['phase'],'runtime-before-drift')
            self.assertEqual(plan.originals()['qemuPackage']['files'][RUNTIME_EXECUTABLES['node']]['sha256'],sha(b'\x7fELFchanged'))

        def test_discovery_count_caps_precede_file_or_probe_capture(self):
            files,probe,calls=self.discovery_edges();plan=RuntimeDiscovery(files,probe)
            plan.files={f'/already/{i}':{'bytes':1,'sha256':'1'*64,'kind':'qemu-data'} for i in range(512)}
            with self.assertRaisesRegex(ValueError,'runtime file count cap'):plan.add('/extra','qemu-data')
            self.assertEqual(files.reads,[])
            plan.probes=[{'role':str(i)} for i in range(16)]
            with self.assertRaisesRegex(ValueError,'probe count'):plan.observe('node-version',['never'])
            self.assertEqual(calls,[])

        def test_discovery_probe_extent_refuses_and_retains_original(self):
            files,probe,calls=self.discovery_edges();plan=RuntimeDiscovery(files,probe)
            plan.probe=lambda role,argv:({'role':role,'argv':argv,'environment':dict(ENV),'exitCode':0,'stdout':'x'*16385,'stderr':''},FirstFailure())
            with self.assertRaisesRegex(ObservedFailure,'stdout cap'):plan.observe('node-version',['fixed'])
            self.assertEqual(len(plan.originals()['probes']),1)
            self.assertEqual(len(plan.originals()['probes'][0]['stdout']),16384)

        def test_actual_alias_resolver_cycle_and_original_topology(self):
            links={'/a':'b','/b':'a'}
            def info(path):return Mock(st_mode=stat.S_IFLNK if str(path) in links else stat.S_IFDIR)
            with patch.object(os,'lstat',side_effect=info),patch.object(os,'readlink',side_effect=lambda p:links[str(p)]):
                with self.assertRaisesRegex(ValueError,'alias chain'):RuntimeFiles().resolve('/a/file')
            links={'/lib':'usr/lib'}
            with patch.object(os,'lstat',side_effect=info),patch.object(os,'readlink',side_effect=lambda p:links[str(p)]):
                target,aliases=RuntimeFiles().resolve('/lib/held.so')
            self.assertEqual(target,'/usr/lib/held.so');self.assertEqual(aliases,{'/lib':{'linkText':'usr/lib','target':'/usr/lib'}})

        def test_actual_after_alias_readback_drift(self):
            files,probe,calls=self.discovery_edges();before=RuntimeDiscovery(files,probe).discover()
            real_alias=files.alias
            files.alias=lambda path:{'linkText':'wrong','target':'/wrong'} if path=='/lib' else real_alias(path)
            after,failure=runtime_facts(before,files.read,files.alias)
            self.assertEqual(failure.first['phase'],'runtime-after-drift')
            self.assertEqual(after['qemuPackage']['aliases']['/lib'],{'linkText':'wrong','target':'/wrong'})

        def test_discovery_profile_caps_and_guest_profile_unchanged(self):
            discovery=Fake([[('stdout',b'x'*16385)]],status())
            process,streams=collect_child(discovery,'discovery',['owned'],profile='discovery')
            self.assertEqual(len(streams['stdout']),16384)
            self.assertEqual(process['firstFailure']['message'],'original stdout byte cap')
            guest=Fake([[('stdout',b'x'*16385)]],status())
            process,streams=collect_child(guest,'js',['owned'])
            self.assertEqual(len(streams['stdout']),16385);self.assertIsNone(process['firstFailure'])
            timed=Fake(now_step=10000000000)
            process,_=collect_child(timed,'discovery',['owned'],profile='discovery')
            self.assertTrue(process['timedOut']);self.assertEqual(timed.calls.count('kill'),1)
            self.assertEqual(timed.polls,2)  # Ten-second probe profile, not the guest's 120 seconds.
            untouched=Mock()
            with self.assertRaises(ValueError):collect_child(untouched,'discovery',['owned'],profile='custom')
            untouched.now.assert_not_called()

        def test_tool_preexec_inherits_controller_without_guest_migration(self):
            groups=Mock();events=[]
            groups.discovery_member.side_effect=lambda parent,child:events.append(('member',parent,child))
            fake_stat='101 (held) '+' '.join(['0']*19+['123'])
            with patch.object(os,'getpid',return_value=101),patch.object(os,'getpgrp',return_value=101),\
                 patch.object(Path,'read_text',return_value=fake_stat),\
                 patch.object(resource,'setrlimit',side_effect=lambda *a:events.append(('limit',a))),\
                 patch.object(os,'write',side_effect=lambda fd,b:events.append(('identity',b)) or len(b)),patch.object(os,'close'):
                LinuxTool(groups,['owned'],100).preexec(7)
            self.assertEqual(events[0],('member',100,101));groups.move_child.assert_not_called()
            self.assertEqual(struct.unpack('<QQQ',events[-1][1]),(101,101,123))

        def test_tool_group_kill_only_before_own_leader_reap(self):
            tool=LinuxTool(Mock(),['owned'],100);tool.process=Mock(pid=101,returncode=None)
            with patch.object(os,'killpg') as kill,patch.object(signal,'getsignal',return_value=signal.SIG_DFL):
                tool.kill();kill.assert_called_once_with(101,signal.SIGKILL)
                tool.process.returncode=0
                with self.assertRaisesRegex(ValueError,'after owned leader reap'):tool.kill()
                kill.assert_called_once()

        def test_tool_resets_wait_policy_before_spawn_without_early_restore(self):
            for previous in (signal.SIG_DFL,signal.SIG_IGN):
                events=[];tool=LinuxTool(Mock(),['owned'],100)
                def reset(number,handler):events.append(('reset',number,handler));return previous
                def spawn():events.append(('spawn',));return {'pid':101}
                with patch.object(signal,'signal',side_effect=reset) as install,\
                     patch.object(signal,'getsignal') as inspect,\
                     patch.object(LinuxChild,'spawn',side_effect=spawn),\
                     patch.object(LinuxChild,'reap',return_value=status()):
                    self.assertEqual(tool.spawn(),{'pid':101});tool.reap();tool.close()
                    install.assert_called_once_with(signal.SIGCHLD,signal.SIG_DFL)
                    inspect.assert_not_called()
                self.assertEqual(events,[('reset',signal.SIGCHLD,signal.SIG_DFL),('spawn',)])

        def test_tool_failed_wait_policy_reset_never_delegates_creation(self):
            first=ValueError('signal reset requires main thread')
            with patch.object(signal,'signal',side_effect=first),\
                 patch.object(signal,'getsignal'),\
                 patch.object(LinuxChild,'spawn') as create:
                with self.assertRaises(ValueError) as caught:LinuxTool(Mock(),['owned'],100).spawn()
                self.assertIs(caught.exception,first);create.assert_not_called()

        def test_tool_changed_ignore_disposition_never_signals_group(self):
            tool=LinuxTool(Mock(),['owned'],100);tool.process=Mock(pid=101,returncode=None)
            with patch.object(signal,'getsignal',return_value=signal.SIG_IGN),patch.object(signal,'signal') as install,\
                 patch.object(os,'killpg') as kill:
                with self.assertRaisesRegex(ValueError,'default SIGCHLD'):tool.kill()
                kill.assert_not_called();install.assert_not_called()

        def test_actual_controller_census_and_failed_snapshot_retention(self):
            groups=Cgroups.__new__(Cgroups)
            def snapshot(procs):
                return {'procs':procs,'raw':{'pidsCurrent':str(len(procs)),
                    'cgroupEvents':'populated '+str(int(bool(procs)))+'\nfrozen 0\n'}}
            groups.observe=lambda name:snapshot([100] if name=='controller' else [])
            with patch.object(os,'getpid',return_value=100):groups.discovery_idle(100)
            groups.observe=lambda name:snapshot([100,999] if name=='controller' else [])
            with patch.object(os,'getpid',return_value=100):
                with self.assertRaisesRegex(ValueError,'parent-only'):groups.discovery_idle(100)
            self.assertEqual(groups.last_discovery_census['controller']['procs'],[100,999])
            groups.observe=lambda name:snapshot([100,101])
            with patch.object(os,'getpid',return_value=101):groups.discovery_member(100,101)
            groups.observe=lambda name:snapshot([100])
            with patch.object(os,'getpid',return_value=101):
                with self.assertRaisesRegex(ValueError,'inherit'):groups.discovery_member(100,101)

        def test_real_callback_exact_plan_through_bounded_helpers(self):
            import importlib.util
            spec=importlib.util.spec_from_file_location('callback_held_reader',Path(__file__).with_name('reader.py'))
            reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
            files,expected_probe,expected_calls=self.discovery_edges();groups=Mock();created=[]
            with patch.object(os,'getpid',return_value=100):
                callback=RuntimeProbeCallback(groups,files)
            roles=['node-version','python-version','qemu-version','ldd-node','ldd-python','ldd-qemu',
                'ldd-shell','ldd-dpkg-query','ldd-tcg','package-version','package-files']
            def factory(argv):
                matching=[role for role in roles if callback.argv(role)==argv]
                self.assertEqual(len(matching),1)
                original,failure=expected_probe(matching[0],argv);self.assertIsNone(failure.first)
                ops=Fake([[('stdout',original['stdout'].encode())]],status());created.append(ops);return ops
            callback.factory=factory
            runtime=RuntimeDiscovery(files,callback).discover();reader.runtime(runtime,runtime)
            self.assertEqual(len(created),11);self.assertEqual(groups.discovery_idle.call_count,22)
            self.assertEqual(callback.last_process['role'],'discovery')
            self.assertTrue(all('kill' not in ops.calls for ops in created));groups.move_child.assert_not_called()

        def test_callback_wrong_argv_has_no_process_or_cgroup_effect(self):
            files,_,_=self.discovery_edges();groups=Mock();factory=Mock()
            with patch.object(os,'getpid',return_value=100):callback=RuntimeProbeCallback(groups,files,factory)
            for role,argv in [('node-version',['/arbitrary/node','--version']),('arbitrary',['/bin/sh']),
                              ('ldd-tcg',['/usr/bin/ldd','/arbitrary.so'])]:
                original,failure=callback(role,argv)
                self.assertIsNotNone(failure.first);self.assertIsNone(original['exitCode'])
            factory.assert_not_called();groups.discovery_idle.assert_not_called()

        def test_callback_partial_failure_preserves_process_and_first_before_census(self):
            files,_,_=self.discovery_edges();groups=Mock()
            groups.discovery_idle.side_effect=[{},OSError('LEFT_DESCENDANT')]
            ops=Fake([[('stdout',b'original partial')]],now_step=10000000000)
            with patch.object(os,'getpid',return_value=100):callback=RuntimeProbeCallback(groups,files,lambda argv:ops)
            original,failure=callback('node-version',callback.argv('node-version'))
            self.assertEqual(original['stdout'],'original partial');self.assertIsNone(original['exitCode'])
            self.assertEqual(failure.first,callback.last_process['firstFailure'])
            self.assertEqual(failure.first['name'],'TimeoutError')
            self.assertEqual(failure.secondary[-1]['message'],'LEFT_DESCENDANT')
            self.assertEqual(ops.calls.count('kill'),1)

        def test_callback_natural_nonzero_and_descendant_refusals_never_fabricate_exit(self):
            files,_,_=self.discovery_edges()
            for code in (0,7):
                groups=Mock();groups.discovery_idle.side_effect=[{},OSError('DESCENDANT')]
                ops=Fake([[('stdout',b'original')]],status(code))
                with patch.object(os,'getpid',return_value=100):callback=RuntimeProbeCallback(groups,files,lambda argv:ops)
                original,failure=callback('node-version',callback.argv('node-version'))
                self.assertEqual(original['exitCode'],code);self.assertIsNotNone(failure.first)
                self.assertNotIn('kill',ops.calls)

    result=unittest.TextTestRunner(stream=sys.stderr,verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
    need(result.wasSuccessful(),'inert controller controls failed')
    print(json.dumps({'testOnly':True,'tests':result.testsRun,'guestOrResourceOperationExecuted':False,'pass':True}))


def main():
    return dispatch_cli()


if __name__=='__main__':raise SystemExit(main())
