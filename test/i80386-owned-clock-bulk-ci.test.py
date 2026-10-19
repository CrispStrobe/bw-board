"""Source-only portable derivation and process-tree controls; no addon import/load."""
import ast,hashlib,json,os,re,shutil,signal,subprocess,sys,tempfile,time,unittest
from pathlib import Path
W=Path(__file__).resolve().parent.parent;SCRIPT=W/'scripts/ci-benchmark-i80386-owned-clock-bulk.py';A=W/'scripts/owned-clock-bulk-ci';SOURCE=SCRIPT.read_text()
class Controls(unittest.TestCase):
 def test_pinned_evidence(self):
  for name,item in json.loads((A/'source-inventory.json').read_text()).items():self.assertEqual(hashlib.sha256((A/name).read_bytes()).hexdigest(),item['sha256'])
 def test_portable_exact_inverses_and_parse(self):
  # Exercise the actual source generator slice, excluding restoration/native execution.
  C=Path('/tmp/bw-board-386-native-owned-in8-r3-20261002');B=Path('/tmp/bw-board-386-owned-clock-bulk-source-20261002')
  if not C.exists() or not B.exists():self.skipTest('fixed frozen source worktrees required for local source-only derivative check')
  with tempfile.TemporaryDirectory() as d:
   R=Path(d);ns=dict(Path=Path,C=C,B=B,A=A,R=R,node='/tmp/node-v22.23.3-linux-x64/bin/node',shutil=shutil,re=re,hashlib=hashlib,sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest())
   fragment=SOURCE[SOURCE.index("gate=R/'gate'"):SOURCE.index("b=json.loads((A/'gate-bindings.json')")];exec(compile(fragment,str(SCRIPT),'exec'),ns)
   self.assertTrue(ns['derivation']['base-runner.mjs']['inverseExact'])
   for name in ['base-runner.mjs','runner.mjs','profile-admission.mjs','admission.mjs']:
    r=subprocess.run([ns['node'],'--check',str(R/'gate'/name)],capture_output=True,text=True,timeout=30);self.assertEqual(r.returncode,0,r.stderr)
   self.assertEqual(hashlib.sha256((R/'gate/runner.mjs').read_bytes()).hexdigest(),ns['derivation']['runner.mjs']['derivedSha256'])
 def test_timeout_kills_independent_descendant_session(self):
  tree=ast.parse(SOURCE);function=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='terminateTree');ns=dict(Path=Path,os=os,signal=signal);exec(compile(ast.Module(body=[function],type_ignores=[]),str(SCRIPT),'exec'),ns)
  with tempfile.TemporaryDirectory() as d:
   pidfile=Path(d)/'pid';program="import subprocess,sys,time; child=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'],start_new_session=True);open(sys.argv[1],'w').write(str(child.pid));time.sleep(60)"
   parent=subprocess.Popen([sys.executable,'-c',program,str(pidfile)],start_new_session=True)
   try:
    until=time.monotonic()+5
    while not pidfile.exists() and time.monotonic()<until:time.sleep(.01)
    child=int(pidfile.read_text());killed=ns['terminateTree'](parent.pid);parent.wait(timeout=5);self.assertIn(child,killed)
    until=time.monotonic()+5
    while time.monotonic()<until:
     p=Path('/proc')/str(child)/'stat'
     if not p.exists() or p.read_text().split(') ',1)[1].split()[0]=='Z':break
     time.sleep(.01)
    else:self.fail('descendant remains executing')
   finally:
    if parent.poll() is None:ns['terminateTree'](parent.pid);parent.wait()
if __name__=='__main__':unittest.main()
