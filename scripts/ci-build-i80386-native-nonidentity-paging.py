"""Checked paging builder derivative. Import defines functions, never a build."""
import sys,pathlib,hashlib,types,importlib.util
sys.dont_write_bytecode=True
PARENT_MODULE_SHA256='6b62ef34d89e041f81b20752a6d9d6a2844511f9b86a6da8410acbc004767316'
parent=pathlib.Path(__file__).resolve().with_name('ci-build-i80386-native-protected-stack.py')
assert hashlib.sha256(parent.read_bytes()).hexdigest()==PARENT_MODULE_SHA256,'unknown held stack builder module'
spec=importlib.util.spec_from_file_location('held_stack_builder',parent)
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
def derive_builder(raw):
 s=held.derive_builder(raw);base=hashlib.sha256(s.encode()).hexdigest();edits=[]
 def replace(old,new,count):
  nonlocal s
  assert s.count(old)==count,'exact paging build seam: '+old
  s=s.replace(old,new);edits.append((old,new,count))
 replace('bochs-cpu3-native-protected-stack/build-identity.mjs','bochs-cpu3-native-nonidentity-paging/build-identity.mjs',3)
 for old,new in [('ci-build-i80386-native-protected-stack.py','ci-build-i80386-native-nonidentity-paging.py'),('i80386-native-protected-stack-build.yml','i80386-native-nonidentity-paging-build.yml'),('prepare-bochs-cpu3-native-protected-stack.mjs','prepare-bochs-cpu3-native-nonidentity-paging.mjs'),('bw.native-protected-stack-build-context.v1','bw.native-nonidentity-paging-build-context.v1'),('bw.native-protected-stack-build-receipt.v1','bw.native-nonidentity-paging-build-receipt.v1')]:replace(old,new,1)
 replace('PROTECTED_STACK','NONIDENTITY_PAGING',2)
 replace('stackProfile','nonidentityPagingProfile',2)
 inverse=s
 for old,new,count in reversed(edits):
  assert inverse.count(new)==count,'exact paging builder inverse'
  inverse=inverse.replace(new,old)
 assert hashlib.sha256(inverse.encode()).hexdigest()==base
 return s
module=types.ModuleType('owned_paging_build_derivative');module.__dict__['__file__']=str(pathlib.Path(__file__).resolve())
exec(compile(derive_builder(held.held.held.parent.read_bytes()),str(parent),'exec'),module.__dict__)
regular=module.regular
validate_paths=module.validate_paths
if __name__=='__main__':module.main(sys.argv[1:])
