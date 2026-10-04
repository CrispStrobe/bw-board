"""Checked INT builder derivative. Import defines functions, never a build."""
import sys,pathlib,hashlib,types,importlib.util
sys.dont_write_bytecode=True
PARENT_MODULE_SHA256='55585420cb404908f0b7c9b5a657df54a1162692d9c2f7ca022cd8d7b7626648'
parent=pathlib.Path(__file__).resolve().with_name('ci-build-i80386-native-nonidentity-paging.py')
assert hashlib.sha256(parent.read_bytes()).hexdigest()==PARENT_MODULE_SHA256,'unknown held paging builder module'
spec=importlib.util.spec_from_file_location('held_paging_builder',parent)
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
def derive_builder(raw):
 s=held.derive_builder(raw);base=hashlib.sha256(s.encode()).hexdigest();edits=[]
 def replace(old,new,count):
  nonlocal s
  assert s.count(old)==count,'exact INT build seam: '+old
  s=s.replace(old,new);edits.append((old,new,count))
 replace('bochs-cpu3-native-nonidentity-paging/build-identity.mjs','bochs-cpu3-native-paged-int-iret/build-identity.mjs',3)
 for old,new in [('ci-build-i80386-native-nonidentity-paging.py','ci-build-i80386-native-paged-int-iret.py'),('i80386-native-nonidentity-paging-build.yml','i80386-native-paged-int-iret-build.yml'),('prepare-bochs-cpu3-native-nonidentity-paging.mjs','prepare-bochs-cpu3-native-paged-int-iret.mjs'),('bw.native-nonidentity-paging-build-context.v1','bw.native-paged-int-iret-build-context.v1'),('bw.native-nonidentity-paging-build-receipt.v1','bw.native-paged-int-iret-build-receipt.v1')]:replace(old,new,1)
 replace('NONIDENTITY_PAGING','PAGED_INT_IRET',2)
 replace('nonidentityPagingProfile','pagedIntIretProfile',2)
 inverse=s
 for old,new,count in reversed(edits):
  assert inverse.count(new)==count,'exact INT builder inverse'
  inverse=inverse.replace(new,old)
 assert hashlib.sha256(inverse.encode()).hexdigest()==base
 return s
module=types.ModuleType('owned_int_iret_build_derivative');module.__dict__['__file__']=str(pathlib.Path(__file__).resolve())
exec(compile(derive_builder(held.held.held.held.parent.read_bytes()),str(parent),'exec'),module.__dict__)
regular=module.regular
validate_paths=module.validate_paths
if __name__=='__main__':module.main(sys.argv[1:])
