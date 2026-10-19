"""Read/hash/Git-only authentication helpers; imports launch nothing."""
import hashlib,json,pathlib,subprocess
BASE='fe1eff2039520536350922a2164c8bbe29404c68'
SPAN='8e35080d29b32e9fcee5f8fbc5800209c74df2e7'
RUNTIME='bbf2a73e3d9090e73fe7037f4b8dbd4f6248aaa1'
COMPILED=pathlib.Path('/tmp/bw-board-386-native-owned-in8-r3-20261002')
CANDIDATE=pathlib.Path('/tmp/bw-board-386-owned-span-runtime-source-20261002')
PARITY=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-span-parity-prepared-20261002')
RESTORED=pathlib.Path('/mnt/volume1/tmp-astra/native-owned-in8-r3-ci-restored-20261002')
BLANK=('NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE')
def sha(path):
 path=pathlib.Path(path);assert path.is_file() and not path.is_symlink();h=hashlib.sha256()
 with path.open('rb')as f:
  for block in iter(lambda:f.read(1<<20),b''):h.update(block)
 return h.hexdigest()
def read(path,cap=16<<20):
 path=pathlib.Path(path);assert path.is_file()and not path.is_symlink()and path.stat().st_size<=cap;return path.read_bytes()
def load(path):return json.loads(read(path))
def persist(path,value):pathlib.Path(path).write_text(json.dumps(value,indent=2)+'\n')
def git(root,args,data=None):return subprocess.check_output(['git','-C',str(root),*args],input=data,timeout=60)
def git_map(root,revision,names):
 names=list(names);raw=git(root,['cat-file','--batch'],(''.join(revision+':'+n+'\n'for n in names)).encode());cursor=0;result={}
 for name in names:
  end=raw.index(b'\n',cursor);header=raw[cursor:end].split();assert len(header)==3 and header[1]==b'blob';size=int(header[2]);start=end+1;data=raw[start:start+size];assert len(data)==size and raw[start+size:start+size+1]==b'\n';cursor=start+size+1;result[name]=hashlib.sha256(data).hexdigest()
 assert cursor==len(raw);return result
def source_map(root,revision,expected):
 assert git(root,['rev-parse','HEAD']).decode().strip()==revision
 current={n:sha(pathlib.Path(root)/n)for n in expected};committed=git_map(root,revision,expected);assert current==committed==expected
 return {'head':revision,'current':current,'git':committed}
def publication(root):
 root=pathlib.Path(root);P=root/'scripts/owned-span-parity-ci';inventory=load(P/'packet-files.json');head=git(root,['rev-parse','HEAD']).decode().strip();expected=inventory['files'];expected={**expected,'scripts/owned-span-parity-ci/packet-files.json':sha(P/'packet-files.json')}
 current={n:sha(root/n)for n in expected};committed=git_map(root,head,expected);assert current==committed==expected
 return {'head':head,'current':current,'git':committed}
