"""Read-only role/source admission before importing held setup code."""
import hashlib,json,subprocess,os
from pathlib import Path
from policy import require
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
WORKSPACE=Path('/home/runner/work/bw-board/bw-board')
Q=WORKSPACE/'qualification-source'
N=WORKSPACE/'diagnostic-worker'
def ordinary(p,maxbytes=128<<20):
 p=Path(p);require(p.is_absolute() and str(p)==str(p.resolve()),'canonical ordinary path')
 require(not any(x.is_symlink() for x in (p,*p.parents)) and p.is_file(),'ordinary nonsymlink file')
 require(p.stat().st_size<=maxbytes,'file bound');return p.read_bytes()
def fingerprint(p):
 b=ordinary(p);return {'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
def read(p):return json.loads(ordinary(p))
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],timeout=15)
def role(root,description):
 require(git(root,'rev-parse','HEAD').decode().strip()==description['revision'],'exact role HEAD');require(not git(root,'status','--porcelain'),'clean role')
 out={}
 for p,r in sorted(description['files'].items()):
  require(not Path(p).is_absolute() and '..' not in Path(p).parts,'ordinary relative source')
  h=fingerprint(root/p)['sha256'];require(h==r['sha256']==hashlib.sha256(git(root,'show',description['revision']+':'+p)).hexdigest(),'current/Git role '+p);out[p]=h
 return {'revision':description['revision'],'hashes':out}
def own_source():
 head=git(ROOT,'rev-parse','HEAD').decode().strip();require(not git(ROOT,'status','--porcelain'),'clean parent')
 paths=[p for p in HERE.rglob('*') if p.is_file()]+[ROOT/'.github/workflows/i80386-cold-memory-fusion-execution-profile.yml',ROOT/'test/i80386-cold-memory-fusion-execution-profile-hosted-source.test.mjs']
 return role(ROOT,{'revision':head,'files':{str(p.relative_to(ROOT)):fingerprint(p) for p in paths}})
def sources(c,node):
 return {'tooling':own_source(),'qualifier':role(Q,c['qualifier']),'compiled':role(WORKSPACE/'publication',c['compiled']),'metadataDriver':role(WORKSPACE/'driver',c['metadataDriver']),'heldWorker':role(WORKSPACE/'fusion-worker',c['heldWorker']),'diagnosticWorker':role(N,c['diagnosticWorker']),'node':fingerprint(node)}
