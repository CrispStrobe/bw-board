"""Fixed reported aliases, inventory-only; no physical alias materialization."""
import hashlib
from pathlib import Path
import types

BASE_SHA = 'da0dee52d70b47381f9673272411d5441530186d4f2c85fe18cf2e3d4063e08b'
ORIGINAL_ZIP_SHA = 'd04c1687840ce256c3a1dc652be3cc6ab3cab02bf677a9038fdecd3ca061ff05'
ORIGINAL_REPORT_SHA = '83766cf66299adbf77feadb22295420f74834c66450674ea4851825da630e265'
REVIEWED_INVENTORY_SHA = '7e6c07180ce9cef3def8f048cd22490f8ea98911490af2bddd16a57bd8f3cf36'

def _load_base():
    path = Path(__file__).parent.parent / 'i80386-cwsdpmi-retained-tool-materializer/materialize.py'
    with path.open('rb') as stream:
        raw = stream.read(65537)
    if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != BASE_SHA:
        raise ValueError('fixed-materializer-source-refused')
    module = types.ModuleType('private_fixed_alias_base')
    module.__file__ = str(path)
    exec(compile(raw, '<fixed-selected-materializer>', 'exec'), module.__dict__)
    return module

base = _load_base()
ALIASES = {'djgpp/i586-pc-msdosdjgpp/bin/ld.bfd': 'djgpp/i586-pc-msdosdjgpp/bin/ld', 'djgpp/bin/i586-pc-msdosdjgpp-ar': 'djgpp/i586-pc-msdosdjgpp/bin/ar', 'djgpp/bin/i586-pc-msdosdjgpp-ld.bfd': 'djgpp/i586-pc-msdosdjgpp/bin/ld', 'djgpp/bin/i586-pc-msdosdjgpp-as': 'djgpp/i586-pc-msdosdjgpp/bin/as', 'djgpp/bin/i586-pc-msdosdjgpp-objdump': 'djgpp/i586-pc-msdosdjgpp/bin/objdump', 'djgpp/bin/i586-pc-msdosdjgpp-strip': 'djgpp/i586-pc-msdosdjgpp/bin/strip', 'djgpp/bin/i586-pc-msdosdjgpp-objcopy': 'djgpp/i586-pc-msdosdjgpp/bin/objcopy', 'djgpp/bin/i586-pc-msdosdjgpp-readelf': 'djgpp/i586-pc-msdosdjgpp/bin/readelf', 'djgpp/bin/i586-pc-msdosdjgpp-nm': 'djgpp/i586-pc-msdosdjgpp/bin/nm', 'djgpp/bin/i586-pc-msdosdjgpp-c++': 'djgpp/bin/i586-pc-msdosdjgpp-g++', 'djgpp/bin/i586-pc-msdosdjgpp-ranlib': 'djgpp/i586-pc-msdosdjgpp/bin/ranlib', 'djgpp/bin/i586-pc-msdosdjgpp-ld': 'djgpp/i586-pc-msdosdjgpp/bin/ld', 'djgpp/bin/i586-pc-msdosdjgpp-gcc-12.2.0': 'djgpp/bin/i586-pc-msdosdjgpp-gcc'}
TARGETS = {'djgpp/i586-pc-msdosdjgpp/bin/ld': (5344728, '99f2e74294e340136f3345982f6c95f59431a75abbc01734552e63a84b9cfc65'), 'djgpp/i586-pc-msdosdjgpp/bin/ar': (4237168, 'e1df63d1b2c6af55c02a2376381ea9c83e0e86c3990fdfa4f9b9b3a9a7b417df'), 'djgpp/i586-pc-msdosdjgpp/bin/as': (7226672, '41dda143ed208ffeb62722e0963193b0a2450bdd0aa00c5bd394115e3b2eef24'), 'djgpp/i586-pc-msdosdjgpp/bin/objdump': (7243584, '347da6d6fac6115a2d15fc7340a5e745fa0b5dc34e7d404f09d25f3d793956ec'), 'djgpp/i586-pc-msdosdjgpp/bin/strip': (5190944, '3650a1785d86f5002b8f862bd636e910b2c687ec84a5656eee4abfbf622377fb'), 'djgpp/i586-pc-msdosdjgpp/bin/objcopy': (5190952, '0cbbbeb17a0bf0b959fc7c8d1c86b184071885f685af78f2fc510689f500df46'), 'djgpp/i586-pc-msdosdjgpp/bin/readelf': (2008248, 'f070eb276d4b035dba538bb270e6b5abb6b806698a4446fc451239ced70e32d2'), 'djgpp/i586-pc-msdosdjgpp/bin/nm': (4052728, 'aec57757080e5a7ae127f7da83d2b7b57de2187cb49acefe11e82da1a8095097'), 'djgpp/bin/i586-pc-msdosdjgpp-g++': (1264432, '43447434c2bdd5070333c669057cf01a3cdc6ba779ef15a9c932b5c9eb7044c4'), 'djgpp/i586-pc-msdosdjgpp/bin/ranlib': (4237200, '7cc8dfbe975c0d931a9e2300d032fcd10a495097eaf57d3601cb9ca16fee5e4f'), 'djgpp/bin/i586-pc-msdosdjgpp-gcc': (1260336, 'afd20f428ccb032b21f00832587219d236efde25344c8067f820b1e677d0799f')}

class FixedAliasMaterializer(base.RetainedToolMaterializer):
    def __init__(self, parent):
        super().__init__(parent)
        self._aliases_seen = set()
        self._targets_seen = {}

    def _tar(self,raw):
        reader=base._BZ2Reader(raw);seen={};required=set();selected={};selected_total=0;declared=0;members=0
        bypath={relative:role for role,(relative,digest) in base.SELECTED.items()}
        try:
            while True:
                self._check();header=reader.exact(512);self._check()
                if header==b'\x00'*512:
                    base.need(reader.exact(512)==b'\x00'*512,'archive-refused');self._check()
                    while True:
                        trailing=reader.read(65536);self._check()
                        if not trailing:break
                        base.need(not any(trailing),'archive-refused')
                    break
                members+=1;base.need(members<=base.MAX_MEMBERS,'archive-cap')
                base.need(base._octal(header[148:156])==sum(header[:148])+8*32+sum(header[156:]),'archive-refused')
                base.need(header[257:263] in (b'ustar\x00',b'ustar '),'archive-type')
                name=base._name(header[:100]);prefix=base._name(header[345:500])
                if prefix:name=prefix+'/'+name
                kind=header[156:157];extent=base._octal(header[124:136]);mode=base._octal(header[100:108])
                base.need(kind in (b'\x00',b'0',b'5',b'1') and not mode&0o6000,'archive-type')
                if name in ('.','./') and kind==b'5':name='.'
                else:
                    base.need(kind==b'5' or not name.endswith('/'),'archive-type')
                    name=base.canonical(name)
                base.inventory_add(seen,required,name,kind==b'5')
                linkname=base._name(header[157:257])
                if kind==b'1':
                    base.need(extent==0 and name in ALIASES and not linkname.endswith('/'),'archive-type')
                    target=base.canonical(linkname)
                    base.need(target==ALIASES[name] and target in TARGETS and self._targets_seen.get(target)==TARGETS[target],'archive-type')
                    self._aliases_seen.add(name)
                    continue
                base.need(name not in ALIASES and not linkname,'archive-type')
                base.need(name not in TARGETS or kind in (b'\x00',b'0'),'archive-type')
                if kind==b'5':base.need(extent==0,'archive-type');continue
                base.need(extent<=base.MAX_FILE and declared+extent<=base.MAX_DECODED,'archive-cap');declared+=extent
                role=bypath.get(name)
                if name in TARGETS:base.need(extent==TARGETS[name][0],'archive-type')
                if role is not None:
                    base.need(0<extent<=base.MAX_ROLE and selected_total+extent<=base.MAX_SELECTED,'selected-refused')
                    selected_total+=extent # Consumed before body read.
                keep=role is not None or extent<=base.MAX_NOTICE
                data=bytearray() if keep else None;digest=hashlib.sha256();remaining=extent
                while remaining:
                    self._check();block=reader.exact(min(65536,remaining));self._check();remaining-=len(block);digest.update(block)
                    if data is not None:data.extend(block)
                if extent%512:reader.exact(512-extent%512);self._check()
                if name in TARGETS:
                    base.need(digest.hexdigest()==TARGETS[name][1],'archive-type')
                    self._targets_seen[name]=(extent,digest.hexdigest())
                if role is not None:
                    base.need(digest.hexdigest()==base.SELECTED[role][1],'selected-refused')
                    selected[role]=(bytes(data),bool(mode&0o111))
                self._notice('toolchain',name,None if data is None else bytes(data))
            base.need(set(selected)==set(base.SELECTED),'selected-refused')
            base.need(self._aliases_seen==set(ALIASES) and set(self._targets_seen)==set(TARGETS),'archive-type')
            self._decoded=reader.decoded
            return selected
        finally:reader.clear()

    def status(self):
        result = super().status()
        result.update({'validatedAliasCount': len(self._aliases_seen),
                       'validatedAliasTargetCount': len(self._targets_seen),
                       'aliasInventoryProvenance': {'originalZipSha256': ORIGINAL_ZIP_SHA,
                                                    'originalReportSha256': ORIGINAL_REPORT_SHA,
                                                    'reviewedInventorySha256': REVIEWED_INVENTORY_SHA},
                       'physicalAliasesMaterialized': False,
                       'rawArchiveCompatibilityQualified': False})
        return result
