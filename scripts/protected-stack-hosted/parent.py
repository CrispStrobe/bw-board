"""Narrow checked derivative of the qualified protected restore/lifecycle parent."""
import hashlib,sys
sys.dont_write_bytecode=True
from pathlib import Path
_PARENT=Path(__file__).resolve().parents[1]/'protected-ram-hosted/parent.py'
_PARENT_SHA='0723a9d6e6d171d4ea17e684be97e7413f235afff381e6e6a8fbb5bbdd57ec40'
_EDITS=[('protected-ram', 'protected-stack', 14), ('PROTECTED_RAM', 'PROTECTED_STACK', 2), ('protected-driver', 'protected-stack-driver', 1), ('protected-pristine', 'protected-stack-pristine', 1), ('protected-wrapper', 'protected-stack-wrapper', 1), ('be1b40aa0d9e1c3f29cf450db7a023e987b2d1c7', 'd065cbb7da787b4b46adab83958237a69c0b51de', 1), ('f13b830829a36163118113c3952ee9698bb9b1dd', 'f9c525b0a74f2b13eacdc0bdb6db1138da731120', 1), ('98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e', '4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439', 1), ('11283630476', '11296324286', 1), ('37149215092', '37186044543', 1), ('7658134', '7741154', 1), ('2cbbd3cfc3a9c0b918d2d03b522cfa502cd3da36a2e87b37150548c4e9f504bb', '867489bb0b97f0f19cf660b72f00ebdcae4f6cc6c326711b2d6f1df855e26311', 1), ("[('zipMembers',67),('compiledFiles',158),('preparedFiles',814),('driverFiles',66)]", "[('zipMembers',68),('compiledFiles',174),('preparedFiles',816),('driverFiles',67)]", 1), ("ROOT/'scripts/cold-native-diagnostic/resources.py']", "ROOT/'scripts/cold-native-diagnostic/resources.py',ROOT/'scripts/protected-ram-hosted/parent.py']", 1), ('original158 identity', 'original174 identity', 1), ('original814 prepared map', 'original816 prepared map', 1), ('actual full66 driver authority', 'actual full67 driver authority', 1), ("'compiledCount':158,'preparedCount':814,'driverCount':66", "'compiledCount':174,'preparedCount':816,'driverCount':67", 1), ("['reset','after-LGDT','PE-enabled','entered-protected-RAM','after-RAM-MOV']", "['reset','after-LGDT','PE-enabled','entered-protected-RAM','after-DS-load','after-SS-load','stack-ready','after-PUSH','after-POP','entered-CALL','callee-MOV','returned-CALL','before-HLT']", 1), ('five actual milestones', 'thirteen actual milestones', 1), ("if __name__=='__main__':", 'if False: # definition-only checked source derivative', 1)]
def derive_parent(raw):
 assert hashlib.sha256(raw).hexdigest()==_PARENT_SHA,'exact qualified protected parent'
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
