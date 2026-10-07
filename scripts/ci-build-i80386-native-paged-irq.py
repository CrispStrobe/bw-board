"""Exact held builder derivative; import defines functions and never builds."""
import sys,pathlib,hashlib,types,importlib.util
sys.dont_write_bytecode=True
PARENT_MODULE_SHA256='e73048577893d858f4fde72c77964c5a09150bdd535c875cbea55997d969a973'
parent=pathlib.Path(__file__).resolve().with_name('ci-build-i80386-native-paged-int-iret.py')
assert hashlib.sha256(parent.read_bytes()).hexdigest()==PARENT_MODULE_SHA256,'unknown paged INT builder parent'
spec=importlib.util.spec_from_file_location('held_int_builder_for_irq',parent)
held=importlib.util.module_from_spec(spec);spec.loader.exec_module(held)
def derive_builder(raw):
 s=held.derive_builder(raw);base=hashlib.sha256(s.encode()).hexdigest();edits=[]
 def replace(old,new,count):
  nonlocal s
  assert s.count(old)==count,'exact IRQ build seam: '+old
  s=s.replace(old,new);edits.append((old,new,count))
 replace('bochs-cpu3-native-paged-int-iret/build-identity.mjs','bochs-cpu3-native-paged-irq/build-identity.mjs',3)
 for old,new in [('ci-build-i80386-native-paged-int-iret.py','ci-build-i80386-native-paged-irq.py'),('i80386-native-paged-int-iret-build.yml','i80386-native-paged-irq-actual.yml'),('prepare-bochs-cpu3-native-paged-int-iret.mjs','prepare-bochs-cpu3-native-paged-irq.mjs'),('bw.native-paged-int-iret-build-context.v1','bw.native-paged-irq-build-context.v1'),('bw.native-paged-int-iret-build-receipt.v1','bw.native-paged-irq-build-receipt.v1')]:replace(old,new,1)
 replace('PAGED_INT_IRET','PAGED_IRQ',2)
 replace('pagedIntIretProfile','pagedIrqProfile',2)
 inverse=s
 for old,new,count in reversed(edits):
  assert inverse.count(new)==count,'exact IRQ builder inverse'
  inverse=inverse.replace(new,old)
 assert hashlib.sha256(inverse.encode()).hexdigest()==base
 return s
module=types.ModuleType('owned_paged_irq_build_derivative');module.__dict__['__file__']=str(pathlib.Path(__file__).resolve())
exec(compile(derive_builder(held.held.held.held.held.parent.read_bytes()),str(parent),'exec'),module.__dict__)
regular=module.regular
validate_paths=module.validate_paths
if __name__=='__main__':module.main(sys.argv[1:])
