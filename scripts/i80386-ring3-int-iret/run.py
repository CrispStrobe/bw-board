#!/usr/bin/env python3
"""MIT. Fixed ring3 hosted controller. --controls uses inert edges only.

Source checkpoint: bounded child/resource functions are executable against the
mock interface below. The actual entry remains closed until the runtime graph,
privileged first-entry and workflow receive their separate source review.
"""
import argparse
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

PACKET = Path('build/i80386-ring3-int-iret')
ENV = {'LANG': 'C.UTF-8', 'HOME': '/nonexistent', 'PATH': '/usr/bin:/bin'}
LIMITS = {'cpuMax': '100000 100000', 'memoryMax': '1073741824', 'swapMax': '0', 'pidsMax': '64'}
CHILD_NS, DRAIN_NS = 120000000000, 2000000000
STREAM_CAP, JSON_CAP, PACKET_CAP = 131072, 1048576, 16777216
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


def bounded_read(path, cap):
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
    except Exception as error: first = error
    finally: first = close_owned(descriptor, first, 'input-descriptor-close')
    if first is not None: raise first
    return bytes(data)


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
    package = result['qemuPackage']
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
    for name, executable in result['executables'].items():
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
            self.process = subprocess.Popen(self.argv, cwd=Path.cwd(), env=ENV,
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


def collect_child(ops, role, argv, *, profile='guest'):
    """Actual bounded orchestration, also called unmodified by inert controls."""
    need(profile in ('guest','discovery'),'closed child profile')
    need(role in ('js','qemu') if profile=='guest' else role=='discovery','fixed child role/profile')
    wall_ns,stream_cap=(CHILD_NS,STREAM_CAP) if profile=='guest' else (10000000000,16384)
    failure = FirstFailure(); started = ops.now(); deadline = started+wall_ns
    output = {'stdout': bytearray(), 'stderr': bytearray()}
    process = {'schema': 'bw.ring3.process.v1', 'role': role, 'argv': argv,
        'cwdRole': 'checkout', 'environment': dict(ENV), 'pid': None, 'pgid': None, 'parentPid': None,
        'startTicks': None, 'spawnMonoNs': started, 'reapMonoNs': None, 'exitCode': None, 'signal': None,
        'waitStatus': None, 'timedOut': False, 'rusage': None, 'firstFailure': None, 'secondary': []}
    reaped = False; killed = False; cleanup_deadline = None

    def admit(chunks):
        for name, data in chunks:
            need(name in output and type(data) is bytes, 'closed original stream chunk')
            remaining = stream_cap-len(output[name])
            output[name].extend(data[:remaining])  # preserve bounded original prefix, including on overflow
            need(len(data) <= remaining, 'original '+name+' byte cap')

    try:
        process.update(ops.spawn())
        while not reaped:
            try:
                admit(ops.read_available(0.02))
                terminal = ops.reap()
                if terminal is not None:
                    process.update(terminal); process['reapMonoNs'] = ops.now(); reaped = True
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
                    process.update(terminal); process['reapMonoNs'] = ops.now(); reaped = True; break
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
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--controls',action='store_true')
    args=parser.parse_args()
    need(args.controls, 'actual entry not connected before runtime/bootstrap source review')
    controls()


if __name__=='__main__':main()
