"""Pinned GNU L-only name extension; selected tools and compiler policy unchanged."""
import hashlib
from pathlib import Path
import types
DIAGNOSTIC_SHA='3a1feaca963805bc58b1a5f32c54c5d973c95e770db909c1c135dd5a35330628'
path=Path(__file__).parent.parent/'i80386-cwsdpmi-archive-refusal-diagnostic/materialize.py'
with path.open('rb') as stream:raw=stream.read(65537)
if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=DIAGNOSTIC_SHA:raise ValueError('gnu-longname-source-refused')
old=types.ModuleType('private_gnu_diagnostic');old.__file__=str(path)
exec(compile(raw,'<pinned-archive-diagnostic>','exec'),old.__dict__)
base=old.base
BASE_SHA=old.BASE_SHA
ALIAS_SHA=old.ALIAS_SHA
ALIASES=old.ALIASES
TARGETS=old.TARGETS
ORIGINAL_ZIP_SHA=old.ORIGINAL_ZIP_SHA
ORIGINAL_REPORT_SHA=old.ORIGINAL_REPORT_SHA
REVIEWED_INVENTORY_SHA=old.REVIEWED_INVENTORY_SHA
class FixedAliasMaterializer(old.FixedAliasMaterializer):
    def __init__(self,parent):
        super().__init__(parent)
        self._gnu_headers=0;self._gnu_applied=0;self._gnu_pending=False
    def _tar(self,raw):
        reader=base._BZ2Reader(raw);seen={};required=set();selected={};selected_total=0;declared=0;members=0;pending=None
        bypath={relative:role for role,(relative,digest) in base.SELECTED.items()}
        try:
            while True:
                self._header_offset=reader.decoded-len(reader.buffer)
                self._check();header=reader.exact(512);self._check()
                if header!=b'\x00'*512:
                    self._header_ordinal=members+1;self._type_byte=header[156];self._magic_class='ustar-posix' if header[257:263]==b'ustar\x00' else ('ustar-gnu' if header[257:263]==b'ustar ' else 'other')
                if header==b'\x00'*512:
                    self._rule('gnu-longname-orphan',pending is None,'archive-type')
                    self._rule('end-block',reader.exact(512)==b'\x00'*512,'archive-refused');self._check()
                    while True:
                        trailing=reader.read(65536);self._check()
                        if not trailing:break
                        self._rule('trailing-data',not any(trailing),'archive-refused')
                    break
                members+=1;self._rule('member-cap',members<=base.MAX_MEMBERS,'archive-cap')
                self._rule('checksum',self._number('checksum-number',header[148:156])==sum(header[:148])+8*32+sum(header[156:]),'archive-refused')
                self._rule('magic',header[257:263] in (b'ustar\x00',b'ustar '),'archive-type')
                name=base._name(header[:100]);prefix=base._name(header[345:500])
                if prefix:name=prefix+'/'+name
                kind=header[156:157];extent=self._number('extent-number',header[124:136]);mode=self._number('mode-number',header[100:108])
                if kind==b'L':
                    self._rule('gnu-longname-pending',pending is None,'archive-type')
                    self._rule('gnu-longname-header',header[257:263]==b'ustar ' and name=='././@LongLink' and not prefix and not base._name(header[157:257]),'archive-type')
                    self._rule('gnu-longname-mode',not mode&0o6000,'archive-type')
                    self._rule('gnu-longname-extent',2<=extent<=241 and declared+extent<=base.MAX_DECODED,'archive-cap')
                    declared+=extent # Metadata content reserved before read; all decoded bytes remain capped.
                    self._check();payload=reader.exact(extent);self._check()
                    self._rule('gnu-longname-nul',payload[-1:]==b'\x00' and b'\x00' not in payload[:-1],'archive-path')
                    self._rule('gnu-longname-ascii',all(32<=c<127 for c in payload[:-1]),'archive-path')
                    pending=payload[:-1].decode('ascii')
                    self._rule('gnu-longname-path',len(pending)<=240,'archive-path')
                    base.canonical(pending) # Existing absolute/colon/dotdot/slash/path rules apply unchanged.
                    self._check();padding=reader.exact(512-extent%512);self._check()
                    self._rule('gnu-longname-padding',not any(padding),'archive-refused')
                    self._gnu_headers+=1;self._gnu_pending=True
                    continue
                self._rule('type-or-mode',kind in (b'\x00',b'0',b'5',b'1') and not mode&0o6000,'archive-type')
                if pending is not None:
                    self._rule('gnu-longname-placeholder',not prefix and name==pending[:100],'archive-path')
                    name=pending;pending=None;self._gnu_pending=False;self._gnu_applied+=1
                if name in ('.','./') and kind==b'5':name='.'
                else:
                    self._rule('file-trailing-slash',kind==b'5' or not name.endswith('/'),'archive-type')
                    name=base.canonical(name)
                base.inventory_add(seen,required,name,kind==b'5')
                linkname=base._name(header[157:257])
                if kind==b'1':
                    self._rule('hardlink-header',extent==0 and name in ALIASES and not linkname.endswith('/'),'archive-type')
                    target=base.canonical(linkname)
                    self._rule('hardlink-target',target==ALIASES[name] and target in TARGETS and self._targets_seen.get(target)==TARGETS[target],'archive-type')
                    self._aliases_seen.add(name)
                    continue
                self._rule('ordinary-link',name not in ALIASES and not linkname,'archive-type')
                self._rule('target-type',name not in TARGETS or kind in (b'\x00',b'0'),'archive-type')
                if kind==b'5':self._rule('directory-size',extent==0,'archive-type');continue
                self._rule('declared-cap',extent<=base.MAX_FILE and declared+extent<=base.MAX_DECODED,'archive-cap');declared+=extent
                role=bypath.get(name)
                if name in TARGETS:self._rule('target-extent',extent==TARGETS[name][0],'archive-type')
                if role is not None:
                    self._rule('selected-extent',0<extent<=base.MAX_ROLE and selected_total+extent<=base.MAX_SELECTED,'selected-refused')
                    selected_total+=extent # Consumed before body read.
                keep=role is not None or extent<=base.MAX_NOTICE
                data=bytearray() if keep else None;digest=hashlib.sha256();remaining=extent
                while remaining:
                    self._check();block=reader.exact(min(65536,remaining));self._check();remaining-=len(block);digest.update(block)
                    if data is not None:data.extend(block)
                if extent%512:reader.exact(512-extent%512);self._check()
                if name in TARGETS:
                    self._rule('target-hash',digest.hexdigest()==TARGETS[name][1],'archive-type')
                    self._targets_seen[name]=(extent,digest.hexdigest())
                if role is not None:
                    self._rule('selected-hash',digest.hexdigest()==base.SELECTED[role][1],'selected-refused')
                    selected[role]=(bytes(data),bool(mode&0o111))
                self._notice('toolchain',name,None if data is None else bytes(data))
            self._rule('selected-set',set(selected)==set(base.SELECTED),'selected-refused')
            self._rule('alias-target-set',self._aliases_seen==set(ALIASES) and set(self._targets_seen)==set(TARGETS),'archive-type')
            self._decoded=reader.decoded
            return selected
        finally:reader.clear()

    def status(self):
        result=super().status()
        result.update(gnuLongNameHeaders=self._gnu_headers,gnuLongNameNamesApplied=self._gnu_applied,gnuLongNamePending=self._gnu_pending)
        return result
