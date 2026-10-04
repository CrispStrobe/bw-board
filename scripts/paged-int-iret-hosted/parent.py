"""Fixed INT/IRET restore/lifecycle derivative. Definition imports never run setup."""
import hashlib,sys
sys.dont_write_bytecode=True
from pathlib import Path
_PARENT=Path(__file__).resolve().parents[1]/'nonidentity-paging-hosted/parent.py'
_PARENT_SHA='6e4e1a3cf315c577ec4e6f73480c47558bcac6a6e3265c5fb4769907af23d1c4'
_EDITS=[('nonidentity-paging', 'paged-int-iret', 1), ('NONIDENTITY_PAGING', 'PAGED_INT_IRET', 1), ('0333f5aca42bf60fa37c64bb574aee7084f9251c', '4a4ec3c92a67c4db6d3bd361f9456d2be144a13c', 1), ('8df2dd7d6b88648b3fcedb6dd559e0dfc5daeb54', '3f4a65de3cc4f99f62bf8f1d1c632499f3b69dd6', 1), ('f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7', '92a5121df194c6675303913ebd527e7d0253e29e686b2cbd8dd91fb579489b6f', 1), ('11304715346', '11309320742', 1), ('37204425504', '37218196080', 1), ('7876937', '8097621', 1), ('4bea83a8bde6af8003391b65e702c9520d707fc15cb950c7787fb4836bb63ccf', '4ac91409753cc618711107cf4fbff1ebb8c73c40295978eb4b6e798af3119a6c', 1), ("[('zipMembers',69),('compiledFiles',192),('preparedFiles',818),('driverFiles',70)]", "[('zipMembers',70),('compiledFiles',208),('preparedFiles',820),('driverFiles',80)]", 1), ("ROOT/'scripts/protected-stack-hosted/parent.py']", "ROOT/'scripts/protected-stack-hosted/parent.py',ROOT/'scripts/nonidentity-paging-hosted/parent.py']", 1), ('original192 identity', 'original208 identity', 1), ('original818 prepared map', 'original820 prepared map', 1), ('actual full70 driver authority', 'actual full80 driver authority', 1), ("'compiledCount':192,'preparedCount':818,'driverCount':70", "'compiledCount':208,'preparedCount':820,'driverCount':80", 1), ("['reset','after-LGDT','CR3-ready','PE-enabled','DS-ready','PG-enabled','entered-paged-code','after-code-fetch','after-data-read','after-data-write','before-HLT']", "['reset','after-LGDT','after-LIDT','CR3-ready','PE-enabled','DS-ready','SS-loaded','SP-ready','PG-enabled','entered-paged-code','before-INT','entered-handler','after-handler-MOV','returned-from-IRET-before-HLT']", 1), ('eleven actual milestones', 'fourteen actual milestones', 1), ('_PARENT=Path', '_HELD_PAGING_PARENT=Path', 1), ('_PARENT_SHA=', '_HELD_PAGING_PARENT_SHA=', 1), ('_EDITS=[', '_HELD_PAGING_EDITS=[', 1), ('def derive_parent(raw):', 'def derive_paging_parent(raw):', 1), ('==_PARENT_SHA,', '==_HELD_PAGING_PARENT_SHA,', 1), ('in _EDITS:', 'in _HELD_PAGING_EDITS:', 1), ('reversed(_EDITS)', 'reversed(_HELD_PAGING_EDITS)', 1), ('derive_parent(_PARENT.read_bytes())', 'derive_paging_parent(_HELD_PAGING_PARENT.read_bytes())', 1), ("\nif __name__=='__main__':\n", '\nif False: # definition-only held paging derivative\n', 1)]
def derive_parent(raw):
 assert hashlib.sha256(raw).hexdigest()==_PARENT_SHA,'exact held paging parent'
 text=raw.decode()
 for old,new,count in _EDITS:
  assert text.count(old)==count,('exact seam',old,count)
  text=text.replace(old,new)
 inverse=text
 for old,new,count in reversed(_EDITS):
  assert inverse.count(new)==count,('exact inverse seam',new,count)
  inverse=inverse.replace(new,old)
 assert inverse.encode()==raw,'byte-exact original inverse'
 return text
exec(compile(derive_parent(_PARENT.read_bytes()),__file__,'exec'),globals())
if __name__=='__main__':
 for signum in (signal.SIGTERM,signal.SIGINT):signal.signal(signum,interrupted)
 require(len(sys.argv)==2,'one explicit enable argument');main(sys.argv[1])
