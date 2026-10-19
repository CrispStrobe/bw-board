"""Fixed paging restore/lifecycle derivative. Definition imports never run setup."""
import hashlib,sys
sys.dont_write_bytecode=True
from pathlib import Path
_PARENT=Path(__file__).resolve().parents[1]/'protected-stack-hosted/parent.py'
_PARENT_SHA='2ebfb2e1c550beca26860c1aa55b2da0159b04f6326b87868722d42ffbe80173'
_EDITS=[('protected-stack', 'nonidentity-paging', 4), ('PROTECTED_STACK', 'NONIDENTITY_PAGING', 1), ('d065cbb7da787b4b46adab83958237a69c0b51de', '0333f5aca42bf60fa37c64bb574aee7084f9251c', 1), ('f9c525b0a74f2b13eacdc0bdb6db1138da731120', '8df2dd7d6b88648b3fcedb6dd559e0dfc5daeb54', 1), ('4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439', 'f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7', 1), ('11296324286', '11304715346', 1), ('37186044543', '37204425504', 1), ('7741154', '7876937', 1), ('867489bb0b97f0f19cf660b72f00ebdcae4f6cc6c326711b2d6f1df855e26311', '4bea83a8bde6af8003391b65e702c9520d707fc15cb950c7787fb4836bb63ccf', 1), ("[('zipMembers',68),('compiledFiles',174),('preparedFiles',816),('driverFiles',67)]", "[('zipMembers',69),('compiledFiles',192),('preparedFiles',818),('driverFiles',70)]", 1), ("ROOT/'scripts/protected-ram-hosted/parent.py']", "ROOT/'scripts/protected-ram-hosted/parent.py',ROOT/'scripts/protected-stack-hosted/parent.py']", 1), ('original174 identity', 'original192 identity', 1), ('original816 prepared map', 'original818 prepared map', 1), ('actual full67 driver authority', 'actual full70 driver authority', 1), ("'compiledCount':174,'preparedCount':816,'driverCount':67", "'compiledCount':192,'preparedCount':818,'driverCount':70", 1), ("['reset','after-LGDT','PE-enabled','entered-protected-RAM','after-DS-load','after-SS-load','stack-ready','after-PUSH','after-POP','entered-CALL','callee-MOV','returned-CALL','before-HLT']", "['reset','after-LGDT','CR3-ready','PE-enabled','DS-ready','PG-enabled','entered-paged-code','after-code-fetch','after-data-read','after-data-write','before-HLT']", 1), ('thirteen actual milestones', 'eleven actual milestones', 1), ('_PARENT', '_HELD_STACK_PARENT', 4), ('_EDITS', '_HELD_STACK_EDITS', 3), ('derive_parent', 'derive_stack_parent', 2), ("\nif __name__=='__main__':\n", '\nif False: # definition-only held stack derivative\n', 1)]
def derive_parent(raw):
 assert hashlib.sha256(raw).hexdigest()==_PARENT_SHA,'exact held stack parent'
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
