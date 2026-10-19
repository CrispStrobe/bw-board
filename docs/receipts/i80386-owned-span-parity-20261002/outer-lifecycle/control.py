from pathlib import Path
import ast,json,hashlib,subprocess,os,signal,time,resource
D=Path(__file__).resolve().parent
H=Path('/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-native-parity-preparation-20261002/scripts/owned-span-parity-ci/run-cells.py')
h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
before=h(H);tree=ast.parse(H.read_text());defs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['kill_descendants','bounded_command']]
assert len(defs)==2
def persist(path,value):Path(path).write_text(json.dumps(value,indent=2)+'\n')
ns={'pathlib':__import__('pathlib'),'os':os,'signal':signal,'time':time,'subprocess':subprocess,'persist':persist}
exec(compile(ast.Module(body=defs,type_ignores=[]),str(H),'exec'),ns)
grand=D/'grand.py';grand.write_text('import time\ntime.sleep(20)\n')
outer=D/'outer.py';outer.write_text('import subprocess,sys,time,pathlib\np=subprocess.Popen([sys.executable,'+repr(str(grand))+'],start_new_session=True)\npathlib.Path('+repr(str(D/'grand.pid'))+').write_text(str(p.pid))\ntime.sleep(20)\n')
result=ns['bounded_command']([__import__('sys').executable,str(outer)],D/'forced-timeout',1)
assert result['timedOut'] and result['status']=='OUTER_COMMAND_FAILURE_PRESERVED_NO_RETRY' and result['returncode']<0
pid=int((D/'grand.pid').read_text());stat=Path('/proc')/str(pid)/'stat'
if stat.exists():assert stat.read_text().split(') ',1)[1].split()[0]=='Z','descendant still live'
assert any(x['pid']==pid for x in result['killedDescendants'])
raw=json.loads((D/'forced-timeout.exit.json').read_text());assert raw==result
nextCell=False
if result['status']=='OUTER_COMMAND_EXIT_PASS':nextCell=True
assert not nextCell and h(H)==before
out={'status':'PURE_EXACT_HOSTED_OUTER_TIMEOUT_DESCENDANT_CONTAINMENT_PASS_NO_NATIVE','helperSha256Before':before,'helperSha256After':h(H),'result':result,'descendantPid':pid,'descendantAbsentOrZombie':True,'noLaterCell':True,'scope':'Pure Python nested session control only; no ROM/addon/guest/native.'}
persist(D/'result.json',out);print(json.dumps(out))
