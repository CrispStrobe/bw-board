"""Recreate genuine frozen source Git objects over exact fe1, with no source rewrites."""
import hashlib,os,pathlib,subprocess
from common import BASE,SPAN,RUNTIME,CANDIDATE,COMPILED,read
GROUPS=[(SPAN,BASE,'da92f8a1cad09f5cd1d273becf8d1e98da9b8e7f','source110.commit.raw'),(RUNTIME,SPAN,'f1b59b9fd00c3ae113247fbe86a9e17244070bda','runtime116.commit.raw')]
def reconstruct(repo,assets,index,binding):
 repo,assets,index=map(pathlib.Path,[repo,assets,index]);assert not index.exists()and not CANDIDATE.exists()and not COMPILED.exists();env={**os.environ,'GIT_INDEX_FILE':str(index)}
 def run(args,data=None):return subprocess.check_output(['git','-C',str(repo),*args],input=data,env=env,timeout=60).decode().strip()
 assert run(['rev-parse','HEAD'])==BASE;run(['read-tree',BASE]);proof=[]
 source=list(binding['sourceHashes']);compiled=set(binding['compiledSourceHashes']);support={'scripts/bochs-cpu3-native-owned-span-runtime/'+n for n in ['identity.mjs','derive.mjs','admission.mjs','frozen-source.json']}|{'scripts/run-i80386-native-owned-span.mjs','test/i80386-owned-span-runtime.test.mjs'}
 for revision,parent,tree,rawname in GROUPS:
  names=[n for n in source if n not in compiled and (n in support)==(revision==RUNTIME)];assert len(names)==(7 if revision==SPAN else 6)
  raw=read(assets/rawname);lines=raw.split(b'\n');assert lines[0]==('tree '+tree).encode()and lines[1]==('parent '+parent).encode()
  for name in names:
   data=read(assets/'payload'/(name+'.payload'));assert hashlib.sha256(data).hexdigest()==binding['sourceHashes'][name];blob=run(['hash-object','-w','--stdin'],data);run(['update-index','--add','--cacheinfo','100644',blob,name])
  assert run(['write-tree'])==tree;assert run(['hash-object','-w','-t','commit','--stdin'],raw)==revision
  proof.append({'revision':revision,'parent':parent,'tree':tree,'rawCommitSha256':hashlib.sha256(raw).hexdigest(),'addedPaths':names})
 for revision,target in [(BASE,COMPILED),(RUNTIME,CANDIDATE)]:
  subprocess.run(['git','-C',str(repo),'worktree','add','--detach',str(target),revision],check=True,timeout=60);assert subprocess.check_output(['git','-C',str(target),'status','--porcelain'],timeout=30)==b''
 return {'status':'EXACT_SOURCE110_RUNTIME116_RAW_GIT_RECONSTRUCTION_PASS_NO_BUILD','commits':proof,'compiledRevision':BASE,'runtimeRevision':RUNTIME}
