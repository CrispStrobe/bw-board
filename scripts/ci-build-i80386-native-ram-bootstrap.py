"""Exact build-only helper derivative. Importing this file performs no build."""
import sys,pathlib,hashlib,types
sys.dont_write_bytecode=True
PARENT_SHA256='0c951ee68c227fc290287170ad87b53a5370641c77b691e38278b86486f42a47'
def derive_builder(raw):
 assert hashlib.sha256(raw).hexdigest()==PARENT_SHA256,'unknown cold build helper'
 s=raw.decode();edits=[]
 def replace(old,new,count):
  nonlocal s
  assert s.count(old)==count,'exact build helper seams: '+old
  s=s.replace(old,new);edits.append((old,new,count))
 replace('bochs-cpu3-native-cold-bios/identity.mjs','bochs-cpu3-native-ram-bootstrap/build-identity.mjs',3)
 replace('cold-bios','ram-bootstrap',5)
 replace('COLD_BIOS','RAM_BOOTSTRAP',2)
 replace('coldProfile','ramProfile',2)
 inverse=s
 for old,new,count in reversed(edits):
  assert inverse.count(new)==count,'exact inverse seams'
  inverse=inverse.replace(new,old)
 assert hashlib.sha256(inverse.encode()).hexdigest()==PARENT_SHA256
 return s
# Only definitions/top-level immutable constants execute here; original main stays closed.
parent=pathlib.Path(__file__).resolve().with_name('ci-build-i80386-native-cold-bios.py')
module=types.ModuleType('owned_ram_build_derivative');module.__dict__['__file__']=str(pathlib.Path(__file__).resolve())
exec(compile(derive_builder(parent.read_bytes()),str(parent),'exec'),module.__dict__)
regular=module.regular
validate_paths=module.validate_paths
if __name__=='__main__':module.main(sys.argv[1:])
