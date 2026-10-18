"""Diagnostic-only derivative: parser acceptance unchanged; no raw header disclosure."""
import hashlib
from pathlib import Path
import types
ALIAS_SHA='7a687a916d65fd6614bb3a3676d2ca32c7f2a375deabc8d690f2ad1bb2e2ccf6'
path=Path(__file__).parent.parent/'i80386-cwsdpmi-fixed-alias-materializer/materialize.py'
with path.open('rb') as stream:raw=stream.read(65537)
if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=ALIAS_SHA:raise ValueError('diagnostic-source-refused')
old=types.ModuleType('private_diagnostic_alias');old.__file__=str(path)
exec(compile(raw,'<fixed-alias-source>','exec'),old.__dict__)
base=old.base
BASE_SHA=old.BASE_SHA
ALIASES=old.ALIASES
TARGETS=old.TARGETS
ORIGINAL_ZIP_SHA=old.ORIGINAL_ZIP_SHA
ORIGINAL_REPORT_SHA=old.ORIGINAL_REPORT_SHA
REVIEWED_INVENTORY_SHA=old.REVIEWED_INVENTORY_SHA
class FixedAliasMaterializer(old.FixedAliasMaterializer):
    def __init__(self,parent):
        super().__init__(parent)
        self._diagnostic=None
        self._header_ordinal=0;self._header_offset=0;self._type_byte=None;self._magic_class='unknown'
    def _latch_rule(self,reason):
        if self._diagnostic is None:
            self._diagnostic={'schema':'bw.archive-first-refusal.v1','reason':reason,'headerOrdinal':self._header_ordinal,'decodedOffset':self._header_offset,'typeByte':self._type_byte,'magicClass':self._magic_class}
    def _rule(self,reason,ok,code):
        if not ok:self._latch_rule(reason)
        base.need(ok,code)
    def _number(self,reason,field):
        try:return base._octal(field)
        except BaseException:
            self._latch_rule(reason)
            raise
    def _tar(self,raw):
        reader=base._BZ2Reader(raw);seen={};required=set();selected={};selected_total=0;declared=0;members=0
        bypath={relative:role for role,(relative,digest) in base.SELECTED.items()}
        try:
            while True:
                self._header_offset=reader.decoded-len(reader.buffer)
                self._check();header=reader.exact(512);self._check()
                if header!=b'\x00'*512:
                    self._header_ordinal=members+1;self._type_byte=header[156];self._magic_class='ustar-posix' if header[257:263]==b'ustar\x00' else ('ustar-gnu' if header[257:263]==b'ustar ' else 'other')
                if header==b'\x00'*512:
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
                self._rule('type-or-mode',kind in (b'\x00',b'0',b'5',b'1') and not mode&0o6000,'archive-type')
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
        result["archiveRefusalDiagnostic"]=None if self._diagnostic is None else dict(self._diagnostic)
        return result
