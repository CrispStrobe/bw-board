"""Root-requested isolated shallow Git prerequisite proof; no Node/addon/guest."""
from pathlib import Path
import subprocess,tempfile,os,json
W=Path('/tmp/bw-board-386-owned-dispatch-cpu-ghci-20261002');BASE='fe1eff2039520536350922a2164c8bbe29404c68'
for n in ['ci.yml','x86-xv6.yml']:
 s=(W/'.github/workflows'/n).read_text();assert s.count('git fetch --no-tags --depth=1 origin '+BASE)==1
with tempfile.TemporaryDirectory(prefix='owned-dispatch-shallow-')as tmp:
 t=Path(tmp);repo=t/'repo';url=W.as_uri()
 subprocess.run(['git','clone','--depth=1','--no-checkout',url,str(repo)],check=True,timeout=120)
 probe=subprocess.run(['git','-C',str(repo),'cat-file','-e',BASE+'^{commit}'],capture_output=True);assert probe.returncode!=0
 subprocess.run(['git','-C',str(repo),'fetch','--no-tags','--depth=1','origin',BASE],check=True,timeout=120)
 env=dict(os.environ,GIT_INDEX_FILE=str(t/'probe-index'));subprocess.run(['git','-C',str(repo),'read-tree',BASE],env=env,check=True,timeout=120)
 actual=subprocess.check_output(['git','-C',str(repo),'write-tree'],env=env,text=True).strip();expected=subprocess.check_output(['git','-C',str(repo),'show','-s','--format=%T',BASE],text=True).strip();assert actual==expected
 print(json.dumps({'status':'ACTUAL_SHALLOW_CI_BASELINE_FETCH_READ_TREE_PASS_NO_NATIVE','initialBaselineAbsent':True,'fetchedRevision':BASE,'tree':actual,'workflowGuards':2}))
