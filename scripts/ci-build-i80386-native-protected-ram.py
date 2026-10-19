"""Checked RAM build helper derivative. Import performs no preparation/build."""
import sys,pathlib,hashlib,types,importlib.util
sys.dont_write_bytecode=True
PARENT_MODULE_SHA256='b96d9527dc6a00bc38f711b27a1075382fea4a186da0f8e95a6668c853c61dd5'
parent=pathlib.Path(__file__).resolve().with_name('ci-build-i80386-native-ram-bootstrap.py')
assert hashlib.sha256(parent.read_bytes()).hexdigest()==PARENT_MODULE_SHA256,'unknown held RAM builder module'
spec=importlib.util.spec_from_file_location('held_ram_builder',parent)
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
def derive_builder(raw):
 s=held.derive_builder(raw);base=hashlib.sha256(s.encode()).hexdigest();edits=[]
 def replace(old,new,count):
  nonlocal s
  assert s.count(old)==count,'exact protected build seam: '+old
  s=s.replace(old,new);edits.append((old,new,count))
 replace('bochs-cpu3-native-ram-bootstrap/build-identity.mjs','bochs-cpu3-native-protected-ram/build-identity.mjs',3)
 for old,new in [('ci-build-i80386-native-ram-bootstrap.py','ci-build-i80386-native-protected-ram.py'),('i80386-native-ram-bootstrap-build.yml','i80386-native-protected-ram-build.yml'),('prepare-bochs-cpu3-native-ram-bootstrap.mjs','prepare-bochs-cpu3-native-protected-ram.mjs'),('bw.native-ram-bootstrap-build-context.v1','bw.native-protected-ram-build-context.v1'),('bw.native-ram-bootstrap-build-receipt.v1','bw.native-protected-ram-build-receipt.v1')]:replace(old,new,1)
 replace('RAM_BOOTSTRAP','PROTECTED_RAM',2)
 replace('ramProfile','protectedProfile',2)
 inverse=s
 for old,new,count in reversed(edits):
  assert inverse.count(new)==count,'exact protected builder inverse'
  inverse=inverse.replace(new,old)
 assert hashlib.sha256(inverse.encode()).hexdigest()==base
 return s
module=types.ModuleType('owned_protected_build_derivative');module.__dict__['__file__']=str(pathlib.Path(__file__).resolve())
exec(compile(derive_builder(held.parent.read_bytes()),str(parent),'exec'),module.__dict__)
regular=module.regular
validate_paths=module.validate_paths
if __name__=='__main__':module.main(sys.argv[1:])
