"""Safe official archive restoration and lossless oracle materialization; no build/load."""
import gzip,hashlib,json,pathlib,shutil,stat,tarfile,urllib.request,zipfile
from common import read,load,sha,persist,RESTORED
OFFICIAL={'id':11226630502,'runId':37006765968,'head':'8804758633b3cabd23ff9c084238f80433da99f7','zipSha256':'0335f4c5088280cfcdf00186f5e0ca59ff431442edc3a978dd26b7dc2341a0e0','zipBytes':6711552,'inventorySha256':'1b880f0b37b02432743bed4ead8b7544a027d36ce3a9e935161ae38f17d2cd87'}
def clean_name(name):
 p=pathlib.PurePosixPath(name);assert not p.is_absolute()and '..'not in p.parts and '\\'not in name and '\0'not in name;return p
class PublicRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,req,fp,code,msg,headers,newurl):
  assert newurl.startswith('https://');new=super().redirect_request(req,fp,code,msg,headers,newurl)
  if new is not None:new.remove_header('Authorization')
  return new
def download(context,token):
 base='https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/'+str(OFFICIAL['id']);headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'bw-owned-span-native-parity'}
 with urllib.request.urlopen(urllib.request.Request(base,headers=headers),timeout=30)as response:raw=response.read(1<<20)
 metadata=json.loads(raw);(context/'official-artifact-metadata.json').write_bytes(raw)
 assert metadata['id']==OFFICIAL['id']and metadata['size_in_bytes']==OFFICIAL['zipBytes']and not metadata['expired']and metadata['digest']=='sha256:'+OFFICIAL['zipSha256'];assert metadata['workflow_run']['id']==OFFICIAL['runId']and metadata['workflow_run']['head_sha']==OFFICIAL['head']
 archive=context/'official-artifact.zip';count=0
 opener=urllib.request.build_opener(PublicRedirect())
 with opener.open(urllib.request.Request(base+'/zip',headers=headers),timeout=60)as response,archive.open('xb')as output:
  while True:
   block=response.read(1<<20)
   if not block:break
   count+=len(block);assert count<=16<<20;output.write(block)
 assert count==OFFICIAL['zipBytes']and sha(archive)==OFFICIAL['zipSha256'];return archive

def zip_extract(archive,dest):
 dest.mkdir();seen=set();total=0
 with zipfile.ZipFile(archive)as z:
  for entry in z.infolist():
   name=clean_name(entry.filename);assert str(name)not in seen;seen.add(str(name));assert len(seen)<=1000;mode=entry.external_attr>>16;assert not stat.S_ISLNK(mode);assert not entry.flag_bits&1;total+=entry.file_size;assert entry.file_size<=64<<20 and total<=128<<20
   target=dest.joinpath(*name.parts)
   if entry.is_dir():target.mkdir(parents=True,exist_ok=True);continue
   assert stat.S_IFMT(mode)in [0,stat.S_IFREG];target.parent.mkdir(parents=True,exist_ok=True)
   with z.open(entry)as source,target.open('xb')as out:shutil.copyfileobj(source,out,1<<20)
 inventory_paths=list(dest.rglob('artifact-inventory.json'));assert len(inventory_paths)==1;inventory_path=inventory_paths[0];assert sha(inventory_path)==OFFICIAL['inventorySha256'];evidence=inventory_path.parent;inventory=load(inventory_path);assert set(inventory['files'])=={str(p.relative_to(evidence))for p in evidence.rglob('*')if p.is_file()}-{'artifact-inventory.json'}
 for name,h in inventory['files'].items():assert sha(evidence/clean_name(name))==h
 return evidence,inventory

def tar_extract(archive,dest):
 dest.mkdir();seen=set();total=0
 with tarfile.open(archive,'r:gz')as tar:
  for member in tar:
   name=clean_name(member.name);assert str(name)not in seen;seen.add(str(name));assert len(seen)<=100000;assert member.isfile()or member.isdir();total+=member.size;assert member.size<=64<<20 and total<=512<<20;target=dest.joinpath(*name.parts)
   if member.isdir():target.mkdir(parents=True,exist_ok=True);continue
   target.parent.mkdir(parents=True,exist_ok=True)
   with tar.extractfile(member)as source,target.open('xb')as out:shutil.copyfileobj(source,out,1<<20)

def place(source,target):
 target=pathlib.Path(target);target.parent.mkdir(parents=True,exist_ok=True)
 with target.open('xb')as out:out.write(read(source))
 assert sha(source)==sha(target);return target

def restore(evidence,assets,binding):
 assert not RESTORED.exists();RESTORED.mkdir();T=RESTORED/'prepared';F=RESTORED/'frozen-source';tar_extract(evidence/'prepared-source.tar.gz',T);tar_extract(evidence/'frozen-source103.tar.gz',F);assert {str(p.relative_to(F))for p in F.rglob('*')if p.is_file()}==set(binding['compiledSourceHashes'])
 for name,h in binding['compiledSourceHashes'].items():assert sha(F/name)==h
 place(evidence/'bw_direct.node',T/'bochs/bw_direct.node')
 for name in ['derived-prepare.json','derived-build-receipt.json','relocation-proof.json']:place(assets/'original'/name,RESTORED/name)
 M=load(RESTORED/'derived-prepare.json');B=load(RESTORED/'derived-build-receipt.json');assert M['sourceHashes']==B['sourceHashes']==binding['compiledSourceHashes'];assert M['preparedTree']==B['preparedTree']==str(T);assert B['preparedManifestPath']==str(RESTORED/'derived-prepare.json');assert sha(RESTORED/'derived-prepare.json')==binding['buildInput']['preparedManifestSha256'];assert sha(RESTORED/'derived-build-receipt.json')==binding['buildInput']['buildReceiptSha256'];assert sha(T/'bochs/bw_direct.node')==binding['buildInput']['sha256']==B['addonSha256'];assert sha(T/'bochs/config.h')==B['configSha256']
 prepared={**M['patchedHashes'],**M['actualPreparedHashes'],'bochs/config.h':B['configSha256'],'bochs/bw_direct.node':B['addonSha256'],'bochs/cpu/bw_slice_runtime.h':binding['compiledSourceHashes']['scripts/bochs-cpu3-native-direct-board/runtime.h'],'bochs/bw_direct_addon.mk':binding['compiledSourceHashes']['scripts/bochs-cpu3-native-direct-board/addon.mk']};assert len(prepared)==20
 for name,h in prepared.items():assert sha(T/name)==h
 original=B['relocation']['original'];assert original['manifestSha256']==sha(evidence/'prepare.json')and original['receiptSha256']==sha(evidence/'build-static-preflight.json')and original['inventorySha256']==sha(evidence/'artifact-inventory.json')and original['addonSha256']==B['addonSha256'];assert original['sourceRevision']==binding['compiledRevision']and original['sourceHashes']==binding['compiledSourceHashes'];assert original['ci']['runId']==OFFICIAL['runId']and original['ci']['headSha']==OFFICIAL['head']
 # Recreated files are a new materialization, retaining the original historical receipts byte-for-byte.
 return {'originalReceiptKind':'Original qualified derived CI records, unchanged historical provenance','newMaterialization':True,'noCompilation':True,'noAddonLoad':True,'prepared20':{str(T/n):h for n,h in prepared.items()},'frozenSource103':{str(F/n):h for n,h in binding['compiledSourceHashes'].items()}}

def inflate(source,target,size,digest):
 target=pathlib.Path(target);target.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256();count=0
 with gzip.open(source,'rb')as incoming,target.open('xb')as out:
  while True:
   block=incoming.read(1<<20)
   if not block:break
   count+=len(block);assert count<=size;h.update(block);out.write(block)
 assert count==size and h.hexdigest()==digest and sha(target)==digest
 return {'compressedSha256':sha(source),'compressedBytes':source.stat().st_size,'rawPath':str(target),'rawBytes':count,'rawSha256':digest,'lossless':True}
