#!/usr/bin/env python3
"""Materialize seven exact source payloads and retain small hosted context; no control child."""
import datetime, hashlib, json, os, pathlib, platform, shutil, subprocess, sys
PACKET=pathlib.Path(__file__).resolve().parent
PUBLICATION=PACKET.parents[2]
ROOT=pathlib.Path(os.environ['BW_SPAN_ROOT']).resolve()
CONTEXT=pathlib.Path(os.environ['BW_SPAN_CONTEXT']).resolve()
NODE=pathlib.Path(os.environ['BW_SPAN_NODE']).resolve()
BASE='fe1eff2039520536350922a2164c8bbe29404c68'
BLANK=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def command(args):
 try:
  r=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,timeout=15)
  return {'command':args,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
 except Exception as e:return {'command':args,'error':type(e).__name__+': '+str(e)}
def write(name,value):(CONTEXT/name).write_text(json.dumps(value,indent=2)+'\n')
CONTEXT.mkdir(parents=True,exist_ok=True)
context={'recordedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'python':sys.version,'platform':platform.platform(),'logicalCPUs':os.cpu_count(),'blankEnvironment':{k:os.environ.get(k) for k in BLANK},'node':{'path':str(NODE),'expectedVersion':'22.23.3'},'publication':command(['git','-C',str(PUBLICATION),'rev-parse','HEAD']),'baseline':command(['git','-C',str(ROOT),'rev-parse','HEAD']),'helpers':{},'toolchain':{},'kernelFiles':{},'scope':'Source-control context only; no CPU attribution, throughput or native runtime evidence.'}
for path in (PACKET/'prepare-hosted.py',PACKET/'run-controls.py',PACKET/'source-binding.json',PUBLICATION/'.github/workflows/i80386-owned-span-source-controls.yml'):
 try:context['helpers'][str(path.relative_to(PUBLICATION))]=sha(path)
 except Exception as e:context['helpers'][str(path)]={'error':str(e)}
try:context['node']['sha256']=sha(NODE)
except Exception as e:context['node']['error']=str(e)
for name in ('as','ld','objcopy','nm','objdump'):
 path=shutil.which(name);context['toolchain'][name]=command([path,'--version']) if path else {'missing':True}
for name in ('/proc/loadavg','/proc/meminfo','/proc/pressure/cpu','/proc/pressure/memory','/sys/fs/cgroup/cpu.max'):
 try:context['kernelFiles'][name]=pathlib.Path(name).read_text()
 except Exception as e:context['kernelFiles'][name]={'error':type(e).__name__+': '+str(e)}
write('context.json',context)
material={'status':'SOURCE_PAYLOAD_MATERIALIZATION_PENDING','baselineRevision':BASE,'sourcePayloads':{},'sourceDestination':str(ROOT)}
try:
 if any(os.environ.get(k) for k in BLANK):raise RuntimeError('blank six environment variables required')
 if context['baseline'].get('exitCode')!=0 or context['baseline']['stdout'].strip()!=BASE:raise RuntimeError('separate checkout must be exact fe1')
 binding=json.loads((PACKET/'source-binding.json').read_text())
 if binding['baseRevision']!=BASE or len(binding['newFiles'])!=7 or len(binding['baselineSourceHashes'])!=103:raise RuntimeError('exact source binding shape')
 if sha(PACKET/'run-controls.py')!=binding['wrapper']['sha256']:raise RuntimeError('wrapper binding mismatch')
 if sha(NODE)!=binding['node']['sha256']:raise RuntimeError('Node22.23.3 binary binding mismatch')
 sources=[]
 for name,h in binding['newFiles'].items():
  path=pathlib.PurePosixPath(name)
  if str(path.parent)!='scripts/bochs-cpu3-native-owned-span':raise RuntimeError('payload destination outside private source folder')
  source=PACKET/'payload'/(path.name+'.payload');data=source.read_bytes()
  if hashlib.sha256(data).hexdigest()!=h:raise RuntimeError('payload SHA mismatch: '+name)
  sources.append((name,h,data));material['sourcePayloads'][name]=h
 for name,h,data in sources:
  target=ROOT/name;target.parent.mkdir(parents=True,exist_ok=True)
  with target.open('xb') as stream:stream.write(data)
  if sha(target)!=h:raise RuntimeError('materialized SHA mismatch: '+name)
 material['status']='SEVEN_SOURCE_PAYLOADS_MATERIALIZED_BYTE_EXACT_NO_CONTROL_CHILD'
except Exception as e:
 material['status']='SOURCE_PAYLOAD_MATERIALIZATION_FAILED_NO_CONTROL_CHILD';material['error']=type(e).__name__+': '+str(e)
finally:write('materialization.json',material)
print(json.dumps(material))
raise SystemExit(0 if material['status']=='SEVEN_SOURCE_PAYLOADS_MATERIALIZED_BYTE_EXACT_NO_CONTROL_CHILD' else 1)
