"""Read-only fixed source roles; no restoration, recorder or CPU imports."""
import os,json,hashlib,subprocess
from pathlib import Path
from policy import require
HERE=Path(__file__).resolve().parent;ROOT=HERE.parents[1];WS=Path('/home/runner/work/bw-board/bw-board');OUT=Path('/home/runner/work/_temp/cold-ledger-scalars-native-symbol');PARENT=Path('/home/runner/work/_temp/cold-ledger-scalars-native-symbol-parent')
def read(path):
 raw=Path(path).read_bytes();require(len(raw)<=8<<20,'bounded metadata');return json.loads(raw)
def fingerprint(path):
 p=Path(path);require(p.is_file() and not p.is_symlink() and p.resolve()==p,'ordinary exact source/input');raw=p.read_bytes();require(len(raw)<=256<<20,'bounded source/input');return {'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],timeout=15,env={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'})
def own_source():
 rev=git(ROOT,'rev-parse','HEAD').decode().strip();require(not git(ROOT,'status','--porcelain'),'clean dispatch source');paths=[p for p in HERE.iterdir() if p.is_file()]+[ROOT/'.github/workflows/i80386-cold-ledger-scalars-native-symbol.yml',ROOT/'test/i80386-cold-ledger-scalars-native-symbol-hosted-source.test.mjs'];hashes={}
 for p in sorted(paths):
  h=fingerprint(p)['sha256'];name=str(p.relative_to(ROOT));require(h==hashlib.sha256(git(ROOT,'show',rev+':'+name)).hexdigest(),'own current/Git '+name);hashes[name]=h
 return {'revision':rev,'hashes':hashes}
def sources(c,node):
 result={'dispatch':own_source(),'node':fingerprint(node),'roles':{}}
 for name,role in c['roles'].items():
  root=Path(role['root']);require(root==WS/({'diagnostic':'symbol-worker','compiled':'publication','qualifier':'qualifier','driver':'driver','scalar':'scalar-worker'}[name]),'fixed disjoint role')
  require(git(root,'rev-parse','HEAD').decode().strip()==role['revision'] and not git(root,'status','--porcelain'),'fixed clean role '+name)
  for path,h in role['files'].items():require(fingerprint(root/path)['sha256']==h==hashlib.sha256(git(root,'show',role['revision']+':'+path)).hexdigest(),'role current/Git '+name+'/'+path)
  result['roles'][name]={'revision':role['revision'],'hashes':role['files']}
 return result
