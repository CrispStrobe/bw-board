"""Checked protected builder derivative. Import executes definitions, never a build."""
import sys,pathlib,hashlib,types,importlib.util
sys.dont_write_bytecode=True
PARENT_MODULE_SHA256='3e6dc1b090942bca61e036878759dbb3649c9467633aea46c7cd272da3001662'
parent=pathlib.Path(__file__).resolve().with_name('ci-build-i80386-native-protected-ram.py')
assert hashlib.sha256(parent.read_bytes()).hexdigest()==PARENT_MODULE_SHA256,'unknown held protected builder module'
spec=importlib.util.spec_from_file_location('held_protected_builder',parent)
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
def derive_builder(raw):
 s=held.derive_builder(raw);base=hashlib.sha256(s.encode()).hexdigest();edits=[]
 def replace(old,new,count):
  nonlocal s
  assert s.count(old)==count,'exact stack build seam: '+old
  s=s.replace(old,new);edits.append((old,new,count))
 replace('bochs-cpu3-native-protected-ram/build-identity.mjs','bochs-cpu3-native-protected-stack/build-identity.mjs',3)
 for old,new in [('ci-build-i80386-native-protected-ram.py','ci-build-i80386-native-protected-stack.py'),('i80386-native-protected-ram-build.yml','i80386-native-protected-stack-build.yml'),('prepare-bochs-cpu3-native-protected-ram.mjs','prepare-bochs-cpu3-native-protected-stack.mjs'),('bw.native-protected-ram-build-context.v1','bw.native-protected-stack-build-context.v1'),('bw.native-protected-ram-build-receipt.v1','bw.native-protected-stack-build-receipt.v1')]:replace(old,new,1)
 replace('PROTECTED_RAM','PROTECTED_STACK',2)
 replace('protectedProfile','stackProfile',2)
 inverse=s
 for old,new,count in reversed(edits):
  assert inverse.count(new)==count,'exact stack builder inverse'
  inverse=inverse.replace(new,old)
 assert hashlib.sha256(inverse.encode()).hexdigest()==base
 return s
module=types.ModuleType('owned_stack_build_derivative');module.__dict__['__file__']=str(pathlib.Path(__file__).resolve())
exec(compile(derive_builder(held.held.parent.read_bytes()),str(parent),'exec'),module.__dict__)
regular=module.regular
validate_paths=module.validate_paths
if __name__=='__main__':module.main(sys.argv[1:])
