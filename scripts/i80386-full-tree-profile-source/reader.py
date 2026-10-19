"""Independent complete-profile source packet reader. Unarmed, stdlib only."""
import json,re,hashlib
TABLE_CAP=65536
DESCRIPTOR_CAP=8192
SNAPSHOT_CAP=65536
ROLE_CAP=100
FILE_CAP=524288
REVIEW_DESCRIPTOR_SHA=None
SOURCE_TABLE_SHA=None
HEAD=re.compile('[0-9a-f]{40}\\Z')
SHA=re.compile('[0-9a-f]{64}\\Z')
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def keys(v,names):
 need(type(v)is dict and len(v)==len(names) and all(type(k)is str and len(k)<=240 for k in v),'closed-keys');need(set(v)==set(names),'closed-keys')
def integer(v,low=0,high=2**64-1):need(type(v)is int and low<=v<=high,'integer')
def digest(v):need(type(v)is str and SHA.fullmatch(v)is not None,'sha256')
def head(v):need(type(v)is str and HEAD.fullmatch(v)is not None,'head')
def same(a,b):
 if type(a)is not type(b):return False
 if type(a)is dict:return a.keys()==b.keys()and all(same(a[k],b[k])for k in a)
 if type(a)is list:return len(a)==len(b)and all(same(x,y)for x,y in zip(a,b))
 return a==b
def bounded(v,depth=0,budget=None):
 if budget is None:budget=[5000]
 budget[0]-=1;need(budget[0]>=0 and depth<=8,'json-complexity')
 if v is None or type(v)is bool:return
 if type(v)is int:integer(v);return
 if type(v)is str:need(len(v)<=4096,'json-string');return
 if type(v)is list:
  need(len(v)<=100,'json-array')
  for x in v:bounded(x,depth+1,budget)
  return
 need(type(v)is dict and len(v)<=120 and all(type(k)is str and len(k)<=240 for k in v),'json-object')
 for x in v.values():bounded(x,depth+1,budget)
def load(raw,cap):
 need(type(raw)is bytes and len(raw)<=cap,'json-cap')
 def pairs(rows):
  out={}
  for k,v in rows:need(k not in out,'duplicate-json-key');out[k]=v
  return out
 def forbidden(_):raise Refusal('json-number')
 try:v=json.loads(raw.decode('utf8'),object_pairs_hook=pairs,parse_float=forbidden,parse_constant=forbidden)
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('json-parse')from None
 bounded(v);return v
def path(value):
 need(type(value)is str and 1<=len(value)<=240,'path-shape')
 need(re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',value)is not None,'path-shape')
 parts=value.split('/');need(len(parts)<=30 and all(x not in ('.','..')for x in parts),'path-shape')
 return parts
def no_ancestors(paths,including_table=False):
 need(type(paths)is list and len(paths)<=ROLE_CAP+int(including_table) and all(type(x)is str for x in paths),'role-paths')
 seen=set();required_dirs=set()
 for value in paths:
  parts=path(value);need(value not in seen and value not in required_dirs,'role-alias')
  for i in range(1,len(parts)):
   ancestor='/'.join(parts[:i]);need(ancestor not in seen,'role-ancestor');required_dirs.add(ancestor)
  seen.add(value)
 return seen
# Exact descriptor/table/snapshot wire schemas await separately frozen source gate.
def audit_unarmed(*_args):raise Refusal('complete-profile-wire-contract-unset')
HELD_TABLE_SHA='7791576ea6ec741fb287ef1ff3545f3cd48f6f9784a6cf996c1e0524558080a7'
ROLE_KINDS=('inherited','runner','packet','admission','admission-control','executor','executor-control','workflow','config','control','readme')
REQUIRED_NEW_KINDS=('runner','packet','admission','admission-control','executor','executor-control','workflow')
HELD_GIT_BLOBS={'scripts/i80386-djgpp-notice-extractor/README.md': 'bf6c36ac0e6ec1a79551895e088ba6d9ad2345de', 'scripts/i80386-djgpp-notice-extractor/controls.py': '29c76a09ac9e50bda7558dee18c3a9ea548f05a6', 'scripts/i80386-djgpp-notice-extractor/extractor.py': 'a2414e18eaf2e1f6c1464f04afe6d0c103150a01', 'scripts/i80386-full-tree-archive-bridge/README.md': '6cbdde0ea93a9a8a51dfa4748a268eda306c5a2a', 'scripts/i80386-full-tree-archive-bridge/bridge.py': 'b3f342cb11831b616880ccca15d8099202bf6807', 'scripts/i80386-full-tree-archive-bridge/controls.py': '47426d44214d4991bc96427588adc0eef4ad78ed', 'scripts/i80386-full-tree-notice-connection/README.md': '8adb1949d663de44be1a569a5aa5c8eb68131a92', 'scripts/i80386-full-tree-notice-connection/controls.py': '8ecccd485eefd70b649e73542d23085db1923a0b', 'scripts/i80386-full-tree-notice-connection/coordinator.py': '08c47105a5a786a5430a78d0b20b9dc684704349', 'scripts/i80386-full-tree-provisioner/README.md': '3c8bcc4366d1ba0e7b407531caf1e27768ed271d', 'scripts/i80386-full-tree-provisioner/controls.py': 'fb9ada9482555bc91deb3a46d30444e3173712ce', 'scripts/i80386-full-tree-provisioner/manifest.json': '06807fd9952c5cd518e59cef5eff6721dd301a4d', 'scripts/i80386-full-tree-provisioner/provenance.json': 'b923493f0d06e163cbdbd67d5f57a77b2fcd0d36', 'scripts/i80386-full-tree-provisioner/provision.py': 'b11d4ee2e5f64c7d402eabf1f5151fc077d18a5a'}
FLAGS=('profileSourceAdmissionQualified','gitJoinImplemented','continuousSourceOwnershipQualified','inputLeaseQualified','filesystemLeaseQualified','compilerQualified','guestQualified','performanceQualified')
def descriptor(raw):
 v=load(raw,DESCRIPTOR_CAP);keys(v,('schema','status','head','repository','origin','workflow','branch','pr','tablePath','tableBytes','tableSha256','tableGitBlob'))
 need(v['schema']=='bw.full-tree-profile-descriptor.v1' and v['status']=='UNARMED_SOURCE_ONLY','descriptor-schema');head(v['head'])
 need(v['repository']=='CrispStrobe/bw-board'and v['origin']=='https://github.com/CrispStrobe/bw-board.git','own-repository')
 path(v['workflow']);need(v['workflow'].startswith('.github/workflows/')and v['workflow'].endswith('.yml'),'workflow-path')
 need(type(v['branch'])is str and 1<=len(v['branch'])<=120 and re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',v['branch'])is not None,'branch')
 path(v['branch']);integer(v['pr'],1,2**63-1);path(v['tablePath']);integer(v['tableBytes'],1,TABLE_CAP);digest(v['tableSha256']);head(v['tableGitBlob']);return v
def held_table(raw):
 need(type(raw)is bytes and len(raw)<=TABLE_CAP and hashlib.sha256(raw).hexdigest()==HELD_TABLE_SHA,'held-table-seal');v=load(raw,TABLE_CAP)
 need(type(v)is dict and len(v)==14,'held-table')
 for name,row in v.items():path(name);keys(row,('bytes','sha256'));integer(row['bytes'],1,FILE_CAP);digest(row['sha256'])
 return v
def role_table(raw,d,held_raw):
 need(type(raw)is bytes and len(raw)==d['tableBytes']and hashlib.sha256(raw).hexdigest()==d['tableSha256'],'table-seal');need(hashlib.sha1(b'blob '+str(len(raw)).encode('ascii')+b'\0'+raw).hexdigest()==d['tableGitBlob'],'table-git-blob');v=load(raw,TABLE_CAP);keys(v,('schema','inheritedRoleCount','roles'))
 need(v['schema']=='bw.full-tree-profile-role-table.v1','table-schema');integer(v['inheritedRoleCount'],14,14)
 need(type(v['roles'])is dict and 21<=len(v['roles'])<=ROLE_CAP,'role-count');no_ancestors(list(v['roles']))
 need(d['tablePath']not in v['roles'],'table-self-cycle');no_ancestors([*v['roles'],d['tablePath']],including_table=True)
 need(type(ROLE_KINDS)is tuple and len(ROLE_KINDS)<=16 and all(type(x)is str for x in ROLE_KINDS),'role-kind-contract-unset')
 for name,row in v['roles'].items():
  keys(row,('kind','bytes','sha256','gitBlob'));need(type(row['kind'])is str and row['kind']in ROLE_KINDS,'role-kind');integer(row['bytes'],1,FILE_CAP);digest(row['sha256']);head(row['gitBlob'])
 need({name for name,row in v['roles'].items()if row['kind']=='inherited'}==set(HELD_GIT_BLOBS) and set(REQUIRED_NEW_KINDS)<=set(row['kind']for row in v['roles'].values()),'new-profile-kind-closure')
 need(d['workflow']in v['roles']and v['roles'][d['workflow']]['kind']=='workflow','descriptor-workflow-join')
 held=held_table(held_raw)
 for name,row in held.items():need(name in v['roles']and same(v['roles'][name]['bytes'],row['bytes'])and same(v['roles'][name]['sha256'],row['sha256'])and v['roles'][name]['kind']=='inherited'and v['roles'][name]['gitBlob']==HELD_GIT_BLOBS[name],'inherited-role-binding')
 return v

def snapshot(raw,position,d,table,descriptor_digest):
 v=load(raw,SNAPSHOT_CAP);keys(v,('schema','position','head','repository','roleCount','roles','table','descriptorSha256',*FLAGS))
 need(position in ('before','after')and v['position']==position and v['schema']=='bw.full-tree-profile-source.v1','snapshot-version-position')
 head(v['head']);digest(v['descriptorSha256']);need(v['head']==d['head']and v['repository']==d['repository']and v['descriptorSha256']==descriptor_digest,'snapshot-descriptor')
 integer(v['roleCount'],21,ROLE_CAP);need(v['roleCount']==len(table['roles'])and same(v['roles'],table['roles']),'snapshot-role-join')
 expected={'path':d['tablePath'],'bytes':d['tableBytes'],'sha256':d['tableSha256'],'gitBlob':d['tableGitBlob']};need(same(v['table'],expected),'snapshot-table-join')
 need(all(v[k]is False for k in FLAGS),'false-authority-flags');return v

def validate_source_pair(descriptor_raw,table_raw,before_raw,after_raw,held_raw):
 d=descriptor(descriptor_raw);t=role_table(table_raw,d,held_raw);dh=hashlib.sha256(descriptor_raw).hexdigest();before=snapshot(before_raw,'before',d,t,dh);after=snapshot(after_raw,'after',d,t,dh)
 return {'schema':'private.full-tree-profile-source-reader-result.v1','qualification':'MANUFACTURED_FULL_GRAPH_REPORTED_POSITION_CONSISTENCY_ONLY','sourceRoleCount':len(t['roles']),'inheritedRoleCount':14,'separateTableObserved':True,'reportedPositionConsistency':True,**{k:False for k in FLAGS},'originalPacketQualified':False,'officialJobQualified':False,'completeNoticeCoverageQualified':False,'legalClearanceQualified':False,'fullToolchainReady':False}
def audit_source_pair(descriptor_raw,table_raw,before_raw,after_raw,held_raw):
 need(type(REVIEW_DESCRIPTOR_SHA)is str and type(SOURCE_TABLE_SHA)is str,'unsealed-source-only')
 need(type(descriptor_raw)is bytes and len(descriptor_raw)<=DESCRIPTOR_CAP and type(table_raw)is bytes and len(table_raw)<=TABLE_CAP,'sealed-input-cap')
 need(hashlib.sha256(descriptor_raw).hexdigest()==REVIEW_DESCRIPTOR_SHA and hashlib.sha256(table_raw).hexdigest()==SOURCE_TABLE_SHA,'external-seal')
 return validate_source_pair(descriptor_raw,table_raw,before_raw,after_raw,held_raw)
