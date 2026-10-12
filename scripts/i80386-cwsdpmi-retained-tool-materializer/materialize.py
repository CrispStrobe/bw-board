"""Selected fixed-role archive materialization; no tool or compiler execution."""
import bz2
import hashlib
import io
import os
from pathlib import Path
import stat
import struct
import types
import zipfile

OBSERVER_SHA = '53d295bca750edce8d2b3496498195c8f735528dd15bff6eba26127b55558312'
TOOL_BYTES = 80596981
TOOL_SHA = '8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'
SOURCE = {'djcrx205.zip': (895256, '22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'), 'djdev205.zip': (2509574, '4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'), 'djlsr205.zip': (2047171, '80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea')}
SELECTED = {'compiler': ('djgpp/bin/i586-pc-msdosdjgpp-gcc', 'afd20f428ccb032b21f00832587219d236efde25344c8067f820b1e677d0799f'), 'assembler': ('djgpp/i586-pc-msdosdjgpp/bin/as', '41dda143ed208ffeb62722e0963193b0a2450bdd0aa00c5bd394115e3b2eef24'), 'linker': ('djgpp/i586-pc-msdosdjgpp/bin/ld', '99f2e74294e340136f3345982f6c95f59431a75abbc01734552e63a84b9cfc65'), 'stubify': ('djgpp/i586-pc-msdosdjgpp/bin/stubify', 'e0f233de37256389434894ce38158c9e68c57c46f7cbe332021ad64577751a09'), 'dpmi.h': ('djgpp/i586-pc-msdosdjgpp/sys-include/dpmi.h', 'cf73c8314e4ae364d6160913bae31be5d9f5800c1d333af1291e4e49f61627b3'), 'farptr.h': ('djgpp/i586-pc-msdosdjgpp/sys-include/sys/farptr.h', 'b38414509d8e1e59de9402188ed003ab7e2cde3bd50786318aedb0232329547d'), 'crt0.o': ('djgpp/i586-pc-msdosdjgpp/lib/crt0.o', 'ee1b0b2cf7b2645708ce35bff4c4c18322aa7e29f89eed5769c4a138cf4acfae'), 'libc.a': ('djgpp/i586-pc-msdosdjgpp/lib/libc.a', 'f59d5106cc668a67c3334c33be2c273df7c69dce93e4e53ef8a52c07a9fbda78'), 'libgcc.a': ('djgpp/lib/gcc/i586-pc-msdosdjgpp/12.2.0/libgcc.a', 'e9d6ad2b2c679617b4d305b655039403514ba8f140805f2b75044ffcf16bc4b7')}
TOOL_URL = 'https://github.com/andrewwutw/build-djgpp/releases/download/v3.4/djgpp-linux64-gcc1220.tar.bz2'
SOURCE_URL = 'https://www.delorie.com/pub/djgpp/current/v2/'
MAX_MEMBERS = 30000
MAX_FILE = 256 << 20
MAX_DECODED = 3 << 30
MAX_SELECTED = 64 << 20
MAX_ROLE = 16 << 20
MAX_NOTICE = 32 << 10
MAX_NOTICES = 256 << 10
CODES = frozenset(('input-refused','archive-refused','archive-cap','archive-truncated','archive-type',
                  'archive-path','archive-duplicate','selected-refused','source-origin-refused',
                  'phase-order','materializer-reentry','filesystem-refusal','output-refused','cleanup-refusal'))

class Refusal(ValueError):pass

def need(ok, code):
    if not ok:raise Refusal(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()

def _load_observer():
    path=Path(__file__).parent.parent/'i80386-cwsdpmi-retained-tool-observer/observer.py'
    with path.open('rb') as stream:raw=stream.read(65537)
    need(len(raw)<=65536 and sha(raw)==OBSERVER_SHA,'input-refused')
    module=types.ModuleType('private_materialization_observer');module.__file__=str(path)
    exec(compile(raw,'<fixed-retained-observer>','exec'),module.__dict__)
    return module

observer_module=_load_observer()

def canonical(name):
    need(type(name)is str and 0<len(name)<=240,'archive-path')
    need(not name.startswith('/') and '\\' not in name and '\x00' not in name and all(32<=ord(c)<127 for c in name),'archive-path')
    if name.startswith('./'):name=name[2:]
    need(not name.endswith('//'),'archive-path')
    parts=(name[:-1] if name.endswith('/') else name).split('/')
    need(parts and all(p and p not in ('.','..') and len(p)<=255 for p in parts) and all(':' not in p for p in parts),'archive-path')
    return '/'.join(parts)

def inventory_add(entries,required,name,directory):
    need(name not in entries,'archive-duplicate')
    parts=name.split('/')
    for end in range(1,len(parts)):
        need(entries.get('/'.join(parts[:end])) is not False,'archive-path')
    if not directory:need(name not in required,'archive-path')
    required.update('/'.join(parts[:end]) for end in range(1,len(parts)))
    entries[name]=directory

def _octal(field):
    need(not field[0]&0x80,'archive-type')
    raw=field.strip(b' \x00')
    need(not raw or all(48<=c<=55 for c in raw),'archive-refused')
    return int(raw or b'0',8)

def _name(field):
    raw,separator,tail=field.partition(b'\x00')
    need(not tail or not any(tail),'archive-path')
    try:return raw.decode('ascii')
    except UnicodeError:raise Refusal('archive-path') from None

class _BZ2Reader:
    def __init__(self,raw):
        self.raw=raw;self.position=0;self.decoder=bz2.BZ2Decompressor();self.buffer=b'';self.decoded=0
    def _fill(self):
        if self.decoder.eof:
            need(not self.decoder.unused_data and self.position==len(self.raw),'archive-refused')
            return False
        if self.decoder.needs_input:
            need(self.position<len(self.raw),'archive-truncated')
            block=self.raw[self.position:self.position+65536];self.position+=len(block)
        else:block=b''
        try:decoded=self.decoder.decompress(block,max_length=65536)
        except (OSError,EOFError):raise Refusal('archive-refused') from None
        need(self.decoded+len(decoded)<=MAX_DECODED,'archive-cap')
        self.decoded+=len(decoded);self.buffer=decoded
        if self.decoder.eof:need(not self.decoder.unused_data and self.position==len(self.raw),'archive-refused')
        return bool(decoded) or not self.decoder.eof
    def read(self,n):
        need(type(n)is int and 0<n<=65536,'archive-cap')
        pieces=[];count=0
        while count<n:
            while not self.buffer:
                if not self._fill():return b''.join(pieces)
            part=self.buffer[:n-count];self.buffer=self.buffer[len(part):]
            pieces.append(part);count+=len(part)
        return b''.join(pieces)
    def exact(self,n):
        raw=self.read(n);need(len(raw)==n,'archive-truncated');return raw
    def clear(self):self.raw=b'';self.buffer=b'';self.decoder=None

class RetainedToolMaterializer:
    def __init__(self,parent):
        self._observer=observer_module.RetainedToolObserver(parent)
        self._busy=False;self._first=None;self._reentered=False;self._consumed=False;self._closed=False
        self._phase='new';self._archives={};self._written=[];self._dirs={}
        self._close_attempted=0;self._close_refused=0;self._secondary=None
        self._decoded=0;self._notices={};self._notice_bytes=0;self._notice_omitted=0;self._origins={}
    def _enter(self):
        if self._busy:
            self._reentered=True;self._first=self._first or 'materializer-reentry'
            o=self._observer;o._reentered=True;o._epoch+=1;o._first=o._first or 'observer-reentry';o._owner._poison()
            raise Refusal('materializer-reentry')
        self._busy=True
    def _check(self):
        need(not self._observer._reentered and self._observer._owner._first is None,'materializer-reentry')
        need(not self._reentered and self._first is None,'materializer-reentry' if self._reentered else self._first or 'filesystem-refusal')
    def _latch(self,error):
        code=str(error) if type(error)is Refusal else 'filesystem-refusal'
        self._first=self._first or (code if code in CODES else 'filesystem-refusal')
    def _call(self,fn,*args,_local=None,**kw):
        self._check();result=fn(*args,**kw)
        try:
            self._check()
            if _local is not None:_local.register(result)
        except BaseException as error:
            self._latch(error)
            if _local is not None:_local.returned_cleanup(result)
            raise
        return result
    def _notice(self,role,name,data):
        base=name.rsplit('/',1)[-1].lower()
        if not base.startswith(('license','licence','copying','copyright','manifest')):return
        processed=False
        if data is not None and len(data)<=MAX_NOTICE and self._notice_bytes+len(data)<=MAX_NOTICES and len(self._notices)<256:
            try:text=data.decode('utf-8')
            except UnicodeError:text=None
            if text is not None and '\x00' not in text and all(c.isprintable() or c in '\t\r\n\f' for c in text):
                self._notice_bytes+=len(data);processed=True
        if processed:
            self._notices[(role,name)]={'bytes':len(data),'sha256':sha(data)}
        else:self._notice_omitted+=1
    def _tar(self,raw):
        reader=_BZ2Reader(raw);seen={};required=set();selected={};selected_total=0;declared=0;members=0
        bypath={relative:role for role,(relative,digest) in SELECTED.items()}
        try:
            while True:
                self._check();header=reader.exact(512);self._check()
                if header==b'\x00'*512:
                    need(reader.exact(512)==b'\x00'*512,'archive-refused');self._check()
                    while True:
                        trailing=reader.read(65536);self._check()
                        if not trailing:break
                        need(not any(trailing),'archive-refused')
                    break
                members+=1;need(members<=MAX_MEMBERS,'archive-cap')
                need(_octal(header[148:156])==sum(header[:148])+8*32+sum(header[156:]),'archive-refused')
                need(header[257:263] in (b'ustar\x00',b'ustar '),'archive-type')
                name=_name(header[:100]);prefix=_name(header[345:500])
                if prefix:name=prefix+'/'+name
                kind=header[156:157];extent=_octal(header[124:136]);mode=_octal(header[100:108])
                need(kind in (b'\x00',b'0',b'5') and not mode&0o6000,'archive-type')
                if name in ('.','./') and kind==b'5':name='.'
                else:
                    need(kind==b'5' or not name.endswith('/'),'archive-type')
                    name=canonical(name)
                inventory_add(seen,required,name,kind==b'5')
                need(not _name(header[157:257]),'archive-type')
                if kind==b'5':need(extent==0,'archive-type');continue
                need(extent<=MAX_FILE and declared+extent<=MAX_DECODED,'archive-cap');declared+=extent
                role=bypath.get(name)
                if role is not None:
                    need(0<extent<=MAX_ROLE and selected_total+extent<=MAX_SELECTED,'selected-refused')
                    selected_total+=extent # Consumed before body read.
                keep=role is not None or extent<=MAX_NOTICE
                data=bytearray() if keep else None;digest=hashlib.sha256();remaining=extent
                while remaining:
                    self._check();block=reader.exact(min(65536,remaining));self._check();remaining-=len(block);digest.update(block)
                    if data is not None:data.extend(block)
                if extent%512:reader.exact(512-extent%512);self._check()
                if role is not None:
                    need(digest.hexdigest()==SELECTED[role][1],'selected-refused')
                    selected[role]=(bytes(data),bool(mode&0o111))
                self._notice('toolchain',name,None if data is None else bytes(data))
            need(set(selected)==set(SELECTED),'selected-refused')
            self._decoded=reader.decoded
            return selected
        finally:reader.clear()
    def _zip(self,role,raw):
        seen={};required=set();total=0;matches={}
        wanted={'include/dpmi.h':'dpmi.h','include/sys/farptr.h':'farptr.h','lib/crt0.o':'crt0.o','lib/libc.a':'libc.a'}
        need(len(raw)>=22 and raw[-22:-18]==b'PK\x05\x06' and raw[-2:]==b'\x00\x00','archive-refused')
        disk,start_disk,count_disk,count,size,offset,comment=struct.unpack('<4H2LH',raw[-18:])
        need(disk==start_disk==comment==0 and count==count_disk and offset+size+22==len(raw) and raw[:4] in (b'PK\x03\x04',b'PK\x05\x06'),'archive-refused')
        need(count<=MAX_MEMBERS and self._decoded+len(raw)<=MAX_DECODED,'archive-cap')
        self._decoded+=len(raw) # Conservative envelope overhead plus all decoded bodies.
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            rows=archive.infolist();need(len(rows)==count and len(rows)<=MAX_MEMBERS,'archive-cap')
            for row in rows:
                self._check();name=canonical(row.filename);inventory_add(seen,required,name,row.is_dir())
                mode=row.external_attr>>16
                need(not row.flag_bits&1 and stat.S_IFMT(mode) in (0,stat.S_IFREG,stat.S_IFDIR),'archive-type')
                need(stat.S_IFMT(mode) != (stat.S_IFREG if row.is_dir() else stat.S_IFDIR),'archive-type')
                if row.is_dir():
                    need(row.file_size==row.compress_size==row.CRC==0 and row.compress_type==zipfile.ZIP_STORED,'archive-type')
                    self._check()
                    with archive.open(row) as stream:
                        self._check();need(stream.read(1)==b'','archive-refused');self._check()
                    continue
                need(0<=row.file_size<=MAX_FILE and self._decoded+row.file_size<=MAX_DECODED,'archive-cap');total+=row.file_size;self._decoded+=row.file_size
                need(row.file_size<=max(1,row.compress_size)*1000 and (row.compress_size>0 or row.file_size==0),'archive-cap')
                digest=hashlib.sha256();saved=bytearray() if row.file_size<=MAX_NOTICE else None;count=0
                with archive.open(row) as stream:
                    self._check()
                    while count<row.file_size:
                        self._check();limit=min(65536,row.file_size-count);block=stream.read(limit);self._check();need(type(block)is bytes and 0<len(block)<=limit,'archive-truncated')
                        count+=len(block);digest.update(block)
                        if saved is not None:saved.extend(block)
                    need(stream.read(1)==b'','archive-refused');self._check()
                self._notice(role,name,None if saved is None else bytes(saved))
                if role=='djcrx205.zip' and name.lower() in wanted:
                    target=wanted[name.lower()];need(target not in matches and digest.hexdigest()==SELECTED[target][1],'source-origin-refused');matches[target]=digest.hexdigest()
        if role=='djcrx205.zip':need(set(matches)==set(wanted.values()),'source-origin-refused');self._origins=matches
    def _write_role(self,role,raw,executable):
        root=self._observer._owner._writer._routes._chains[0][-1][2]
        local=observer_module._LocalFDs(root);chain=[];parent=root;parts=SELECTED[role][0].split('/');prefix=[]
        try:
            self._observer._route_check();self._check()
            for component in parts[:-1]:
                prefix.append(component);key='/'.join(prefix)
                if key not in self._dirs:
                    self._call(os.mkdir,component,0o700,dir_fd=parent)
                before=observer_module._directory(self._call(os.stat,component,dir_fd=parent,follow_symlinks=False))
                fd=self._call(os.open,component,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=parent,_local=local)
                held=observer_module._directory(self._call(os.fstat,fd));named=observer_module._directory(self._call(os.stat,component,dir_fd=parent,follow_symlinks=False))
                need(before==held==named,'output-refused')
                if key in self._dirs:need(self._dirs[key]==held,'output-refused')
                else:
                    old=list(self._dirs.values())+[r[3] for r in self._observer._owner._writer._routes._chains[0]]
                    need(held not in old,'output-refused');self._dirs[key]=held
                chain.append((parent,component,fd,held));parent=fd
            name=parts[-1]
            fd=self._call(os.open,name,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=parent,_local=local)
            before=self._call(os.fstat,fd);need(stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size==0,'output-refused')
            count=0
            while count<len(raw):
                n=self._call(os.write,fd,raw[count:count+65536]);need(type(n)is int and 0<n<=min(65536,len(raw)-count),'output-refused');count+=n
            self._call(os.fchmod,fd,0o500 if executable else 0o400)
            held=observer_module._regular(self._call(os.fstat,fd));need(held['bytes']==len(raw),'output-refused')
            digest=hashlib.sha256();count=0
            while count<len(raw):
                limit=min(65536,len(raw)-count);block=self._call(os.pread,fd,limit,count);need(type(block)is bytes and 0<len(block)<=limit,'output-refused');count+=len(block);digest.update(block)
            need(self._call(os.pread,fd,1,count)==b'' and digest.hexdigest()==SELECTED[role][1],'output-refused')
            need(held==observer_module._regular(self._call(os.fstat,fd))==observer_module._regular(self._call(os.stat,name,dir_fd=parent,follow_symlinks=False)),'output-refused')
            for owner,name,fd,saved in reversed(chain):
                need(observer_module._directory(self._call(os.fstat,fd))==saved==observer_module._directory(self._call(os.stat,name,dir_fd=owner,follow_symlinks=False)),'output-refused')
            self._observer._route_check();self._check();self._written.append(role)
        except BaseException as error:self._latch(error);raise
        finally:
            local.release();self._close_attempted+=local.attempted;self._close_refused+=local.refused
            if local.refused:self._first=self._first or 'cleanup-refusal'
    def _cleanup(self):
        try:self._observer.close()
        except BaseException:self._secondary=self._secondary or 'cleanup-refusal'
    def materialize(self,toolchain_bytes,djcrx_bytes,djdev_bytes,djlsr_bytes):
        self._enter();selected=None
        try:
            need(not self._closed,'phase-order');self._check();need(not self._consumed,'phase-order');self._consumed=True;self._phase='authenticate-consumed'
            inputs=(toolchain_bytes,djcrx_bytes,djdev_bytes,djlsr_bytes)
            expected=(('toolchain',TOOL_BYTES,TOOL_SHA),*((name,*pair) for name,pair in SOURCE.items()))
            for raw,(role,extent,digest) in zip(inputs,expected):
                need(type(raw)is bytes and len(raw)==extent and sha(raw)==digest,'input-refused');self._check()
                self._archives[role]={'bytes':extent,'sha256':digest}
            self._check();self._phase='inventory-consumed';selected=self._tar(toolchain_bytes)
            for name,raw in zip(SOURCE,(djcrx_bytes,djdev_bytes,djlsr_bytes)):
                self._check();self._zip(name,raw);self._check()
            inputs=();toolchain_bytes=djcrx_bytes=djdev_bytes=djlsr_bytes=None;raw=None
            self._check();self._observer.prepare();self._phase='materialize-consumed'
            for role in SELECTED:
                data,executable=selected.pop(role);self._write_role(role,data,executable);self._check()
            selected=None;data=None
            self._phase='observe-consumed';self._observer.before();self._check()
            self._observer.terminal('failure-final');self._check();self._phase='complete'
        except BaseException as error:
            self._latch(error);self._cleanup();self._phase='refused';raise
        finally:
            selected=None;self._busy=False
        return self.status()
    def status(self):
        if self._busy:self._enter()
        observed=self._observer.status()
        inner=observed['workspace']['directories']
        writer=observed['workspace']['writer']
        return {'phase':self._phase,'firstFailure':self._first,'secondary':self._secondary,'reentered':self._reentered,'closed':self._closed,
                'authenticatedArchives':{k:dict(v) for k,v in self._archives.items()},'writtenRoles':list(self._written),
                'runtimeOriginJoins':len(self._origins),'noticeCount':len(self._notices),'noticeBytes':self._notice_bytes,'noticeOmitted':self._notice_omitted,
                'noticeHashes':[dict(v) for v in self._notices.values()],
                'closeAttempted':self._close_attempted,'closeRefused':self._close_refused,'cleanupQualified':self._close_refused==0 and self._secondary is None and inner['closeRefused']==0 and inner['liveDirectories']==0 and inner['uncertainDirectories']==0 and observed['localCleanupQualified'] and (writer is None or writer['closeRefused']==0 and writer['outputCleanupQualified']),
                'observer':observed,'selectedNineMaterialized':len(self._written)==9,
                'fullToolchainReady':False,'inputFilesystemLeaseQualified':False,'sourceOwnedQualified':False,'parentTrustQualified':False,
                'licenseQualified':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
    def close(self):
        self._enter()
        try:
            if not self._closed:
                self._closed=True;self._phase='closed';self._cleanup()
        finally:self._busy=False
        return self.status()
