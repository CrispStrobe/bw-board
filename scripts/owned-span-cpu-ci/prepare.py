#!/usr/bin/env python3
"""Authenticate archived qualification and source-only reused materialization; no native cells."""
from pathlib import Path
import os,sys,json,hashlib,subprocess,zipfile,stat,shutil
sys.dont_write_bytecode=True
from qualification import admit
P=Path(__file__).resolve().parent
TOOLING='80d228ee5452f380655a16c4bc823beb76e781c1'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def git(root,args):return subprocess.check_output(['git','-C',str(root),*args],timeout=60)
def authenticate(root):
 head=git(root,['rev-parse','HEAD']).decode().strip();assert not git(root,['status','--porcelain','--untracked-files=no']).strip()
 names=[x for x in git(root,['ls-files']).decode().splitlines() if x.startswith('scripts/owned-span-cpu-ci/') or x=='.github/workflows/i80386-owned-span-cpu-gate.yml']
 current={n:sha(root/n) for n in names}
 for n,h in current.items():assert h==hashlib.sha256(git(root,['show',head+':'+n])).hexdigest()
 return {'head':head,'files':current}
def main():
 root=Path(os.environ['BW_SPAN_CPU_PUBLICATION']).resolve();tool=Path(os.environ['BW_SPAN_CPU_TOOLING']).resolve();context=Path(os.environ['BW_SPAN_CPU_CONTEXT']).resolve();context.mkdir(exist_ok=True);before=authenticate(root);event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_bytes());assert os.environ['GITHUB_EVENT_NAME']=='pull_request' and before['head']==event['pull_request']['head']['sha']
 q=json.loads((P/'qualification-template.json').read_bytes());assert q['status']=='ROOT_AND_PEER_THREE_SPAN_NATIVE_CELLS_PASS', 'Unqualified actualartifact binding refuses before download/materialization'
 admit(context)
 assert type(q['runId'])is int and type(q['artifactId'])is int and q['head']==TOOLING and len(q['zipSha256'])==64 and q['rootAudit'] and q['peerAudit']
 assert git(tool,['rev-parse','HEAD']).decode().strip()==TOOLING and not git(tool,['status','--porcelain']).strip()
 assets=tool/'scripts/owned-span-parity-ci';inventory=json.loads((assets/'packet-files.json').read_bytes());original={}
 for name,h in inventory['files'].items():
  assert sha(tool/name)==h==hashlib.sha256(git(tool,['show',TOOLING+':'+name])).hexdigest();original[name]=h
 original['scripts/owned-span-parity-ci/packet-files.json']=sha(assets/'packet-files.json')
 # Distinct source-only derivative keeps fixedmaterializer effects; replaces only
 # the PR publication identity check because retainedtooling is a separate fixedcheckout.
 source=(assets/'prepare.py').read_text();old="assert before['head']==event['pull_request']['head']['sha'];";assert source.count(old)==1;new="assert before['head']=='"+TOOLING+"';";oldMetadata="'head':before['head'],'pullRequest':event['number']"
 newMetadata="'head':event['pull_request']['head']['sha'],'toolingHead':before['head'],'pullRequest':event['number']"
 assert source.count(oldMetadata)==1
 derived=source.replace(old,new).replace(oldMetadata,newMetadata);assert derived.replace(newMetadata,oldMetadata).replace(new,old)==source
 copied=context/'materializer-tools';shutil.copytree(assets,copied);(copied/'prepare.py').write_text(derived)
 # Original common.publication continues authenticating the original exacttooling map.
 env=dict(os.environ);env.update(BW_SPAN_PUBLICATION=str(tool),BW_SPAN_COMPILED=os.environ['BW_SPAN_COMPILED'],BW_SPAN_CONTEXT=str(context/'materialization'))
 Path(env['BW_SPAN_CONTEXT']).mkdir();(context/'derivation.json').write_text(json.dumps({'originalHead':TOOLING,'originalSourceSha256':hashlib.sha256(source.encode()).hexdigest(),'derivedSha256':sha(copied/'prepare.py'),'originalFiles':original,'seams':[{'old':old,'new':new},{'old':oldMetadata,'new':newMetadata}],'inverseExact':True,'CPUpublication':before,'scope':'Eventhead admission targets separately pinnedtooling; workflow metadata reports actualCPUeventhead and distinct toolingHead. Two exactinverse seams, no nativecells/core changes.'},indent=2)+'\n')
 # Required sourceguard: downloadedqualification is authenticated BEFORE this
 # preparation child; setup uses no addon.load and never calls run-cells.py.
 assert (context/'qualification-admitted.json').exists(),'Qualification downloader/admission must complete first'
 with (context/'materializer.stdout').open('xb')as out,(context/'materializer.stderr').open('xb')as err:
  subprocess.run([sys.executable,str(copied/'prepare.py')],env=env,stdout=out,stderr=err,check=True,timeout=240)
 assert authenticate(root)==before
 (context/'source-preparation.json').write_text(json.dumps({'status':'SOURCE_MATERIALIZATION_PASS_NO_NATIVE_CELLS','publication':before,'tooling':TOOLING,'originalFiles':original},indent=2)+'\n')
if __name__=='__main__':main()
