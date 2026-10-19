"""Archived source-only exact Git reconstruction. Never loads native code."""
from pathlib import Path
import subprocess,os,hashlib,json
BASE='fe1eff2039520536350922a2164c8bbe29404c68';DISPATCH='e7a6a4ab7f2bed32a5f6d0c81e35c04e1d16d759';RUNTIME='2c688e69cae516b9749d70a126a3b474707d5cb7'
def reconstruct(repo,assets,destination,index):
 repo,assets,destination,index=map(Path,[repo,assets,destination,index]);assert not destination.exists()and not index.exists();env=dict(os.environ,GIT_INDEX_FILE=str(index.resolve()))
 def git(args,data=None):return subprocess.check_output(['git','-C',str(repo),*args],input=data,env=env,timeout=120).strip().decode()
 frozen=json.loads((assets/'frozen-source.json').read_text());assert frozen['runtime']['revision']==RUNTIME and len(frozen['runtime']['hashes'])==112;assert frozen['compiled']['revision']==BASE and len(frozen['compiled']['hashes'])==103
 git(['read-tree',BASE]);proof=[]
 groups=[(DISPATCH,BASE,['scripts/bochs-cpu3-native-owned-dispatch/provider.mjs','scripts/bochs-cpu3-native-owned-dispatch/derivation.json','test/i80386-owned-dispatch.test.mjs']),(RUNTIME,DISPATCH,['scripts/bochs-cpu3-native-owned-dispatch-runtime/'+f for f in ['identity.mjs','derive.mjs','admission.mjs','frozen-source.json']]+['scripts/run-i80386-native-owned-dispatch.mjs','test/i80386-owned-dispatch-runtime.test.mjs'])]
 for revision,parent,paths in groups:
  raw=(assets/(revision+'.commit.txt')).read_bytes();lines=raw.split(b'\n');assert lines[0].startswith(b'tree ')and lines[1]==('parent '+parent).encode();expected_tree=lines[0][5:].decode()
  for p in paths:
   data=(assets/'payload'/p).read_bytes();assert hashlib.sha256(data).hexdigest()==frozen['runtime']['hashes'][p];blob=git(['hash-object','-w','--stdin'],data);git(['update-index','--add','--cacheinfo','100644',blob,p])
  tree=git(['write-tree']);assert tree==expected_tree,'exact complete frozen tree';commit=git(['hash-object','-w','-t','commit','--stdin'],raw);assert commit==revision,'exact raw metadata commit'
  proof.append({'revision':commit,'parent':parent,'tree':tree,'paths':paths,'rawCommitSha256':hashlib.sha256(raw).hexdigest()})
 subprocess.run(['git','-C',str(repo),'worktree','add','--detach',str(destination),RUNTIME],check=True,timeout=120);assert subprocess.check_output(['git','-C',str(destination),'status','--porcelain'])==b''
 return {'status':'EXACT_ARCHIVED_FROZEN_SOURCE_RECONSTRUCTION_PASS','commits':proof,'runtimeRevision':RUNTIME,'publicationRef':'df602248db514a7d86510a39a877b62b814e0030'}
