#!/usr/bin/env python3
"""Prepare/authenticate a new hosted materialization; never compiles or loads native code."""
import datetime,hashlib,json,os,pathlib,shutil,subprocess,sys
sys.dont_write_bytecode=True
from common import BASE,SPAN,RUNTIME,COMPILED,CANDIDATE,PARITY,RESTORED,BLANK,sha,read,load,persist,git,source_map,publication
from reconstruct import reconstruct
from materialize import download,zip_extract,restore,place,inflate,OFFICIAL

def main():
 root=pathlib.Path(os.environ['BW_SPAN_PUBLICATION']).resolve();repo=pathlib.Path(os.environ['BW_SPAN_COMPILED']).resolve();context=pathlib.Path(os.environ['BW_SPAN_CONTEXT']).resolve();assert context.is_dir();assets=root/'scripts/owned-span-parity-ci';record={'status':'HOSTED_MATERIALIZATION_STARTED_NO_NATIVE_EXECUTION','startedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalProvenance':'Existing qualified compiled fe1 official CI artifact and historical derived records; this host filesystem is a distinct new materialization.','childGuestLaunched':False};before=None
 for k in BLANK:os.environ[k]=''
 try:
  before=publication(root);record['publicationBefore']=before;event=load(os.environ['GITHUB_EVENT_PATH']);assert os.environ['GITHUB_EVENT_NAME']=='pull_request';assert before['head']==event['pull_request']['head']['sha'];assert os.environ['GITHUB_REPOSITORY']=='CrispStrobe/bw-board';record['workflow']={'runId':os.environ['GITHUB_RUN_ID'],'attempt':os.environ['GITHUB_RUN_ATTEMPT'],'event':'pull_request','head':before['head'],'pullRequest':event['number']};persist(context/'materialization.json',record)
  b=load(assets/'bindings-template.json');assert b['revision']==RUNTIME and b['frozenSpanRevision']==SPAN and b['compiledRevision']==BASE;assert len(b['sourceHashes'])==116 and len(b['compiledSourceHashes'])==103;assert b['expectedProvenance']['compiled']['revision']==BASE
  assert git(repo,['rev-parse','HEAD']).decode().strip()==BASE;source_map(repo,BASE,b['compiledSourceHashes'])
  # Fresh runner only: no local reuse or overwriting historical namespaces.
  scratch=pathlib.Path('/mnt/volume1/tmp-astra');assert not scratch.exists()
  subprocess.run(['sudo','mkdir','-p',str(scratch)],check=True,timeout=30);subprocess.run(['sudo','chown',str(os.getuid())+':'+str(os.getgid()),str(scratch)],check=True,timeout=30)
  record['reconstruction']=reconstruct(repo,assets,context/'runtime-reconstruction.index',b);persist(context/'reconstruction.json',record['reconstruction'])
  record['runtimeSource']=source_map(CANDIDATE,RUNTIME,b['sourceHashes']);record['compiledSource']=source_map(COMPILED,BASE,b['compiledSourceHashes']);persist(context/'source-before.json',{'runtime':record['runtimeSource'],'compiled':record['compiledSource']})
  node=pathlib.Path(shutil.which('node')).resolve();assert sha(node)==b['nodeSha256'];assert subprocess.check_output([str(node),'--version'],timeout=10).strip()==b'v22.23.3';record['node']={'path':str(node),'sha256':sha(node),'version':'v22.23.3'}
  record['toolchain']={name:subprocess.check_output([name,'--version'],timeout=10).decode(errors='replace').splitlines()[0]for name in ['as','ld','objcopy','nm']}
  archive=download(context,os.environ['GH_TOKEN']);evidence,inventory=zip_extract(archive,context/'official-extract');record['officialArtifact']={**OFFICIAL,'retainedZip':str(archive),'newEvidencePath':str(evidence)};record['restored']=restore(evidence,assets,b)
  original=assets/'original';place(original/'guest-source.bochsrc',b['configuration']);place(original/'js-capture.json',b['baseline']);place(original/'native-capture.json',b['baselineNativeCapture'])
  record['oracles']=[inflate(original/'reference-child.stderr.gz',b['baselineNativeTrace'],149884550,'b3646e15a29a0d40f0e9ca8e93f82a28e20fd8caed3d30365f441446460eeda2'),inflate(original/'reference-callbacks.jsonl.gz',b['baselineNativeJournal'],11730929,'6e130c37266188258be29fe21f4e165b0c2d75a5c6b79347964a6d509fb55946'),inflate(original/'reference-events.jsonl.gz',pathlib.Path(b['baseline']).parent/'events.jsonl',7049784,'3b90f08b6d832c8ce259e88744572abd06e2088e46c87c1fa6d2f3daf61e2322')]
  alias=pathlib.Path('/tmp/bw-board-386-native-owned-clock-20261002');assert not alias.exists();alias.mkdir();(alias/'roms').symlink_to(COMPILED/'roms',target_is_directory=True);record['newRomAlias']={'path':str(alias/'roms'),'target':str(COMPILED/'roms'),'purpose':'Resolve unchanged historical configuration paths on this new host.'}
  assert not PARITY.exists();PARITY.mkdir()
  for name,h in b['helperHashes'].items():assert sha(assets/name)==h;place(assets/name,PARITY/name)
  b['runtimeWorktree']=str(CANDIDATE);b['driver']=str(CANDIDATE/'scripts/run-i80386-native-owned-span.mjs');b['node']=str(node);b['status']='HOSTED_CLOSED_BINDINGS_AUTHENTICATED_AWAITING_THREE_NATIVE_CELLS'
  # Pin every artifact actually used, original official records, all20 prepared files,
  # all103 frozen bytes, complete source packet/currentGit context, and lossless raw oracles.
  artifact={str(evidence/name):h for name,h in inventory['files'].items()};artifact[str(evidence/'artifact-inventory.json')]=OFFICIAL['inventorySha256'];artifact[str(archive)]=OFFICIAL['zipSha256'];artifact[str(context/'official-artifact-metadata.json')]=sha(context/'official-artifact-metadata.json');artifact.update(record['restored']['prepared20']);artifact.update(record['restored']['frozenSource103'])
  for name in ['derived-prepare.json','derived-build-receipt.json','relocation-proof.json']:artifact[str(RESTORED/name)]=sha(RESTORED/name)
  for name in ['configuration','baseline','baselineNativeCapture','baselineNativeTrace','baselineNativeJournal','driver']:artifact[b[name]]=sha(b[name])
  events=pathlib.Path(b['baseline']).parent/'events.jsonl';artifact[str(events)]=sha(events)
  artifact.update({str(root/name):h for name,h in before['current'].items()});artifact[str(context/'reconstruction.json')]=sha(context/'reconstruction.json');artifact[str(context/'source-before.json')]=sha(context/'source-before.json')
  proof={k:record[k]for k in ['originalProvenance','workflow','publicationBefore','reconstruction','runtimeSource','compiledSource','node','toolchain','officialArtifact','restored','oracles','newRomAlias']};proof['status']='NEW_HOST_MATERIALIZATION_PROOF_ORIGINAL_RECORDS_UNCHANGED_NO_GUEST';persist(context/'new-materialization-proof.json',proof);artifact[str(context/'new-materialization-proof.json')]=sha(context/'new-materialization-proof.json');b['artifactHashes']=artifact;persist(PARITY/'approved-bindings.json',b)
  record['bindingSha256']=sha(PARITY/'approved-bindings.json');record['artifactCount']=len(artifact);record['runtimeSourceAfter']=source_map(CANDIDATE,RUNTIME,b['sourceHashes']);record['compiledSourceAfter']=source_map(COMPILED,BASE,b['compiledSourceHashes']);assert record['runtimeSource']==record['runtimeSourceAfter']and record['compiledSource']==record['compiledSourceAfter'];assert publication(root)==before;assert sha(node)==record['node']['sha256']
  record['status']='HOSTED_NEW_MATERIALIZATION_EXACT_SOURCE_AND_ORACLES_PASS_NO_NATIVE_EXECUTION';persist(context/'materialization.json',record);print(json.dumps({'status':record['status'],'bindingSha256':record['bindingSha256'],'artifactCount':len(artifact),'runtimeRevision':RUNTIME,'compiledRevision':BASE}));return 0
 except Exception as e:
  record['status']='HOSTED_MATERIALIZATION_FAILED_NO_NATIVE_EXECUTION';record['error']=type(e).__name__+': '+str(e);raise
 finally:
  record['endedUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
  try:record['publicationAfter']=publication(root)
  except Exception as e:record['publicationAfter']={'error':type(e).__name__+': '+str(e)}
  persist(context/'materialization.json',record)
if __name__=='__main__':raise SystemExit(main())
